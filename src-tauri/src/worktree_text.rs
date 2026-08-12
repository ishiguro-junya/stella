use crate::git::{GitCommand, GitExecutor, RunControl};
use crate::model::{ErrorCode, LineEnding, LocalizedMessage, WorkspaceError, WorkspaceResult};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub(crate) const MAX_EDIT_BYTES: usize = 5 * 1024 * 1024;
pub(crate) const MAX_EDIT_LINES: usize = 100_000;
pub(crate) const MAX_EDIT_LONGEST_LINE: usize = 256 * 1024;
const UTF8_BOM: &[u8] = b"\xEF\xBB\xBF";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum NewlineStyle {
    Neutral,
    Lf,
    Crlf,
    Invalid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct TextMetrics {
    pub(crate) lines: usize,
    pub(crate) longest_line: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct EditableText {
    pub(crate) text: String,
    pub(crate) line_ending: LineEnding,
    pub(crate) has_utf8_bom: bool,
    pub(crate) content_hash: String,
}

pub(crate) fn load_editable_file(
    git: &GitExecutor,
    root: &Path,
    path: &str,
    control: Option<&RunControl>,
) -> WorkspaceResult<EditableText> {
    if control.is_some_and(RunControl::is_cancelled) {
        return Err(WorkspaceError::new(
            ErrorCode::Cancelled,
            "The file read was cancelled",
        ));
    }
    reject_unsupported_attributes(git, root, path, control)?;
    let absolute = checked_worktree_path(root, path)?;
    let before = fs::symlink_metadata(&absolute).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            unsupported_file(path, "deleted")
        } else {
            file_io_error(error)
        }
    })?;
    if before.file_type().is_symlink() {
        return Err(unsupported_file(path, "symlink"));
    }
    if !before.is_file() {
        return Err(unsupported_file(path, "notRegularFile"));
    }
    if before.len() > MAX_EDIT_BYTES as u64 {
        return Err(unsupported_file(path, "tooLarge"));
    }

    let before_fingerprint = metadata_fingerprint(&before);
    let mut bytes = Vec::with_capacity(before.len() as usize);
    File::open(&absolute)
        .map_err(file_io_error)?
        .take((MAX_EDIT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(file_io_error)?;
    if bytes.len() > MAX_EDIT_BYTES {
        return Err(unsupported_file(path, "tooLarge"));
    }
    let after = fs::symlink_metadata(&absolute).map_err(file_io_error)?;
    if after.file_type().is_symlink() || metadata_fingerprint(&after) != before_fingerprint {
        return Err(file_changed(path));
    }
    parse_editable_bytes(path, bytes)
}

pub(crate) fn save_editable_file(
    git: &GitExecutor,
    root: &Path,
    path: &str,
    expected_content_hash: &str,
    draft_text: &str,
    control: Option<&RunControl>,
) -> WorkspaceResult<String> {
    let current = load_editable_file(git, root, path, control)?;
    if current.content_hash != expected_content_hash {
        return Err(file_changed(path));
    }
    let normalized = normalize_line_endings(draft_text, current.line_ending)
        .ok_or_else(|| unsupported_file(path, "lineEndings"))?;
    let mut bytes = Vec::with_capacity(normalized.len() + usize::from(current.has_utf8_bom) * 3);
    if current.has_utf8_bom {
        bytes.extend_from_slice(UTF8_BOM);
    }
    bytes.extend_from_slice(normalized.as_bytes());
    validate_editable_bytes(path, &bytes, current.has_utf8_bom)?;

    // 一時ファイルを書いた後にも再確認し、外部変更を既知の内容で上書きしにくくする。
    let absolute = checked_worktree_path(root, path)?;
    let latest = load_editable_file(git, root, path, control)?;
    if latest.content_hash != expected_content_hash {
        return Err(file_changed(path));
    }
    atomic_write(root, &absolute, &bytes)?;
    Ok(hash_bytes(&bytes))
}

fn parse_editable_bytes(path: &str, bytes: Vec<u8>) -> WorkspaceResult<EditableText> {
    let has_utf8_bom = bytes.starts_with(UTF8_BOM);
    validate_editable_bytes(path, &bytes, has_utf8_bom)?;
    let body = if has_utf8_bom {
        &bytes[UTF8_BOM.len()..]
    } else {
        &bytes
    };
    let text = std::str::from_utf8(body)
        .map_err(|_| unsupported_file(path, "nonUtf8"))?
        .to_owned();
    let line_ending = match newline_style(body) {
        NewlineStyle::Crlf => LineEnding::Crlf,
        NewlineStyle::Neutral | NewlineStyle::Lf => LineEnding::Lf,
        NewlineStyle::Invalid => return Err(unsupported_file(path, "lineEndings")),
    };
    Ok(EditableText {
        text,
        line_ending,
        has_utf8_bom,
        content_hash: hash_bytes(&bytes),
    })
}

pub(crate) fn validate_editable_bytes(
    path: &str,
    bytes: &[u8],
    has_utf8_bom: bool,
) -> WorkspaceResult<()> {
    if bytes.len() > MAX_EDIT_BYTES {
        return Err(unsupported_file(path, "tooLarge"));
    }
    let body = if has_utf8_bom && bytes.starts_with(UTF8_BOM) {
        &bytes[UTF8_BOM.len()..]
    } else {
        bytes
    };
    if body.contains(&0) {
        return Err(unsupported_file(path, "nul"));
    }
    let text = std::str::from_utf8(body).map_err(|_| unsupported_file(path, "nonUtf8"))?;
    let metrics = text_metrics(text);
    if metrics.lines > MAX_EDIT_LINES || metrics.longest_line > MAX_EDIT_LONGEST_LINE {
        return Err(unsupported_file(path, "tooLarge"));
    }
    if newline_style(body) == NewlineStyle::Invalid {
        return Err(unsupported_file(path, "lineEndings"));
    }
    Ok(())
}

fn reject_unsupported_attributes(
    git: &GitExecutor,
    root: &Path,
    path: &str,
    control: Option<&RunControl>,
) -> WorkspaceResult<()> {
    let lfs = git
        .run(
            Some(root),
            GitCommand::CheckLfsAttribute {
                path: path.to_owned(),
            },
            None,
            control,
        )?
        .ensure_success()?;
    let lfs_fields = lfs.stdout.split(|byte| *byte == 0).collect::<Vec<_>>();
    if lfs_fields.len() >= 3 && lfs_fields[1] == b"filter" && lfs_fields[2] == b"lfs" {
        return Err(unsupported_file(path, "gitLfs"));
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
    for record in attributes
        .stdout
        .split(|byte| *byte == 0)
        .filter(|field| !field.is_empty())
        .collect::<Vec<_>>()
        .chunks_exact(3)
    {
        let attribute = record[1];
        let value = record[2];
        if (attribute == b"binary" && value == b"set")
            || ((attribute == b"diff" || attribute == b"merge" || attribute == b"text")
                && value == b"unset")
            || ((attribute == b"diff" || attribute == b"merge") && value == b"binary")
        {
            return Err(unsupported_file(path, "binary"));
        }
    }
    Ok(())
}

fn normalize_line_endings(text: &str, line_ending: LineEnding) -> Option<String> {
    let lf = text.replace("\r\n", "\n");
    if lf.contains('\r') {
        return None;
    }
    Some(match line_ending {
        LineEnding::Lf => lf,
        LineEnding::Crlf => lf.replace('\n', "\r\n"),
    })
}

pub(crate) fn newline_style(bytes: &[u8]) -> NewlineStyle {
    let mut saw_lf = false;
    let mut saw_crlf = false;
    let mut cursor = 0;
    while cursor < bytes.len() {
        match bytes[cursor] {
            b'\r' if bytes.get(cursor + 1) == Some(&b'\n') => {
                saw_crlf = true;
                cursor += 2;
            }
            b'\r' => return NewlineStyle::Invalid,
            b'\n' => {
                saw_lf = true;
                cursor += 1;
            }
            _ => cursor += 1,
        }
        if saw_lf && saw_crlf {
            return NewlineStyle::Invalid;
        }
    }
    match (saw_lf, saw_crlf) {
        (false, false) => NewlineStyle::Neutral,
        (true, false) => NewlineStyle::Lf,
        (false, true) => NewlineStyle::Crlf,
        (true, true) => NewlineStyle::Invalid,
    }
}

pub(crate) fn text_metrics(text: &str) -> TextMetrics {
    if text.is_empty() {
        return TextMetrics {
            lines: 0,
            longest_line: 0,
        };
    }
    let mut lines = 0;
    let mut longest_line = 0;
    for line in text.split_inclusive('\n') {
        lines += 1;
        longest_line = longest_line.max(line.len());
    }
    TextMetrics {
        lines,
        longest_line,
    }
}

pub(crate) fn hash_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub(crate) fn atomic_write(root: &Path, path: &Path, bytes: &[u8]) -> WorkspaceResult<()> {
    atomic_write_with_mode(root, path, bytes, None)
}

pub(crate) fn atomic_write_with_mode(
    root: &Path,
    path: &Path,
    bytes: &[u8],
    executable: Option<bool>,
) -> WorkspaceResult<()> {
    let parent = path.parent().ok_or_else(|| {
        WorkspaceError::new(
            ErrorCode::InvalidRequest,
            "The path has no parent directory",
        )
    })?;
    let canonical_root = root.canonicalize().map_err(file_io_error)?;
    let canonical_parent = parent.canonicalize().map_err(file_io_error)?;
    if !canonical_parent.starts_with(&canonical_root) {
        return Err(outside_repository());
    }
    let temporary = parent.join(format!(".stella-write-{}", Uuid::new_v4()));
    let mut guard = TemporaryFileGuard(Some(temporary.clone()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(file_io_error)?;
    if let Ok(metadata) = fs::symlink_metadata(path)
        && !metadata.file_type().is_symlink()
    {
        fs::set_permissions(&temporary, metadata.permissions()).map_err(file_io_error)?;
    }
    if let Some(executable) = executable {
        let mut permissions = fs::metadata(&temporary)
            .map_err(file_io_error)?
            .permissions();
        let mode = if executable {
            permissions.mode() | 0o111
        } else {
            permissions.mode() & !0o111
        };
        permissions.set_mode(mode);
        fs::set_permissions(&temporary, permissions).map_err(file_io_error)?;
    }
    file.write_all(bytes).map_err(file_io_error)?;
    file.sync_all().map_err(file_io_error)?;
    fs::rename(&temporary, path).map_err(file_io_error)?;
    guard.disarm();
    Ok(())
}

struct TemporaryFileGuard(Option<PathBuf>);

impl TemporaryFileGuard {
    fn disarm(&mut self) {
        self.0 = None;
    }
}

impl Drop for TemporaryFileGuard {
    fn drop(&mut self) {
        if let Some(path) = &self.0 {
            let _ = fs::remove_file(path);
        }
    }
}

pub(crate) fn checked_worktree_path(root: &Path, path: &str) -> WorkspaceResult<PathBuf> {
    let candidate = Path::new(path);
    if candidate.is_absolute()
        || candidate
            .components()
            .any(|part| !matches!(part, std::path::Component::Normal(_)))
        || path
            .split('/')
            .any(|component| component.is_empty() || matches!(component, "." | ".."))
    {
        return Err(outside_repository());
    }
    let canonical_root = root.canonicalize().map_err(file_io_error)?;
    let components: Vec<_> = candidate.components().collect();
    if components.is_empty() {
        return Err(outside_repository());
    }
    let mut cursor = canonical_root.clone();
    for (index, component) in components.iter().enumerate() {
        let std::path::Component::Normal(component) = component else {
            return Err(outside_repository());
        };
        cursor.push(component);
        match fs::symlink_metadata(&cursor) {
            Ok(metadata) if metadata.file_type().is_symlink() && index + 1 != components.len() => {
                return Err(outside_repository());
            }
            Ok(metadata) if index + 1 != components.len() && !metadata.is_dir() => {
                return Err(outside_repository());
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => return Err(file_io_error(error)),
        }
    }
    if cursor.exists()
        && !cursor
            .symlink_metadata()
            .is_ok_and(|value| value.file_type().is_symlink())
    {
        let canonical = cursor.canonicalize().map_err(file_io_error)?;
        if !canonical.starts_with(&canonical_root) {
            return Err(outside_repository());
        }
    }
    Ok(canonical_root.join(candidate))
}

fn metadata_fingerprint(metadata: &fs::Metadata) -> (u64, u64, u64, i64, i64, u32) {
    (
        metadata.dev(),
        metadata.ino(),
        metadata.len(),
        metadata.mtime(),
        metadata.mtime_nsec(),
        metadata.mode(),
    )
}

fn unsupported_file(path: &str, reason: &str) -> WorkspaceError {
    WorkspaceError::new(
        ErrorCode::InvalidRequest,
        "The file cannot be edited in the app",
    )
    .localized_message(LocalizedMessage::new("fileEditUnsupported").arg("reason", reason))
    .detail("path", path)
    .detail("reason", reason)
}

fn file_changed(path: &str) -> WorkspaceError {
    WorkspaceError::new(
        ErrorCode::StaleGeneration,
        "The file changed after it was loaded",
    )
    .localized_message(LocalizedMessage::new("fileEditExternalChange"))
    .detail("path", path)
}

fn outside_repository() -> WorkspaceError {
    WorkspaceError::new(
        ErrorCode::InvalidRequest,
        "The path escapes the repository root",
    )
}

fn file_io_error(error: std::io::Error) -> WorkspaceError {
    WorkspaceError::new(ErrorCode::Io, error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_supported_and_mixed_line_endings() {
        assert_eq!(newline_style(b"a\nb\n"), NewlineStyle::Lf);
        assert_eq!(newline_style(b"a\r\nb\r\n"), NewlineStyle::Crlf);
        assert_eq!(newline_style(b"a\r\nb\n"), NewlineStyle::Invalid);
        assert_eq!(newline_style(b"a\rb"), NewlineStyle::Invalid);
    }

    #[test]
    fn normalizes_drafts_to_the_original_line_ending() {
        assert_eq!(
            normalize_line_endings("a\nb\n", LineEnding::Crlf),
            Some("a\r\nb\r\n".into())
        );
        assert_eq!(
            normalize_line_endings("a\r\nb\r\n", LineEnding::Lf),
            Some("a\nb\n".into())
        );
        assert_eq!(normalize_line_endings("a\rb", LineEnding::Lf), None);
    }
}
