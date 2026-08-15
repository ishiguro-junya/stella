use crate::git::{GitCommand, GitExecutor, RunControl};
use crate::model::{
    ConflictBlock, ConflictBlockState, ConflictCapabilities, ConflictChoice, ConflictDocument,
    ConflictEditResult, ConflictKind, ConflictLabels, ConflictOperation, ConflictReplacements,
    ConflictResult, ConflictSide, ConflictSides, ErrorCode, ExternalEditor, ExternalEditorKind,
    LineEnding, LocalizedMessage, OperationState, Utf16Range, WorkspaceError, WorkspaceResult,
};
use crate::worktree_text::{
    MAX_EDIT_BYTES, MAX_EDIT_LINES, MAX_EDIT_LONGEST_LINE, NewlineStyle, atomic_write,
    atomic_write_with_mode, checked_worktree_path, newline_style, text_metrics,
};
use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::fs::{self, File};
use std::io::Read;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::MetadataExt;
use std::path::Path;
use std::process::{Command, Stdio};
use uuid::Uuid;

const EDIT_BYTES: usize = 1024 * 1024;
const EDIT_LINES: usize = 20_000;
const REVISION_HISTORY_LIMIT: usize = 100;
// このメモリ計算規則を`conflictSession.ts`と一致させる。
// UTF-16のコード単位あたり4バイトなら、JavaScriptとRustの文字列を多めに見積もれる。
const REVISION_HISTORY_BYTE_BUDGET: usize = 96 * 1024 * 1024;
const REVISION_SNAPSHOT_OVERHEAD_BYTES: usize = 128;
const REVISION_BLOCK_OVERHEAD_BYTES: usize = 256;
const DEFAULT_CONFLICT_MARKER_SIZE: usize = 7;
const MIN_CONFLICT_MARKER_SIZE: usize = 3;

#[derive(Debug, Clone, PartialEq, Eq)]
struct ConflictRevisionSnapshot {
    draft_text: String,
    blocks: Vec<ConflictBlockRevision>,
    document_revision: String,
    charged_bytes: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ConflictBlockRevision {
    id: String,
    range_utf16: Utf16Range,
    state: ConflictBlockState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ConflictAttributes {
    binary: bool,
    marker_size: Option<usize>,
}

#[derive(Debug, Clone)]
pub(crate) struct ConflictSession {
    pub(crate) id: String,
    pub(crate) path: String,
    pub(crate) related_paths: Vec<String>,
    pub(crate) generation: String,
    pub(crate) content_hash: String,
    content_hash_exact: bool,
    pub(crate) draft_text: String,
    pub(crate) blocks: Vec<ConflictBlock>,
    pub(crate) document_revision: String,
    revision_history: VecDeque<ConflictRevisionSnapshot>,
    marker_size: Option<usize>,
    pub(crate) kind: ConflictKind,
    pub(crate) in_app_edit: bool,
    pub(crate) resolution_evidence: bool,
    pub(crate) external_baseline_hash: Option<String>,
}

pub(crate) struct BlockChoiceRequest<'a> {
    pub(crate) generation: &'a str,
    pub(crate) content_hash: &'a str,
    pub(crate) document_revision: &'a str,
    pub(crate) base_document_revision: &'a str,
    pub(crate) block_id: &'a str,
    pub(crate) draft_text: &'a str,
    pub(crate) choice: ConflictChoice,
}

#[derive(Debug, Clone)]
struct StageEntry {
    mode: String,
    oid: String,
}

#[derive(Debug, Default)]
struct StageSet {
    base: Option<StageEntry>,
    current: Option<StageEntry>,
    incoming: Option<StageEntry>,
}

#[derive(Debug)]
struct BoundedBytes {
    bytes: Vec<u8>,
    truncated: bool,
}

#[derive(Debug)]
struct WorktreeRead {
    bytes: Vec<u8>,
    content_hash: String,
    truncated: bool,
    contains_markers: bool,
    exact: bool,
}

#[derive(Debug)]
pub(crate) struct VerifiedWorktree {
    pub(crate) contains_markers: bool,
}

pub(crate) fn load(
    git: &GitExecutor,
    root: &Path,
    repo_id: &str,
    path: &str,
    operation_state: &OperationState,
    control: Option<&RunControl>,
) -> WorkspaceResult<(ConflictDocument, ConflictSession)> {
    let stages_output = git
        .run(
            Some(root),
            GitCommand::Unmerged {
                path: Some(path.to_owned()),
            },
            None,
            control,
        )?
        .ensure_success()?;
    let stages = parse_stages(&stages_output.stdout, path)?;
    if stages.base.is_none() && stages.current.is_none() && stages.incoming.is_none() {
        return Err(WorkspaceError::new(
            ErrorCode::InvalidRequest,
            "The selected path is not conflicted",
        ));
    }

    let attributes = git
        .run(
            Some(root),
            GitCommand::CheckConflictAttributes {
                path: path.to_owned(),
            },
            None,
            control,
        )?
        .ensure_success()?;
    let attributes = parse_conflict_attributes(&attributes.stdout, path)?;

    let base_bytes = read_stage(git, root, stages.base.as_ref(), control)?;
    let current_bytes = read_stage(git, root, stages.current.as_ref(), control)?;
    let incoming_bytes = read_stage(git, root, stages.incoming.as_ref(), control)?;
    let worktree_path = checked_worktree_path(root, path)?;
    let result_read = read_worktree_entry_for_query(
        &worktree_path,
        MAX_EDIT_BYTES,
        attributes.marker_size,
        control,
    )?;
    let content_hash_exact = result_read.exact;
    let result_bytes = result_read.bytes;

    let content_hash = result_read.content_hash;
    let operation = conflict_operation(operation_state)?;
    let labels = labels(operation);
    let generation = generation(
        path,
        operation,
        &stages,
        &content_hash,
        attributes.marker_size,
    );
    let all_bytes = [
        base_bytes.as_ref().map(|value| value.bytes.as_slice()),
        current_bytes.as_ref().map(|value| value.bytes.as_slice()),
        incoming_bytes.as_ref().map(|value| value.bytes.as_slice()),
        Some(result_bytes.as_slice()),
    ];
    let truncated = result_read.truncated
        || [&base_bytes, &current_bytes, &incoming_bytes]
            .into_iter()
            .flatten()
            .any(|value| value.truncated);
    let modes = [
        stages.base.as_ref().map(|value| value.mode.as_str()),
        stages.current.as_ref().map(|value| value.mode.as_str()),
        stages.incoming.as_ref().map(|value| value.mode.as_str()),
    ];
    let (kind, result_text, performance_view, in_app_edit) = classify(
        &stages,
        &modes,
        &all_bytes,
        &result_bytes,
        attributes.binary,
        truncated,
    );
    let in_app_edit = in_app_edit && attributes.marker_size.is_some();
    let blocks = if in_app_edit && kind == ConflictKind::Text {
        parse_blocks(
            &result_text,
            &generation,
            attributes
                .marker_size
                .unwrap_or(DEFAULT_CONFLICT_MARKER_SIZE),
        )
    } else {
        Vec::new()
    };
    let whole_file_choice = matches!(kind, ConflictKind::AddAdd | ConflictKind::ModifyDelete);
    let capabilities = ConflictCapabilities {
        in_app_edit,
        performance_view,
        choose_current: in_app_edit || (whole_file_choice && stages.current.is_some()),
        choose_incoming: in_app_edit || (whole_file_choice && stages.incoming.is_some()),
        choose_both: in_app_edit
            || (whole_file_choice && stages.current.is_some() && stages.incoming.is_some()),
        delete: kind == ConflictKind::ModifyDelete,
        external_editor: !in_app_edit,
    };
    let session_id = Uuid::new_v4().to_string();
    let related_paths = vec![path.to_owned()];
    let document = ConflictDocument {
        session_id: session_id.clone(),
        repo_id: repo_id.to_owned(),
        path: path.to_owned(),
        operation,
        conflict_generation: generation.clone(),
        content_hash: content_hash.clone(),
        labels,
        sides: ConflictSides {
            base: make_side(stages.base.as_ref(), base_bytes),
            current: make_side(stages.current.as_ref(), current_bytes),
            incoming: make_side(stages.incoming.as_ref(), incoming_bytes),
        },
        result: ConflictResult {
            text: result_text,
            line_ending: line_ending(&result_bytes),
        },
        blocks,
        kind,
        capabilities,
        related_paths: related_paths.clone(),
    };
    let document_revision = hash_bytes(document.result.text.as_bytes());
    let revision_history =
        initial_revision_history(&document.result.text, &document.blocks, &document_revision);
    let session = ConflictSession {
        id: session_id,
        path: path.to_owned(),
        related_paths,
        generation,
        content_hash,
        content_hash_exact,
        draft_text: document.result.text.clone(),
        blocks: document.blocks.clone(),
        document_revision,
        revision_history,
        marker_size: attributes.marker_size,
        kind: document.kind,
        in_app_edit,
        resolution_evidence: false,
        external_baseline_hash: None,
    };
    Ok((document, session))
}

fn conflict_operation(state: &OperationState) -> WorkspaceResult<ConflictOperation> {
    match state {
        OperationState::Merge { .. } => Ok(ConflictOperation::Merge),
        OperationState::Rebase => Ok(ConflictOperation::Rebase),
        OperationState::CherryPick { .. } => Ok(ConflictOperation::CherryPick),
        OperationState::Revert { .. } => Ok(ConflictOperation::Revert),
        _ => Err(WorkspaceError::new(
            ErrorCode::UnsupportedRepository,
            "Unable to determine the conflict operation",
        )),
    }
}

fn labels(operation: ConflictOperation) -> ConflictLabels {
    match operation {
        ConflictOperation::Merge => ConflictLabels {
            current: LocalizedMessage::new("conflictCurrentBranch"),
            incoming: LocalizedMessage::new("conflictMergedBranch"),
        },
        ConflictOperation::Rebase => ConflictLabels {
            current: LocalizedMessage::new("conflictRebaseDestination"),
            incoming: LocalizedMessage::new("conflictReplayedCommit"),
        },
        ConflictOperation::CherryPick => ConflictLabels {
            current: LocalizedMessage::new("conflictCurrentBranch"),
            incoming: LocalizedMessage::new("conflictCherryPickedCommit"),
        },
        ConflictOperation::Revert => ConflictLabels {
            current: LocalizedMessage::new("conflictCurrentBranch"),
            incoming: LocalizedMessage::new("conflictRevertResult"),
        },
    }
}

fn classify(
    stages: &StageSet,
    modes: &[Option<&str>],
    all_bytes: &[Option<&[u8]>],
    result_bytes: &[u8],
    binary_attribute: bool,
    truncated: bool,
) -> (ConflictKind, String, bool, bool) {
    if modes.iter().flatten().any(|mode| *mode == "160000") {
        return (ConflictKind::Submodule, String::new(), false, false);
    }
    if modes.iter().flatten().any(|mode| *mode == "120000") {
        return (ConflictKind::Symlink, String::new(), false, false);
    }
    match (
        stages.base.is_some(),
        stages.current.is_some(),
        stages.incoming.is_some(),
    ) {
        (true, false, false) => {
            return (ConflictKind::RenameRename, String::new(), false, false);
        }
        (false, true, false) | (false, false, true) | (false, false, false) => {
            return (ConflictKind::DirectoryFile, String::new(), false, false);
        }
        _ => {}
    }
    if truncated {
        return (ConflictKind::Oversize, String::new(), false, false);
    }
    if binary_attribute {
        return (ConflictKind::Binary, String::new(), false, false);
    }
    if all_bytes.iter().flatten().any(|bytes| bytes.contains(&0)) {
        return (ConflictKind::Nul, String::new(), false, false);
    }
    if all_bytes
        .iter()
        .flatten()
        .any(|bytes| std::str::from_utf8(bytes).is_err())
    {
        return (ConflictKind::NonUtf8, String::new(), false, false);
    }

    let result = String::from_utf8(result_bytes.to_vec()).unwrap_or_default();
    let metrics = text_metrics(&result);
    let performance = result_bytes.len() <= MAX_EDIT_BYTES
        && metrics.lines <= MAX_EDIT_LINES
        && metrics.longest_line <= MAX_EDIT_LONGEST_LINE;
    let normal_mode = result_bytes.len() <= EDIT_BYTES && metrics.lines <= EDIT_LINES;
    if !performance {
        return (ConflictKind::Oversize, result, false, false);
    }
    if stages.base.is_none() && stages.current.is_some() && stages.incoming.is_some() {
        return (ConflictKind::AddAdd, result, !normal_mode, false);
    }
    if stages.current.is_none() || stages.incoming.is_none() {
        return (ConflictKind::ModifyDelete, result, !normal_mode, false);
    }
    if !compatible_line_endings(all_bytes) {
        return (ConflictKind::Text, result, false, false);
    }
    (ConflictKind::Text, result, !normal_mode, true)
}

fn compatible_line_endings(all_bytes: &[Option<&[u8]>]) -> bool {
    let mut combined = NewlineStyle::Neutral;
    for bytes in all_bytes.iter().flatten() {
        let style = newline_style(bytes);
        if style == NewlineStyle::Invalid {
            return false;
        }
        if style == NewlineStyle::Neutral {
            continue;
        }
        if combined != NewlineStyle::Neutral && combined != style {
            return false;
        }
        combined = style;
    }
    true
}

fn parse_conflict_attributes(
    bytes: &[u8],
    requested_path: &str,
) -> WorkspaceResult<ConflictAttributes> {
    let fields: Vec<&[u8]> = bytes
        .split(|byte| *byte == 0)
        .filter(|field| !field.is_empty())
        .collect();
    if !fields.len().is_multiple_of(3) {
        return Err(WorkspaceError::new(
            ErrorCode::GitFailed,
            "Failed to parse the Git attributes response",
        ));
    }
    let mut result = ConflictAttributes {
        binary: false,
        marker_size: Some(DEFAULT_CONFLICT_MARKER_SIZE),
    };
    for record in fields.chunks_exact(3) {
        if record[0] != requested_path.as_bytes() {
            continue;
        }
        let attribute = record[1];
        let value = record[2];
        if (attribute == b"binary" && value == b"set")
            || ((attribute == b"diff" || attribute == b"merge" || attribute == b"text")
                && value == b"unset")
            || ((attribute == b"diff" || attribute == b"merge") && value == b"binary")
        {
            result.binary = true;
        }
        if attribute == b"conflict-marker-size" {
            result.marker_size = if value == b"unspecified" {
                Some(DEFAULT_CONFLICT_MARKER_SIZE)
            } else {
                std::str::from_utf8(value)
                    .ok()
                    .and_then(|value| value.parse::<usize>().ok())
                    .filter(|size| *size >= MIN_CONFLICT_MARKER_SIZE)
            };
        }
    }
    Ok(result)
}

fn make_side(entry: Option<&StageEntry>, material: Option<BoundedBytes>) -> Option<ConflictSide> {
    let entry = entry?;
    Some(ConflictSide {
        oid: entry.oid.clone(),
        mode: entry.mode.clone(),
        text: material
            .filter(|value| !value.truncated)
            .and_then(|value| String::from_utf8(value.bytes).ok()),
    })
}

fn parse_stages(bytes: &[u8], requested_path: &str) -> WorkspaceResult<StageSet> {
    let mut stages = StageSet::default();
    for record in bytes
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
    {
        let Some(tab) = record.iter().position(|byte| *byte == b'\t') else {
            continue;
        };
        let metadata = std::str::from_utf8(&record[..tab]).map_err(|_| {
            WorkspaceError::new(
                ErrorCode::GitFailed,
                "Index stage metadata is not valid UTF-8",
            )
        })?;
        let path = std::str::from_utf8(&record[tab + 1..]).map_err(|_| {
            WorkspaceError::new(
                ErrorCode::UnsupportedRepository,
                "Non-UTF-8 paths are not supported",
            )
        })?;
        if path != requested_path {
            continue;
        }
        let mut fields = metadata.split_whitespace();
        let mode = fields.next().unwrap_or_default().to_owned();
        let oid = fields.next().unwrap_or_default().to_owned();
        let stage = fields.next().unwrap_or_default();
        let entry = StageEntry { mode, oid };
        match stage {
            "1" => stages.base = Some(entry),
            "2" => stages.current = Some(entry),
            "3" => stages.incoming = Some(entry),
            _ => {}
        }
    }
    Ok(stages)
}

fn read_stage(
    git: &GitExecutor,
    root: &Path,
    entry: Option<&StageEntry>,
    control: Option<&RunControl>,
) -> WorkspaceResult<Option<BoundedBytes>> {
    let Some(entry) = entry else {
        return Ok(None);
    };
    if entry.mode == "160000" {
        return Ok(Some(BoundedBytes {
            bytes: Vec::new(),
            truncated: false,
        }));
    }
    let size_output = git
        .run(
            Some(root),
            GitCommand::CatFileSize {
                oid: entry.oid.clone(),
            },
            None,
            control,
        )?
        .ensure_success()?;
    let size = size_output
        .stdout_text()
        .trim()
        .parse::<u64>()
        .map_err(|_| WorkspaceError::new(ErrorCode::GitFailed, "Failed to parse Git blob size"))?;
    if size > MAX_EDIT_BYTES as u64 {
        return Ok(Some(BoundedBytes {
            bytes: Vec::new(),
            truncated: true,
        }));
    }
    let output = git
        .run(
            Some(root),
            GitCommand::CatFile {
                oid: entry.oid.clone(),
            },
            None,
            control,
        )?
        .ensure_success()?;
    if output.truncated || output.stdout.len() as u64 != size {
        return Err(WorkspaceError::new(
            ErrorCode::GitFailed,
            "Failed to read the complete Git blob",
        ));
    }
    Ok(Some(BoundedBytes {
        bytes: output.stdout,
        truncated: false,
    }))
}

fn generation(
    path: &str,
    operation: ConflictOperation,
    stages: &StageSet,
    result_hash: &str,
    marker_size: Option<usize>,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.as_bytes());
    hasher.update(format!("{operation:?}").as_bytes());
    for entry in [&stages.base, &stages.current, &stages.incoming] {
        if let Some(entry) = entry {
            hasher.update(entry.mode.as_bytes());
            hasher.update(entry.oid.as_bytes());
        }
        hasher.update([0]);
    }
    hasher.update(result_hash.as_bytes());
    match marker_size {
        Some(size) => hasher.update(size.to_le_bytes()),
        None => hasher.update(b"invalid-marker-size"),
    }
    hex_bytes(&hasher.finalize())
}

fn line_ending(bytes: &[u8]) -> LineEnding {
    if bytes.windows(2).any(|window| window == b"\r\n") {
        LineEnding::Crlf
    } else {
        LineEnding::Lf
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MarkerLineKind {
    Start,
    Base,
    Separator,
    End,
    Other,
}

fn marker_line_kind(line: &[u8], marker_size: usize) -> MarkerLineKind {
    if marker_size < MIN_CONFLICT_MARKER_SIZE {
        return MarkerLineKind::Other;
    }
    if labeled_marker_line(line, marker_size, b'<') {
        MarkerLineKind::Start
    } else if labeled_marker_line(line, marker_size, b'|') {
        MarkerLineKind::Base
    } else if line.len() == marker_size && line.iter().all(|byte| *byte == b'=') {
        MarkerLineKind::Separator
    } else if labeled_marker_line(line, marker_size, b'>') {
        MarkerLineKind::End
    } else {
        MarkerLineKind::Other
    }
}

fn labeled_marker_line(line: &[u8], marker_size: usize, marker: u8) -> bool {
    line.len() >= marker_size
        && line[..marker_size].iter().all(|byte| *byte == marker)
        && match line.get(marker_size) {
            None => true,
            Some(b' ' | b'\t') => true,
            Some(_) => false,
        }
}

fn parse_blocks(text: &str, generation: &str, marker_size: usize) -> Vec<ConflictBlock> {
    let lines = line_spans(text);
    let mut blocks = Vec::new();
    let mut cursor = 0;
    while cursor < lines.len() {
        if marker_line_kind(lines[cursor].2.as_bytes(), marker_size) != MarkerLineKind::Start {
            cursor += 1;
            continue;
        }
        let start = cursor;
        let mut base_marker = None;
        let mut separator = None;
        let mut end = None;
        cursor += 1;
        while cursor < lines.len() {
            match marker_line_kind(lines[cursor].2.as_bytes(), marker_size) {
                MarkerLineKind::Base => base_marker = Some(cursor),
                MarkerLineKind::Separator => separator = Some(cursor),
                MarkerLineKind::End => {
                    end = Some(cursor);
                    break;
                }
                MarkerLineKind::Start | MarkerLineKind::Other => {}
            }
            cursor += 1;
        }
        let (Some(separator), Some(end)) = (separator, end) else {
            break;
        };
        let current_end = base_marker.unwrap_or(separator);
        let current = slice_lines(text, &lines, start + 1, current_end);
        let incoming = slice_lines(text, &lines, separator + 1, end);
        let from_byte = lines[start].0;
        let to_byte = lines[end].1;
        let from = text[..from_byte].encode_utf16().count() as u32;
        let to = text[..to_byte].encode_utf16().count() as u32;
        let id = hash_bytes(format!("{generation}:{from}:{to}").as_bytes());
        blocks.push(ConflictBlock {
            id,
            range_utf16: Utf16Range { from, to },
            replacements: ConflictReplacements {
                both: format!("{current}{incoming}"),
                current,
                incoming,
            },
            state: ConflictBlockState::Unresolved,
        });
        cursor = end + 1;
    }
    blocks
}

fn line_spans(text: &str) -> Vec<(usize, usize, &str)> {
    let mut result = Vec::new();
    let mut start = 0;
    for line in text.split_inclusive('\n') {
        let end = start + line.len();
        result.push((start, end, line.trim_end_matches(['\r', '\n'])));
        start = end;
    }
    if start < text.len() {
        result.push((start, text.len(), &text[start..]));
    }
    result
}

fn slice_lines(text: &str, lines: &[(usize, usize, &str)], start: usize, end: usize) -> String {
    if start >= end || start >= lines.len() {
        return String::new();
    }
    let from = lines[start].0;
    let to = lines[end - 1].1;
    text[from..to].to_owned()
}

pub(crate) fn save_result(
    root: &Path,
    session: &ConflictSession,
    expected_content_hash: &str,
    result: &[u8],
    control: Option<&RunControl>,
) -> WorkspaceResult<String> {
    if session.content_hash != expected_content_hash || !session.content_hash_exact {
        return Err(stale_conflict());
    }
    let result_text = std::str::from_utf8(result).map_err(|_| {
        WorkspaceError::new(ErrorCode::InvalidRequest, "The result must be UTF-8 text")
    })?;
    let metrics = text_metrics(result_text);
    if result.len() > MAX_EDIT_BYTES
        || metrics.lines > MAX_EDIT_LINES
        || metrics.longest_line > MAX_EDIT_LONGEST_LINE
        || newline_style(result) == NewlineStyle::Invalid
    {
        return Err(WorkspaceError::new(
            ErrorCode::InvalidRequest,
            "The result exceeds the in-app editing limits or uses unsupported line endings",
        ));
    }
    let path = checked_worktree_path(root, &session.path)?;
    let actual = read_worktree_entry_exact(&path, 0, session.marker_size, control)?;
    if actual.content_hash != expected_content_hash {
        return Err(stale_conflict());
    }
    atomic_write(root, &path, result)?;
    Ok(hash_bytes(result))
}

pub(crate) fn verify_saved_result(
    root: &Path,
    session: &ConflictSession,
    expected_content_hash: &str,
    control: Option<&RunControl>,
) -> WorkspaceResult<VerifiedWorktree> {
    if session.content_hash != expected_content_hash {
        return Err(stale_conflict());
    }
    let path = checked_worktree_path(root, &session.path)?;
    let actual = if session.content_hash_exact {
        let actual = read_worktree_entry_exact(&path, 0, session.marker_size, control)?;
        if actual.content_hash != expected_content_hash {
            return Err(stale_conflict());
        }
        actual
    } else {
        let before = worktree_metadata_fingerprint(&path)?;
        if before != expected_content_hash {
            return Err(stale_conflict());
        }
        let actual = read_worktree_entry_exact(&path, 0, session.marker_size, control)?;
        if worktree_metadata_fingerprint(&path)? != before {
            return Err(stale_conflict());
        }
        actual
    };
    Ok(VerifiedWorktree {
        contains_markers: actual.contains_markers,
    })
}

pub(crate) fn verify_saved_result_identity(
    root: &Path,
    session: &ConflictSession,
    expected_content_hash: &str,
    control: Option<&RunControl>,
) -> WorkspaceResult<()> {
    if session.content_hash != expected_content_hash {
        return Err(stale_conflict());
    }
    let path = checked_worktree_path(root, &session.path)?;
    let actual = if session.content_hash_exact {
        read_worktree_entry_exact(&path, 0, session.marker_size, control)?.content_hash
    } else {
        worktree_metadata_fingerprint(&path)?
    };
    if actual != expected_content_hash {
        return Err(stale_conflict());
    }
    Ok(())
}

pub(crate) fn worktree_entry_exists(
    root: &Path,
    session: &ConflictSession,
) -> WorkspaceResult<bool> {
    let path = checked_worktree_path(root, &session.path)?;
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(io_error(error)),
    }
}

fn initial_revision_history(
    draft_text: &str,
    blocks: &[ConflictBlock],
    document_revision: &str,
) -> VecDeque<ConflictRevisionSnapshot> {
    VecDeque::from([make_revision_snapshot(
        draft_text,
        blocks,
        document_revision,
    )])
}

fn utf16_storage_charge(value: &str) -> usize {
    value.encode_utf16().count().saturating_mul(4)
}

fn make_revision_snapshot(
    draft_text: &str,
    blocks: &[ConflictBlock],
    document_revision: &str,
) -> ConflictRevisionSnapshot {
    let blocks = blocks
        .iter()
        .map(|block| ConflictBlockRevision {
            id: block.id.clone(),
            range_utf16: block.range_utf16,
            state: block.state,
        })
        .collect::<Vec<_>>();
    let charged_bytes = blocks.iter().fold(
        REVISION_SNAPSHOT_OVERHEAD_BYTES.saturating_add(utf16_storage_charge(draft_text)),
        |bytes, block| {
            bytes
                .saturating_add(REVISION_BLOCK_OVERHEAD_BYTES)
                .saturating_add(utf16_storage_charge(&block.id))
        },
    );
    ConflictRevisionSnapshot {
        draft_text: draft_text.to_owned(),
        blocks,
        document_revision: document_revision.to_owned(),
        charged_bytes,
    }
}

fn revision_history_charged_bytes(history: &VecDeque<ConflictRevisionSnapshot>) -> usize {
    history.iter().fold(0_usize, |bytes, snapshot| {
        bytes.saturating_add(snapshot.charged_bytes)
    })
}

fn trim_revision_history(history: &mut VecDeque<ConflictRevisionSnapshot>) {
    let mut charged_bytes = revision_history_charged_bytes(history);
    while history.len() > 1
        && (history.len() > REVISION_HISTORY_LIMIT || charged_bytes > REVISION_HISTORY_BYTE_BUDGET)
    {
        if let Some(removed) = history.pop_front() {
            charged_bytes = charged_bytes.saturating_sub(removed.charged_bytes);
        }
    }
}

fn record_revision_snapshot(session: &mut ConflictSession) {
    let snapshot = make_revision_snapshot(
        &session.draft_text,
        &session.blocks,
        &session.document_revision,
    );
    if session.revision_history.back() == Some(&snapshot) {
        return;
    }
    session.revision_history.push_back(snapshot);
    trim_revision_history(&mut session.revision_history);
}

fn restore_snapshot(session: &mut ConflictSession, snapshot: ConflictRevisionSnapshot) -> bool {
    if session.blocks.len() != snapshot.blocks.len()
        || session
            .blocks
            .iter()
            .zip(&snapshot.blocks)
            .any(|(block, revision)| block.id != revision.id)
    {
        return false;
    }
    for (block, revision) in session.blocks.iter_mut().zip(snapshot.blocks) {
        block.range_utf16 = revision.range_utf16;
        block.state = revision.state;
    }
    session.draft_text = snapshot.draft_text;
    session.document_revision = snapshot.document_revision;
    true
}

fn restore_revision_snapshot(
    session: &mut ConflictSession,
    document_revision: &str,
    draft_text: &str,
) -> bool {
    let snapshot = session
        .revision_history
        .iter()
        .rev()
        .find(|snapshot| {
            snapshot.document_revision == document_revision && snapshot.draft_text == draft_text
        })
        .cloned();
    let Some(snapshot) = snapshot else {
        return false;
    };
    restore_snapshot(session, snapshot)
}

fn restore_base_revision_snapshot(
    session: &mut ConflictSession,
    base_document_revision: &str,
) -> bool {
    let snapshot = session
        .revision_history
        .iter()
        .rev()
        .find(|snapshot| snapshot.document_revision == base_document_revision)
        .cloned();
    let Some(snapshot) = snapshot else {
        return false;
    };
    restore_snapshot(session, snapshot)
}

pub(crate) fn apply_block_choice(
    session: &mut ConflictSession,
    request: BlockChoiceRequest<'_>,
) -> WorkspaceResult<ConflictEditResult> {
    if session.generation != request.generation || session.content_hash != request.content_hash {
        return Err(stale_conflict());
    }
    if hash_bytes(request.draft_text.as_bytes()) != request.document_revision {
        return Err(WorkspaceError::new(
            ErrorCode::InvalidRequest,
            "documentRevision does not match draftText",
        ));
    }
    let mut candidate = session.clone();
    let edit = apply_block_choice_validated(
        &mut candidate,
        request.document_revision,
        request.base_document_revision,
        request.block_id,
        request.draft_text,
        request.choice,
    )?;
    *session = candidate;
    Ok(edit)
}

fn apply_block_choice_validated(
    session: &mut ConflictSession,
    document_revision: &str,
    base_document_revision: &str,
    block_id: &str,
    draft_text: &str,
    choice: ConflictChoice,
) -> WorkspaceResult<ConflictEditResult> {
    let exact_current_revision =
        session.document_revision == document_revision && session.draft_text == draft_text;
    if !exact_current_revision && !restore_revision_snapshot(session, document_revision, draft_text)
    {
        if !restore_base_revision_snapshot(session, base_document_revision) {
            return Err(WorkspaceError::new(
                ErrorCode::ConflictStateChanged,
                "The base for the manual edit is stale. Reload the conflict",
            ));
        }
        sync_manual_edit(session, draft_text)?;
        record_revision_snapshot(session);
    }

    let block_index = session
        .blocks
        .iter()
        .position(|block| block.id == block_id)
        .ok_or_else(stale_conflict)?;
    if session.blocks[block_index].state == ConflictBlockState::Manual {
        return Err(WorkspaceError::new(
            ErrorCode::ConflictStateChanged,
            "A choice cannot be applied to a block that overlaps a manual edit",
        ));
    }
    let block = session.blocks[block_index].clone();
    let (replacement, state) = match choice {
        ConflictChoice::Current => (block.replacements.current, ConflictBlockState::Current),
        ConflictChoice::Incoming => (block.replacements.incoming, ConflictBlockState::Incoming),
        ConflictChoice::Both => (block.replacements.both, ConflictBlockState::Both),
        ConflictChoice::Delete => {
            return Err(WorkspaceError::new(
                ErrorCode::InvalidRequest,
                "Delete is only available for whole-file conflicts",
            ));
        }
    };
    let from = utf16_to_byte(&session.draft_text, block.range_utf16.from)?;
    let to = utf16_to_byte(&session.draft_text, block.range_utf16.to)?;
    session.draft_text.replace_range(from..to, &replacement);
    let old_to = block.range_utf16.to;
    let replacement_units = replacement.encode_utf16().count() as i64;
    let old_units = i64::from(block.range_utf16.to - block.range_utf16.from);
    let delta = replacement_units - old_units;
    session.blocks[block_index].range_utf16.to =
        (i64::from(block.range_utf16.from) + replacement_units) as u32;
    session.blocks[block_index].state = state;
    for (index, candidate) in session.blocks.iter_mut().enumerate() {
        if index == block_index {
            continue;
        }
        if candidate.range_utf16.from >= old_to {
            shift_range(&mut candidate.range_utf16, delta)?;
        } else if candidate.range_utf16.to > block.range_utf16.from {
            candidate.state = ConflictBlockState::Manual;
        }
    }
    session.document_revision = hash_bytes(session.draft_text.as_bytes());
    record_revision_snapshot(session);
    Ok(ConflictEditResult {
        text: session.draft_text.clone(),
        blocks: session.blocks.clone(),
        document_revision: session.document_revision.clone(),
    })
}

fn sync_manual_edit(session: &mut ConflictSession, draft_text: &str) -> WorkspaceResult<()> {
    let old: Vec<u16> = session.draft_text.encode_utf16().collect();
    let new: Vec<u16> = draft_text.encode_utf16().collect();
    let prefix = old
        .iter()
        .zip(new.iter())
        .take_while(|(left, right)| left == right)
        .count();
    let max_suffix = old
        .len()
        .saturating_sub(prefix)
        .min(new.len().saturating_sub(prefix));
    let suffix = old
        .iter()
        .rev()
        .zip(new.iter().rev())
        .take(max_suffix)
        .take_while(|(left, right)| left == right)
        .count();
    let old_end = old.len() - suffix;
    let new_end = new.len() - suffix;
    let delta = new_end as i64 - old_end as i64;
    for block in &mut session.blocks {
        let from = block.range_utf16.from as usize;
        let to = block.range_utf16.to as usize;
        if from >= old_end {
            shift_range(&mut block.range_utf16, delta)?;
        } else if to > prefix {
            block.state = ConflictBlockState::Manual;
        }
    }
    session.draft_text = draft_text.to_owned();
    session.document_revision = hash_bytes(draft_text.as_bytes());
    Ok(())
}

fn shift_range(range: &mut Utf16Range, delta: i64) -> WorkspaceResult<()> {
    let from = i64::from(range.from) + delta;
    let to = i64::from(range.to) + delta;
    if from < 0 || to < from || to > i64::from(u32::MAX) {
        return Err(stale_conflict());
    }
    range.from = from as u32;
    range.to = to as u32;
    Ok(())
}

fn utf16_to_byte(text: &str, target: u32) -> WorkspaceResult<usize> {
    if target == 0 {
        return Ok(0);
    }
    let mut units = 0_u32;
    for (byte, ch) in text.char_indices() {
        if units == target {
            return Ok(byte);
        }
        units += ch.len_utf16() as u32;
        if units > target {
            return Err(stale_conflict());
        }
    }
    if units == target {
        Ok(text.len())
    } else {
        Err(stale_conflict())
    }
}

pub(crate) fn materialize(
    git: &GitExecutor,
    root: &Path,
    session: &ConflictSession,
    choice: ConflictChoice,
    control: Option<&RunControl>,
) -> WorkspaceResult<()> {
    let output = git
        .run(
            Some(root),
            GitCommand::Unmerged {
                path: Some(session.path.clone()),
            },
            None,
            control,
        )?
        .ensure_success()?;
    let stages = parse_stages(&output.stdout, &session.path)?;
    let path = checked_worktree_path(root, &session.path)?;
    match choice {
        ConflictChoice::Delete => match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(io_error(error)),
        },
        ConflictChoice::Current | ConflictChoice::Incoming | ConflictChoice::Both => {
            let current_mode = stages.current.as_ref().map(|entry| entry.mode.clone());
            let incoming_mode = stages.incoming.as_ref().map(|entry| entry.mode.clone());
            let current = read_stage(git, root, stages.current.as_ref(), control)?;
            let incoming = read_stage(git, root, stages.incoming.as_ref(), control)?;
            let (bytes, mode) = match choice {
                ConflictChoice::Current => (
                    current.ok_or_else(missing_side)?.bytes,
                    current_mode.ok_or_else(missing_side)?,
                ),
                ConflictChoice::Incoming => (
                    incoming.ok_or_else(missing_side)?.bytes,
                    incoming_mode.ok_or_else(missing_side)?,
                ),
                ConflictChoice::Both => {
                    let mut both = current.ok_or_else(missing_side)?.bytes;
                    both.extend(incoming.ok_or_else(missing_side)?.bytes);
                    // `Both`は`Current`、`Incoming`の順で連結するため、実行権限も`Current`側を継承する。
                    (both, current_mode.ok_or_else(missing_side)?)
                }
                ConflictChoice::Delete => unreachable!(),
            };
            atomic_write_with_stage_mode(root, &path, &bytes, &mode)
        }
    }
}

pub(crate) fn open_external(
    root: &Path,
    session: &ConflictSession,
    editor: &ExternalEditor,
) -> WorkspaceResult<()> {
    let path = checked_worktree_path(root, &session.path)?;
    let mut command = Command::new("/usr/bin/open");
    if fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        // エディタが任意の外部参照先をたどらないよう、リンク自体をFinderに表示する。
        command.arg("-R");
    } else {
        match editor.kind {
            ExternalEditorKind::SystemDefault => {}
            ExternalEditorKind::TextEdit => {
                command.args(["-a", "TextEdit"]);
            }
            ExternalEditorKind::VisualStudioCode => {
                command.args(["-a", "Visual Studio Code"]);
            }
        }
    }
    command
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(io_error)?;
    Ok(())
}

pub(crate) fn contains_conflict_markers(bytes: &[u8], marker_size: Option<usize>) -> bool {
    let mut scanner = MarkerScanner::new(marker_size);
    scanner.push(bytes);
    scanner.finish();
    scanner.found
}

pub(crate) fn validate_session(
    session: &ConflictSession,
    session_id: &str,
    generation: &str,
) -> WorkspaceResult<()> {
    if session.id != session_id || session.generation != generation {
        return Err(stale_conflict());
    }
    Ok(())
}

fn atomic_write_with_stage_mode(
    root: &Path,
    path: &Path,
    bytes: &[u8],
    stage_mode: &str,
) -> WorkspaceResult<()> {
    let executable = match stage_mode {
        "100644" => false,
        "100755" => true,
        _ => {
            return Err(WorkspaceError::new(
                ErrorCode::UnsupportedRepository,
                "The file mode for the whole-file choice cannot be applied safely",
            ));
        }
    };
    atomic_write_with_mode(root, path, bytes, Some(executable))
}

fn read_worktree_entry_for_query(
    path: &Path,
    retain_limit: usize,
    marker_size: Option<usize>,
    control: Option<&RunControl>,
) -> WorkspaceResult<WorktreeRead> {
    if control.is_some_and(RunControl::is_cancelled) {
        return Err(cancelled_error());
    }
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            let target = fs::read_link(path).map_err(io_error)?;
            Ok(scan_worktree_bytes(
                target.as_os_str().as_bytes(),
                retain_limit,
                marker_size,
            ))
        }
        Ok(metadata) if metadata.is_file() => {
            let before = worktree_metadata_fingerprint(path)?;
            if metadata.len() > retain_limit as u64 {
                return Ok(oversize_worktree_read(before, marker_size));
            }
            let file = File::open(path).map_err(io_error)?;
            let read = scan_worktree_reader_limited(file, retain_limit, marker_size, control)?;
            let after = worktree_metadata_fingerprint(path)?;
            if before != after {
                return Err(stale_conflict());
            }
            if read.truncated {
                Ok(oversize_worktree_read(after, marker_size))
            } else {
                Ok(read)
            }
        }
        Ok(_) => Ok(scan_worktree_bytes(&[], retain_limit, marker_size)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(scan_worktree_bytes(&[], retain_limit, marker_size))
        }
        Err(error) => Err(io_error(error)),
    }
}

fn read_worktree_entry_exact(
    path: &Path,
    retain_limit: usize,
    marker_size: Option<usize>,
    control: Option<&RunControl>,
) -> WorkspaceResult<WorktreeRead> {
    if control.is_some_and(RunControl::is_cancelled) {
        return Err(cancelled_error());
    }
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            let target = fs::read_link(path).map_err(io_error)?;
            Ok(scan_worktree_bytes(
                target.as_os_str().as_bytes(),
                retain_limit,
                marker_size,
            ))
        }
        Ok(metadata) if metadata.is_file() => {
            let file = File::open(path).map_err(io_error)?;
            scan_worktree_reader(file, retain_limit, marker_size, control)
        }
        Ok(_) => Ok(scan_worktree_bytes(&[], retain_limit, marker_size)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(scan_worktree_bytes(&[], retain_limit, marker_size))
        }
        Err(error) => Err(io_error(error)),
    }
}

fn oversize_worktree_read(content_hash: String, marker_size: Option<usize>) -> WorktreeRead {
    WorktreeRead {
        bytes: Vec::new(),
        content_hash,
        truncated: true,
        contains_markers: marker_size.is_none(),
        exact: false,
    }
}

fn worktree_metadata_fingerprint(path: &Path) -> WorkspaceResult<String> {
    let mut fingerprint = Sha256::new();
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            fingerprint.update(b"metadata\0");
            fingerprint.update(metadata.dev().to_le_bytes());
            fingerprint.update(metadata.ino().to_le_bytes());
            fingerprint.update(metadata.mode().to_le_bytes());
            fingerprint.update(metadata.len().to_le_bytes());
            fingerprint.update(metadata.mtime().to_le_bytes());
            fingerprint.update(metadata.mtime_nsec().to_le_bytes());
            fingerprint.update(metadata.ctime().to_le_bytes());
            fingerprint.update(metadata.ctime_nsec().to_le_bytes());
            if metadata.file_type().is_symlink() {
                fingerprint.update(b"symlink\0");
                fingerprint.update(
                    fs::read_link(path)
                        .map_err(io_error)?
                        .as_os_str()
                        .as_bytes(),
                );
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fingerprint.update(b"missing\0");
        }
        Err(error) => return Err(io_error(error)),
    }
    Ok(format!("metadata:{}", hex_bytes(&fingerprint.finalize())))
}

fn scan_worktree_bytes(
    bytes: &[u8],
    retain_limit: usize,
    marker_size: Option<usize>,
) -> WorktreeRead {
    let retained = bytes[..bytes.len().min(retain_limit)].to_vec();
    WorktreeRead {
        bytes: retained,
        content_hash: hash_bytes(bytes),
        truncated: bytes.len() > retain_limit,
        contains_markers: contains_conflict_markers(bytes, marker_size),
        exact: true,
    }
}

fn scan_worktree_reader(
    mut reader: impl Read,
    retain_limit: usize,
    marker_size: Option<usize>,
    control: Option<&RunControl>,
) -> WorkspaceResult<WorktreeRead> {
    let mut retained = Vec::with_capacity(retain_limit.min(64 * 1024));
    let mut hasher = Sha256::new();
    let mut markers = MarkerScanner::new(marker_size);
    let mut total = 0_usize;
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        if control.is_some_and(RunControl::is_cancelled) {
            return Err(cancelled_error());
        }
        let count = reader.read(&mut buffer).map_err(io_error)?;
        if count == 0 {
            break;
        }
        let chunk = &buffer[..count];
        hasher.update(chunk);
        markers.push(chunk);
        total = total.saturating_add(count);
        let remaining = retain_limit.saturating_sub(retained.len());
        if remaining > 0 {
            retained.extend_from_slice(&chunk[..count.min(remaining)]);
        }
    }
    markers.finish();
    Ok(WorktreeRead {
        bytes: retained,
        content_hash: hex_bytes(&hasher.finalize()),
        truncated: total > retain_limit,
        contains_markers: markers.found,
        exact: true,
    })
}

fn scan_worktree_reader_limited(
    mut reader: impl Read,
    retain_limit: usize,
    marker_size: Option<usize>,
    control: Option<&RunControl>,
) -> WorkspaceResult<WorktreeRead> {
    let mut retained = Vec::with_capacity(retain_limit.min(64 * 1024));
    let mut hasher = Sha256::new();
    let mut markers = MarkerScanner::new(marker_size);
    let mut total = 0_usize;
    let mut buffer = [0_u8; 16 * 1024];
    while total <= retain_limit {
        if control.is_some_and(RunControl::is_cancelled) {
            return Err(cancelled_error());
        }
        let remaining_to_probe = retain_limit.saturating_add(1).saturating_sub(total);
        let read_limit = buffer.len().min(remaining_to_probe);
        let count = reader.read(&mut buffer[..read_limit]).map_err(io_error)?;
        if count == 0 {
            break;
        }
        let chunk = &buffer[..count];
        hasher.update(chunk);
        markers.push(chunk);
        total = total.saturating_add(count);
        let remaining = retain_limit.saturating_sub(retained.len());
        if remaining > 0 {
            retained.extend_from_slice(&chunk[..count.min(remaining)]);
        }
    }
    markers.finish();
    Ok(WorktreeRead {
        bytes: retained,
        content_hash: hex_bytes(&hasher.finalize()),
        truncated: total > retain_limit,
        contains_markers: markers.found,
        exact: total <= retain_limit,
    })
}

struct MarkerScanner {
    marker_size: Option<usize>,
    line: MarkerLineProbe,
    found: bool,
}

impl MarkerScanner {
    fn new(marker_size: Option<usize>) -> Self {
        Self {
            marker_size,
            line: MarkerLineProbe::Empty,
            found: marker_size.is_none(),
        }
    }

    fn push(&mut self, bytes: &[u8]) {
        let Some(marker_size) = self.marker_size else {
            return;
        };
        for byte in bytes {
            if *byte == b'\n' {
                self.finish_line(marker_size);
                continue;
            }
            self.line.push(*byte, marker_size);
        }
    }

    fn finish(&mut self) {
        if let Some(marker_size) = self.marker_size
            && self.line != MarkerLineProbe::Empty
        {
            self.finish_line(marker_size);
        }
    }

    fn finish_line(&mut self, marker_size: usize) {
        let line = std::mem::replace(&mut self.line, MarkerLineProbe::Empty);
        let kind = line.kind(marker_size);
        self.found |= matches!(kind, MarkerLineKind::Start | MarkerLineKind::End);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MarkerLineProbe {
    Empty,
    Run { marker: u8, count: usize },
    Labeled { marker: u8 },
    TrailingCarriageReturn { marker: u8 },
    Invalid,
}

impl MarkerLineProbe {
    fn push(&mut self, byte: u8, marker_size: usize) {
        *self = match *self {
            Self::Empty if matches!(byte, b'<' | b'|' | b'=' | b'>') => Self::Run {
                marker: byte,
                count: 1,
            },
            Self::Empty => Self::Invalid,
            Self::Run { marker, count } if byte == marker && count < marker_size => Self::Run {
                marker,
                count: count + 1,
            },
            Self::Run { marker, count }
                if count == marker_size && marker != b'=' && matches!(byte, b' ' | b'\t') =>
            {
                Self::Labeled { marker }
            }
            Self::Run { marker, count } if count == marker_size && byte == b'\r' => {
                Self::TrailingCarriageReturn { marker }
            }
            Self::Labeled { marker } => Self::Labeled { marker },
            Self::Run { .. } | Self::TrailingCarriageReturn { .. } | Self::Invalid => Self::Invalid,
        };
    }

    fn kind(self, marker_size: usize) -> MarkerLineKind {
        let marker = match self {
            Self::Run { marker, count } if count == marker_size => marker,
            Self::Labeled { marker } | Self::TrailingCarriageReturn { marker } => marker,
            Self::Empty | Self::Run { .. } | Self::Invalid => return MarkerLineKind::Other,
        };
        match marker {
            b'<' => MarkerLineKind::Start,
            b'|' => MarkerLineKind::Base,
            b'=' => MarkerLineKind::Separator,
            b'>' => MarkerLineKind::End,
            _ => MarkerLineKind::Other,
        }
    }
}

fn cancelled_error() -> WorkspaceError {
    WorkspaceError::new(
        ErrorCode::Cancelled,
        "Conflict file validation was cancelled",
    )
}

fn hash_bytes(bytes: &[u8]) -> String {
    hex_bytes(&Sha256::digest(bytes))
}

fn hex_bytes(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn stale_conflict() -> WorkspaceError {
    WorkspaceError::new(
        ErrorCode::ConflictStateChanged,
        "The conflict state changed. Reload the conflict",
    )
}

fn missing_side() -> WorkspaceError {
    WorkspaceError::new(
        ErrorCode::InvalidRequest,
        "The selected side does not exist in this conflict",
    )
}

fn io_error(error: std::io::Error) -> WorkspaceError {
    WorkspaceError::new(ErrorCode::Io, error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::os::unix::fs::{PermissionsExt, symlink};
    use std::path::PathBuf;

    fn choice_session(text: &str) -> ConflictSession {
        let generation = "generation".to_owned();
        let blocks = parse_blocks(text, &generation, DEFAULT_CONFLICT_MARKER_SIZE);
        let document_revision = hash_bytes(text.as_bytes());
        ConflictSession {
            id: "session".into(),
            path: "conflict.txt".into(),
            related_paths: vec!["conflict.txt".into()],
            generation,
            content_hash: "content-hash".into(),
            content_hash_exact: true,
            draft_text: text.to_owned(),
            blocks: blocks.clone(),
            document_revision: document_revision.clone(),
            revision_history: initial_revision_history(text, &blocks, &document_revision),
            marker_size: Some(DEFAULT_CONFLICT_MARKER_SIZE),
            kind: ConflictKind::Text,
            in_app_edit: true,
            resolution_evidence: false,
            external_baseline_hash: None,
        }
    }

    fn choose(
        session: &mut ConflictSession,
        document_revision: &str,
        draft_text: &str,
        choice: ConflictChoice,
    ) -> WorkspaceResult<ConflictEditResult> {
        let base_document_revision = session
            .revision_history
            .front()
            .expect("initial revision")
            .document_revision
            .clone();
        choose_from_base(
            session,
            document_revision,
            &base_document_revision,
            draft_text,
            choice,
        )
    }

    fn choose_from_base(
        session: &mut ConflictSession,
        document_revision: &str,
        base_document_revision: &str,
        draft_text: &str,
        choice: ConflictChoice,
    ) -> WorkspaceResult<ConflictEditResult> {
        let generation = session.generation.clone();
        let content_hash = session.content_hash.clone();
        let block_id = session.blocks[0].id.clone();
        apply_block_choice(
            session,
            BlockChoiceRequest {
                generation: &generation,
                content_hash: &content_hash,
                document_revision,
                base_document_revision,
                block_id: &block_id,
                draft_text,
                choice,
            },
        )
    }

    #[test]
    fn conflict_blocks_use_utf16_offsets_and_literal_both_order() {
        let text = "前😀\n<<<<<<< HEAD\ncurrent\n=======\nincoming\n>>>>>>> topic\n後\n";
        let blocks = parse_blocks(text, "generation", DEFAULT_CONFLICT_MARKER_SIZE);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].replacements.current, "current\n");
        assert_eq!(blocks[0].replacements.incoming, "incoming\n");
        assert_eq!(blocks[0].replacements.both, "current\nincoming\n");
        assert_eq!(
            blocks[0].range_utf16.from as usize,
            "前😀\n".encode_utf16().count()
        );
    }

    #[test]
    fn custom_marker_size_drives_block_parsing_and_marker_scanning() {
        let text = "before\n<<< HEAD\ncurrent\n===\nincoming\n>>> topic\nafter\n";
        let blocks = parse_blocks(text, "generation", 3);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].replacements.current, "current\n");
        assert_eq!(blocks[0].replacements.incoming, "incoming\n");
        assert!(contains_conflict_markers(text.as_bytes(), Some(3)));
        assert!(!contains_conflict_markers(text.as_bytes(), Some(7)));
        assert!(!contains_conflict_markers(b"===\n", Some(3)));
        assert!(!contains_conflict_markers(
            b"let marker = \"<<< HEAD\";\n",
            Some(3),
        ));
        assert!(!contains_conflict_markers(b"<<<< HEAD\n", Some(3)));
    }

    #[test]
    fn conflict_marker_size_attribute_is_validated_conservatively() {
        fn output(value: &[u8]) -> Vec<u8> {
            let mut bytes = Vec::new();
            for (attribute, value) in [
                (b"binary".as_slice(), b"unspecified".as_slice()),
                (b"diff".as_slice(), b"unspecified".as_slice()),
                (b"merge".as_slice(), b"unspecified".as_slice()),
                (b"text".as_slice(), b"unspecified".as_slice()),
                (b"conflict-marker-size".as_slice(), value),
            ] {
                for field in [b"f.txt".as_slice(), attribute, value] {
                    bytes.extend_from_slice(field);
                    bytes.push(0);
                }
            }
            bytes
        }

        assert_eq!(
            parse_conflict_attributes(&output(b"3"), "f.txt")
                .unwrap()
                .marker_size,
            Some(3),
        );
        assert_eq!(
            parse_conflict_attributes(&output(b"unspecified"), "f.txt")
                .unwrap()
                .marker_size,
            Some(DEFAULT_CONFLICT_MARKER_SIZE),
        );
        for invalid in [
            b"0".as_slice(),
            b"2".as_slice(),
            b"set".as_slice(),
            b"nope".as_slice(),
        ] {
            assert_eq!(
                parse_conflict_attributes(&output(invalid), "f.txt")
                    .unwrap()
                    .marker_size,
                None,
            );
        }
    }

    #[test]
    fn real_git_custom_marker_conflict_is_parsed_saved_and_staged_safely() {
        fn git(root: &Path, args: &[&str]) -> std::process::Output {
            Command::new("/usr/bin/git")
                .arg("-C")
                .arg(root)
                .args(args)
                .output()
                .unwrap()
        }
        fn git_ok(root: &Path, args: &[&str]) {
            let output = git(root, args);
            assert!(
                output.status.success(),
                "git {args:?} failed: {}",
                String::from_utf8_lossy(&output.stderr),
            );
        }

        let root = tempfile::tempdir().unwrap();
        git_ok(root.path(), &["init", "-b", "main"]);
        git_ok(root.path(), &["config", "user.name", "Stella Test"]);
        git_ok(
            root.path(),
            &["config", "user.email", "stella@example.invalid"],
        );
        fs::write(
            root.path().join(".gitattributes"),
            "f.txt conflict-marker-size=3\n",
        )
        .unwrap();
        fs::write(root.path().join("f.txt"), "base\n").unwrap();
        git_ok(root.path(), &["add", ".gitattributes", "f.txt"]);
        git_ok(root.path(), &["commit", "-m", "test: add base"]);
        git_ok(root.path(), &["switch", "-c", "topic"]);
        fs::write(root.path().join("f.txt"), "incoming\n").unwrap();
        git_ok(root.path(), &["commit", "-am", "test: incoming"]);
        git_ok(root.path(), &["switch", "main"]);
        fs::write(root.path().join("f.txt"), "current\n").unwrap();
        git_ok(root.path(), &["commit", "-am", "test: current"]);
        let merge = git(root.path(), &["merge", "topic"]);
        assert!(!merge.status.success());

        let executor = GitExecutor::at(PathBuf::from("/usr/bin/git"));
        let operation = OperationState::Merge { incoming_oid: None };
        let (document, session) =
            load(&executor, root.path(), "repo", "f.txt", &operation, None).unwrap();
        assert_eq!(session.marker_size, Some(3));
        assert_eq!(document.blocks.len(), 1);
        assert!(document.result.text.starts_with("<<< HEAD\n"));
        assert!(
            verify_saved_result(root.path(), &session, &session.content_hash, None)
                .unwrap()
                .contains_markers
        );

        let still_unresolved = format!("{}note\n", document.result.text);
        save_result(
            root.path(),
            &session,
            &session.content_hash,
            still_unresolved.as_bytes(),
            None,
        )
        .unwrap();
        let (_, mut session) =
            load(&executor, root.path(), "repo", "f.txt", &operation, None).unwrap();
        session.resolution_evidence = true;
        assert_eq!(session.blocks.len(), 1);
        assert!(
            verify_saved_result(root.path(), &session, &session.content_hash, None)
                .unwrap()
                .contains_markers
        );

        let generation = session.generation.clone();
        let content_hash = session.content_hash.clone();
        let document_revision = session.document_revision.clone();
        let block_id = session.blocks[0].id.clone();
        let draft_text = session.draft_text.clone();
        let edit = apply_block_choice(
            &mut session,
            BlockChoiceRequest {
                generation: &generation,
                content_hash: &content_hash,
                document_revision: &document_revision,
                base_document_revision: &document_revision,
                block_id: &block_id,
                draft_text: &draft_text,
                choice: ConflictChoice::Current,
            },
        )
        .unwrap();
        save_result(
            root.path(),
            &session,
            &content_hash,
            edit.text.as_bytes(),
            None,
        )
        .unwrap();
        let (_, mut resolved) =
            load(&executor, root.path(), "repo", "f.txt", &operation, None).unwrap();
        resolved.resolution_evidence = true;
        assert!(resolved.blocks.is_empty());
        assert!(
            !verify_saved_result(root.path(), &resolved, &resolved.content_hash, None)
                .unwrap()
                .contains_markers
        );
        executor
            .run(
                Some(root.path()),
                GitCommand::Add {
                    paths: vec!["f.txt".into()],
                },
                None,
                None,
            )
            .unwrap()
            .ensure_success()
            .unwrap();
        let unmerged = executor
            .run(
                Some(root.path()),
                GitCommand::Unmerged {
                    path: Some("f.txt".into()),
                },
                None,
                None,
            )
            .unwrap()
            .ensure_success()
            .unwrap();
        assert!(unmerged.stdout.is_empty());
    }

    #[test]
    fn undo_restores_block_state_before_applying_another_choice() {
        let original = "before\n<<<<<<< HEAD\ncurrent\n=======\nincoming\n>>>>>>> topic\nafter\n";
        let original_revision = hash_bytes(original.as_bytes());
        let mut session = choice_session(original);

        let current = choose(
            &mut session,
            &original_revision,
            original,
            ConflictChoice::Current,
        )
        .unwrap();
        assert_eq!(current.blocks[0].state, ConflictBlockState::Current);
        assert_eq!(current.text, "before\ncurrent\nafter\n");

        let incoming = choose(
            &mut session,
            &original_revision,
            original,
            ConflictChoice::Incoming,
        )
        .unwrap();
        assert_eq!(incoming.blocks[0].state, ConflictBlockState::Incoming);
        assert_eq!(incoming.text, "before\nincoming\nafter\n");
    }

    #[test]
    fn undo_to_a_manual_pre_choice_snapshot_can_apply_a_different_choice() {
        let original = "before\n<<<<<<< HEAD\ncurrent\n=======\nincoming\n>>>>>>> topic\nafter\n";
        let manual = format!("note\n{original}");
        let manual_revision = hash_bytes(manual.as_bytes());
        let mut session = choice_session(original);

        let current = choose(
            &mut session,
            &manual_revision,
            &manual,
            ConflictChoice::Current,
        )
        .unwrap();
        assert_eq!(current.blocks[0].state, ConflictBlockState::Current);
        assert_eq!(current.text, "note\nbefore\ncurrent\nafter\n");

        let incoming = choose(
            &mut session,
            &manual_revision,
            &manual,
            ConflictChoice::Incoming,
        )
        .unwrap();
        assert_eq!(incoming.blocks[0].state, ConflictBlockState::Incoming);
        assert_eq!(incoming.text, "note\nbefore\nincoming\nafter\n");
    }

    #[test]
    fn multiple_manual_edits_can_undo_across_a_choice_and_choose_again() {
        let original = "before\n<<<<<<< HEAD\ncurrent\n=======\nincoming\n>>>>>>> topic\nafter\n";
        let original_revision = hash_bytes(original.as_bytes());
        let manual_b = format!("manual B\n{original}");
        let manual_c = format!("manual C\n{original}");
        let mut session = choice_session(original);

        let current = choose_from_base(
            &mut session,
            &hash_bytes(manual_c.as_bytes()),
            &original_revision,
            &manual_c,
            ConflictChoice::Current,
        )
        .unwrap();
        assert_eq!(current.text, "manual C\nbefore\ncurrent\nafter\n");

        let incoming = choose_from_base(
            &mut session,
            &hash_bytes(manual_b.as_bytes()),
            &original_revision,
            &manual_b,
            ConflictChoice::Incoming,
        )
        .unwrap();
        assert_eq!(incoming.blocks[0].state, ConflictBlockState::Incoming);
        assert_eq!(incoming.text, "manual B\nbefore\nincoming\nafter\n");
    }

    #[test]
    fn manual_edit_after_choice_uses_that_choice_as_its_base() {
        let original = "before\n<<<<<<< HEAD\ncurrent\n=======\nincoming\n>>>>>>> topic\nafter\n";
        let original_revision = hash_bytes(original.as_bytes());
        let mut session = choice_session(original);
        let current = choose(
            &mut session,
            &original_revision,
            original,
            ConflictChoice::Current,
        )
        .unwrap();
        let manual = format!("note\n{}", current.text);

        let incoming = choose_from_base(
            &mut session,
            &hash_bytes(manual.as_bytes()),
            &current.document_revision,
            &manual,
            ConflictChoice::Incoming,
        )
        .unwrap();
        assert_eq!(incoming.blocks[0].state, ConflictBlockState::Incoming);
        assert_eq!(incoming.text, "note\nbefore\nincoming\nafter\n");
    }

    #[test]
    fn unknown_or_tampered_drafts_keep_manual_and_stale_safety() {
        let original = "before\n<<<<<<< HEAD\ncurrent\n=======\nincoming\n>>>>>>> topic\nafter\n";
        let original_revision = hash_bytes(original.as_bytes());
        let mut tampered = choice_session(original);
        let error = choose(
            &mut tampered,
            &original_revision,
            "tampered\n",
            ConflictChoice::Current,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidRequest);
        assert_eq!(tampered.draft_text, original);
        assert_eq!(tampered.blocks[0].state, ConflictBlockState::Unresolved);

        let manual = "before\nmanually resolved\nafter\n";
        let manual_revision = hash_bytes(manual.as_bytes());
        let mut unknown = choice_session(original);
        let error = choose(
            &mut unknown,
            &manual_revision,
            manual,
            ConflictChoice::Incoming,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::ConflictStateChanged);
        assert_eq!(unknown.draft_text, original);
        assert_eq!(unknown.blocks[0].state, ConflictBlockState::Unresolved);

        let outside_edit = format!("note\n{original}");
        let error = choose_from_base(
            &mut unknown,
            &hash_bytes(outside_edit.as_bytes()),
            "unknown-base",
            &outside_edit,
            ConflictChoice::Incoming,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::ConflictStateChanged);
        assert_eq!(unknown.draft_text, original);

        let valid = choose_from_base(
            &mut unknown,
            &hash_bytes(outside_edit.as_bytes()),
            &original_revision,
            &outside_edit,
            ConflictChoice::Incoming,
        )
        .unwrap();
        assert_eq!(valid.text, "note\nbefore\nincoming\nafter\n");
    }

    #[test]
    fn evicted_manual_edit_base_is_rejected_without_mutating_the_session() {
        let original = "before\n<<<<<<< HEAD\ncurrent\n=======\nincoming\n>>>>>>> topic\nafter\n";
        let original_revision = hash_bytes(original.as_bytes());
        let mut session = choice_session(original);
        for index in 0..REVISION_HISTORY_LIMIT {
            session.draft_text = format!("server revision {index}\n");
            session.document_revision = hash_bytes(session.draft_text.as_bytes());
            record_revision_snapshot(&mut session);
        }
        assert!(
            !session
                .revision_history
                .iter()
                .any(|snapshot| snapshot.document_revision == original_revision)
        );
        let before = session.clone();
        let manual = format!("note\n{original}");

        let error = choose_from_base(
            &mut session,
            &hash_bytes(manual.as_bytes()),
            &original_revision,
            &manual,
            ConflictChoice::Current,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::ConflictStateChanged);
        assert_eq!(session.draft_text, before.draft_text);
        assert_eq!(session.blocks, before.blocks);
        assert_eq!(session.document_revision, before.document_revision);
    }

    #[test]
    fn conflict_revision_history_is_bounded() {
        let original = "<<<<<<< HEAD\ncurrent\n=======\nincoming\n>>>>>>> topic\n";
        let mut session = choice_session(original);
        for index in 0..=REVISION_HISTORY_LIMIT {
            session.draft_text = format!("revision {index}\n");
            session.document_revision = hash_bytes(session.draft_text.as_bytes());
            record_revision_snapshot(&mut session);
        }
        assert_eq!(session.revision_history.len(), REVISION_HISTORY_LIMIT);
        assert!(
            session
                .revision_history
                .iter()
                .all(|snapshot| snapshot.draft_text != original)
        );
        assert_eq!(
            session.revision_history.back().unwrap().draft_text,
            format!("revision {REVISION_HISTORY_LIMIT}\n")
        );
    }

    #[test]
    fn performance_sized_revision_history_respects_the_shared_byte_budget() {
        let line = "0123456789abcdef\n";
        let original = line.repeat(MAX_EDIT_BYTES / line.len());
        let original_revision = hash_bytes(original.as_bytes());
        let mut session = choice_session(&original);
        assert!(session.blocks.is_empty());

        for index in 1..=12 {
            let mut revision = original.clone();
            revision.replace_range(..1, &char::from(b'A' + index).to_string());
            session.draft_text = revision;
            session.document_revision = hash_bytes(session.draft_text.as_bytes());
            record_revision_snapshot(&mut session);
        }

        assert!(
            revision_history_charged_bytes(&session.revision_history)
                <= REVISION_HISTORY_BYTE_BUDGET
        );
        assert!(session.revision_history.len() <= 4);
        let current = session.revision_history.back().expect("current revision");
        assert_eq!(current.document_revision, session.document_revision);
        assert_eq!(current.draft_text, session.draft_text);
        assert!(
            !session
                .revision_history
                .iter()
                .any(|snapshot| snapshot.document_revision == original_revision)
        );

        let before_revision = session.document_revision.clone();
        let generation = session.generation.clone();
        let content_hash = session.content_hash.clone();
        let error = apply_block_choice(
            &mut session,
            BlockChoiceRequest {
                generation: &generation,
                content_hash: &content_hash,
                document_revision: &original_revision,
                base_document_revision: &original_revision,
                block_id: "missing-block",
                draft_text: &original,
                choice: ConflictChoice::Current,
            },
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::ConflictStateChanged);
        assert_eq!(session.document_revision, before_revision);
    }

    #[test]
    fn limits_match_contract() {
        let regular = "a\n".repeat(EDIT_LINES);
        assert!(text_metrics(&regular).lines <= EDIT_LINES);
        let long = "a".repeat(MAX_EDIT_LONGEST_LINE + 1);
        assert!(text_metrics(&long).longest_line > MAX_EDIT_LONGEST_LINE);
    }

    #[test]
    fn mixed_or_lone_carriage_return_text_is_external_only() {
        let entry = || StageEntry {
            mode: "100644".into(),
            oid: "oid".into(),
        };
        let stages = StageSet {
            base: Some(entry()),
            current: Some(entry()),
            incoming: Some(entry()),
        };
        for text in [b"a\r\nb\n".as_slice(), b"a\rb".as_slice()] {
            let classification = classify(
                &stages,
                &[Some("100644"), Some("100644"), Some("100644")],
                &[Some(text), Some(text), Some(text), Some(text)],
                text,
                false,
                false,
            );
            assert_eq!(classification.0, ConflictKind::Text);
            assert!(!classification.2);
            assert!(!classification.3);
        }
        assert!(compatible_line_endings(&[
            Some(b"a\r\n".as_slice()),
            Some(b"b\r\n".as_slice())
        ]));
        assert!(compatible_line_endings(&[
            Some(b"a\n".as_slice()),
            Some(b"b\n".as_slice())
        ]));
        assert!(!compatible_line_endings(&[
            Some(b"a\n".as_slice()),
            Some(b"b\r\n".as_slice())
        ]));
    }

    #[test]
    fn conflict_save_preserves_crlf_bytes_exactly() {
        let root = tempfile::tempdir().unwrap();
        let original = b"<<<<<<< HEAD\r\ncurrent\r\n=======\r\nincoming\r\n>>>>>>> topic\r\n";
        let original_text = std::str::from_utf8(original).unwrap();
        fs::write(root.path().join("f.txt"), original).unwrap();
        let session = ConflictSession {
            id: "session".into(),
            path: "f.txt".into(),
            related_paths: vec!["f.txt".into()],
            generation: "generation".into(),
            content_hash: hash_bytes(original),
            content_hash_exact: true,
            draft_text: original_text.into(),
            blocks: Vec::new(),
            document_revision: hash_bytes(original),
            revision_history: initial_revision_history(original_text, &[], &hash_bytes(original)),
            marker_size: Some(DEFAULT_CONFLICT_MARKER_SIZE),
            kind: ConflictKind::Text,
            in_app_edit: true,
            resolution_evidence: false,
            external_baseline_hash: None,
        };
        let result = b"current\r\nincoming\r\n";
        save_result(root.path(), &session, &session.content_hash, result, None).unwrap();
        assert_eq!(fs::read(root.path().join("f.txt")).unwrap(), result);

        let refreshed = ConflictSession {
            content_hash: hash_bytes(result),
            draft_text: String::from_utf8(result.to_vec()).unwrap(),
            document_revision: hash_bytes(result),
            ..session
        };
        let error = save_result(
            root.path(),
            &refreshed,
            &refreshed.content_hash,
            b"mixed\r\nline\n",
            None,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidRequest);
        assert_eq!(fs::read(root.path().join("f.txt")).unwrap(), result);
    }

    #[test]
    fn bounded_worktree_read_hashes_and_scans_the_full_stream() {
        let root = tempfile::tempdir().unwrap();
        let mut bytes = vec![b'a'; 16 * 1024 - 3];
        bytes.extend_from_slice(b"\n<<<<<<< external\n");
        bytes.extend(std::iter::repeat_n(b'z', MAX_EDIT_BYTES));
        let path = root.path().join("large.txt");
        fs::write(&path, &bytes).unwrap();

        let read = read_worktree_entry_exact(&path, 1024, Some(DEFAULT_CONFLICT_MARKER_SIZE), None)
            .unwrap();
        assert_eq!(read.bytes.len(), 1024);
        assert!(read.truncated);
        assert_eq!(read.content_hash, hash_bytes(&bytes));
        assert!(read.contains_markers);
    }

    #[test]
    fn oversized_stage_is_rejected_from_size_without_reading_the_blob() {
        let root = tempfile::tempdir().unwrap();
        let executable = root.path().join("fake-git");
        let body_marker = root.path().join("blob-body-was-read");
        fs::write(
            &executable,
            format!(
                "#!/bin/sh\nif [ \"$1\" = --literal-pathspecs ]; then\n  shift\nfi\nif [ \"$1\" = cat-file ] && [ \"$2\" = -s ]; then\n  echo {}\n  exit 0\nfi\ntouch \"{}\"\nexit 91\n",
                MAX_EDIT_BYTES + 1,
                body_marker.display(),
            ),
        )
        .unwrap();
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).unwrap();
        let git = GitExecutor::at(executable);
        let material = read_stage(
            &git,
            root.path(),
            Some(&StageEntry {
                mode: "100644".into(),
                oid: "0123456789abcdef".into(),
            }),
            None,
        )
        .unwrap()
        .unwrap();
        assert!(material.truncated);
        assert!(material.bytes.is_empty());
        assert!(!body_marker.exists());
    }

    #[test]
    fn oversized_worktree_query_is_metadata_only_and_mark_scan_is_cancellable() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("huge.txt");
        let file = File::create(&path).unwrap();
        file.set_len(8 * 1024 * 1024 * 1024).unwrap();
        drop(file);
        fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).unwrap();

        let read = read_worktree_entry_for_query(
            &path,
            MAX_EDIT_BYTES,
            Some(DEFAULT_CONFLICT_MARKER_SIZE),
            None,
        )
        .unwrap();
        assert!(read.truncated);
        assert!(!read.exact);
        assert!(read.bytes.is_empty());
        assert!(read.content_hash.starts_with("metadata:"));
        let session = ConflictSession {
            id: "session".into(),
            path: "huge.txt".into(),
            related_paths: vec!["huge.txt".into()],
            generation: "generation".into(),
            content_hash: read.content_hash,
            content_hash_exact: false,
            draft_text: String::new(),
            blocks: Vec::new(),
            document_revision: hash_bytes(b""),
            revision_history: initial_revision_history("", &[], &hash_bytes(b"")),
            marker_size: Some(DEFAULT_CONFLICT_MARKER_SIZE),
            kind: ConflictKind::Oversize,
            in_app_edit: false,
            resolution_evidence: true,
            external_baseline_hash: None,
        };
        verify_saved_result_identity(root.path(), &session, &session.content_hash, None).unwrap();
        let control = RunControl::new();
        control.cancel();
        let error =
            verify_saved_result(root.path(), &session, &session.content_hash, Some(&control))
                .unwrap_err();
        assert_eq!(error.code, ErrorCode::Cancelled);

        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        fs::write(&path, b"changed\n").unwrap();
        let error =
            verify_saved_result(root.path(), &session, &session.content_hash, None).unwrap_err();
        assert_eq!(error.code, ErrorCode::ConflictStateChanged);
    }

    #[test]
    fn oversized_mark_scan_still_detects_conflict_markers() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("large.txt");
        let mut file = File::create(&path).unwrap();
        file.write_all(b"<<<<<<< unresolved\n").unwrap();
        file.set_len((MAX_EDIT_BYTES + 1) as u64).unwrap();
        drop(file);
        let read = read_worktree_entry_for_query(
            &path,
            MAX_EDIT_BYTES,
            Some(DEFAULT_CONFLICT_MARKER_SIZE),
            None,
        )
        .unwrap();
        let session = ConflictSession {
            id: "session".into(),
            path: "large.txt".into(),
            related_paths: vec!["large.txt".into()],
            generation: "generation".into(),
            content_hash: read.content_hash,
            content_hash_exact: false,
            draft_text: String::new(),
            blocks: Vec::new(),
            document_revision: hash_bytes(b""),
            revision_history: initial_revision_history("", &[], &hash_bytes(b"")),
            marker_size: Some(DEFAULT_CONFLICT_MARKER_SIZE),
            kind: ConflictKind::Oversize,
            in_app_edit: false,
            resolution_evidence: true,
            external_baseline_hash: None,
        };
        let verified =
            verify_saved_result(root.path(), &session, &session.content_hash, None).unwrap();
        assert!(verified.contains_markers);
    }

    #[test]
    fn any_bounded_stage_or_worktree_truncation_classifies_as_oversize() {
        let entry = || StageEntry {
            mode: "100644".into(),
            oid: "oid".into(),
        };
        let stages = StageSet {
            base: Some(entry()),
            current: Some(entry()),
            incoming: Some(entry()),
        };
        let classification = classify(
            &stages,
            &[Some("100644"), Some("100644"), Some("100644")],
            &[Some(b"small".as_slice())],
            b"small",
            false,
            true,
        );
        assert_eq!(classification.0, ConflictKind::Oversize);
        assert!(!classification.3);
    }

    #[test]
    fn marker_detection_is_only_a_warning() {
        assert!(contains_conflict_markers(
            b"<<<<<<< HEAD\na\n=======\nb\n>>>>>>> x\n",
            Some(DEFAULT_CONFLICT_MARKER_SIZE),
        ));
        assert!(!contains_conflict_markers(
            b"ordinary text\n",
            Some(DEFAULT_CONFLICT_MARKER_SIZE),
        ));
    }

    #[test]
    fn stage_shapes_classify_external_only_structural_conflicts() {
        let entry = || StageEntry {
            mode: "100644".into(),
            oid: "oid".into(),
        };
        let rename = StageSet {
            base: Some(entry()),
            current: None,
            incoming: None,
        };
        assert_eq!(
            classify(
                &rename,
                &[Some("100644"), None, None],
                &[None],
                b"",
                false,
                false,
            )
            .0,
            ConflictKind::RenameRename
        );
        let directory_file = StageSet {
            base: None,
            current: Some(entry()),
            incoming: None,
        };
        let classification = classify(
            &directory_file,
            &[None, Some("100644"), None],
            &[None],
            b"",
            false,
            false,
        );
        assert_eq!(classification.0, ConflictKind::DirectoryFile);
        assert!(!classification.2);
        assert!(!classification.3);
    }

    #[test]
    fn conflict_io_rejects_an_intermediate_symlink_escape() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret.txt"), b"outside\n").unwrap();
        symlink(outside.path(), root.path().join("escape")).unwrap();
        let session = ConflictSession {
            id: "session".into(),
            path: "escape/secret.txt".into(),
            related_paths: vec!["escape/secret.txt".into()],
            generation: "generation".into(),
            content_hash: hash_bytes(b"outside\n"),
            content_hash_exact: true,
            draft_text: "outside\n".into(),
            blocks: Vec::new(),
            document_revision: hash_bytes(b"outside\n"),
            revision_history: initial_revision_history("outside\n", &[], &hash_bytes(b"outside\n")),
            marker_size: Some(DEFAULT_CONFLICT_MARKER_SIZE),
            kind: ConflictKind::Text,
            in_app_edit: true,
            resolution_evidence: false,
            external_baseline_hash: None,
        };

        let error = save_result(
            root.path(),
            &session,
            &session.content_hash,
            b"overwritten\n",
            None,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidRequest);
        assert_eq!(
            fs::read(outside.path().join("secret.txt")).unwrap(),
            b"outside\n"
        );
        assert!(worktree_entry_exists(root.path(), &session).is_err());
    }

    #[test]
    fn a_final_symlink_is_read_as_the_git_link_payload() {
        let root = tempfile::tempdir().unwrap();
        symlink("../outside", root.path().join("link")).unwrap();
        let path = checked_worktree_path(root.path(), "link").unwrap();
        assert_eq!(
            read_worktree_entry_for_query(
                &path,
                MAX_EDIT_BYTES,
                Some(DEFAULT_CONFLICT_MARKER_SIZE),
                None,
            )
            .unwrap()
            .bytes,
            b"../outside"
        );
    }
}
