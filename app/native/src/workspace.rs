use crate::commit::{MessageFile, build_message};
use crate::conflict::{self, ConflictSession};
use crate::git::{GitCommand, GitExecutor, GitOutput, OUTPUT_LIMIT, RunControl, SequencerAction};
use crate::git_flow;
use crate::journal::{JournalPhase, JournalStore, OperationJournal, default_journal_directory};
use crate::model::*;
use crate::patch::build_selected_patch;
use crate::worktree_text::{load_editable_file, load_raw_file, save_editable_file};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::ffi::OsString;
use std::fs::{self, File};
use std::io::Read;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::{Command as ProcessCommand, Stdio};
use std::sync::{
    Arc, Mutex, RwLock,
    atomic::{AtomicU64, Ordering},
    mpsc,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::ipc::Channel;
use uuid::Uuid;

const PREVIEW_TTL: Duration = Duration::from_secs(60);
const MAX_PREVIEW_RECORDS: usize = 256;
const DIFF_LIMIT: usize = 5 * 1024 * 1024;
const HISTORY_PAGE_LIMIT: u32 = 2_000;
const COMMIT_ACTIVITY_SCAN_LIMIT: u32 = 100_000;
const MAX_COMMIT_ACTIVITY_BUCKETS: usize = 365;
const MAX_COMMIT_ACTIVITY_CACHE_ENTRIES: usize = 8;
const UNBORN_HISTORY_REVISION: &str = "unborn";

struct DiffMaterial {
    bytes: Vec<u8>,
    truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct WorktreeWriteTarget {
    mode: String,
    path: String,
}

type ActionTargets<'a> = (
    &'a [String],
    Option<&'a PatchSelection>,
    fn(&StatusEntry) -> bool,
);

pub struct Workspace {
    git: GitExecutor,
    journal: JournalStore,
    repos: RwLock<HashMap<String, Arc<RepoContext>>>,
    previews: Mutex<HashMap<String, PreviewRecord>>,
    running: Arc<Mutex<HashMap<String, RunControl>>>,
    common_mutations: Mutex<HashMap<PathBuf, Arc<RwLock<()>>>>,
}

struct QueryRegistration {
    operation_id: String,
    control: RunControl,
    running: Arc<Mutex<HashMap<String, RunControl>>>,
}

impl Drop for QueryRegistration {
    fn drop(&mut self) {
        self.running
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&self.operation_id);
    }
}

struct RepoContext {
    id: String,
    root: PathBuf,
    git_dir: PathBuf,
    common_dir: PathBuf,
    mutation: Arc<RwLock<()>>,
    snapshot: Mutex<()>,
    tracker: Mutex<GenerationTracker>,
    event_seq: AtomicU64,
    channel: Mutex<Option<Channel<WorkspaceEvent>>>,
    conflicts: Mutex<HashMap<String, ConflictSession>>,
    commit_activity_cache: Mutex<VecDeque<CommitActivityCacheEntry>>,
}

#[derive(Default)]
struct GenerationTracker {
    value: RepoGeneration,
    fingerprint: String,
}

struct PreviewRecord {
    repo_id: String,
    generation: RepoGeneration,
    action_hash: String,
    target_binding: Option<TargetBinding>,
    expires_at: SystemTime,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CommitActivityCacheKey {
    history_revision: String,
    bucket_boundaries_unix_seconds: Vec<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CommitActivityCacheEntry {
    key: CommitActivityCacheKey,
    result: CommitActivityResult,
}

fn prune_expired_preview_records(records: &mut HashMap<String, PreviewRecord>, now: SystemTime) {
    records.retain(|_, record| record.expires_at > now);
}

fn reserve_preview_capacity(records: &mut HashMap<String, PreviewRecord>) {
    while records.len() >= MAX_PREVIEW_RECORDS {
        let Some(oldest) = records
            .iter()
            .min_by_key(|(_, record)| record.expires_at)
            .map(|(token, _)| token.clone())
        else {
            break;
        };
        records.remove(&oldest);
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TargetBinding {
    resolved_targets: Vec<ResolvedTarget>,
    impact_digest: String,
    affected_paths: Vec<String>,
    affected_commits: Vec<String>,
    lost_commit_oids: Vec<String>,
}

#[derive(Clone)]
struct CloneLifecycle {
    operation_id: String,
    temporary_repo_id: String,
    event_seq: Arc<AtomicU64>,
    channel: Option<Channel<WorkspaceEvent>>,
}

impl CloneLifecycle {
    fn send(
        &self,
        phase: EventPhase,
        summary: LocalizedMessage,
        details: BTreeMap<String, String>,
    ) -> EventSeq {
        self.send_for_repo(&self.temporary_repo_id, phase, summary, details)
    }

    fn send_for_repo(
        &self,
        repo_id: &str,
        phase: EventPhase,
        summary: LocalizedMessage,
        details: BTreeMap<String, String>,
    ) -> EventSeq {
        let event_seq = self.event_seq.fetch_add(1, Ordering::SeqCst) + 1;
        if let Some(channel) = &self.channel {
            let _ = channel.send(WorkspaceEvent {
                repo_id: repo_id.to_owned(),
                event_seq,
                repo_generation: 0,
                operation_id: Some(self.operation_id.clone()),
                phase,
                summary,
                details,
            });
        }
        event_seq
    }
}

impl Workspace {
    pub fn system() -> WorkspaceResult<Self> {
        let git = GitExecutor::system()?;
        git.run(None, GitCommand::Version, None, None)?
            .ensure_success()?;
        Self::with_git(git)
    }

    pub(crate) fn with_git(git: GitExecutor) -> WorkspaceResult<Self> {
        let journal = JournalStore::new(default_journal_directory()?)?;
        Ok(Self::new(git, journal))
    }

    fn new(git: GitExecutor, journal: JournalStore) -> Self {
        Self {
            git,
            journal,
            repos: RwLock::new(HashMap::new()),
            previews: Mutex::new(HashMap::new()),
            running: Arc::new(Mutex::new(HashMap::new())),
            common_mutations: Mutex::new(HashMap::new()),
        }
    }

    fn attach(
        &self,
        request: OpenRequest,
        channel: Option<Channel<WorkspaceEvent>>,
    ) -> WorkspaceResult<WorkspaceSession> {
        let mut clone_lifecycle = None;
        let mut clone_control = None;
        let mut clone_output = None;
        let (requested_path, initialize_if_missing) = match request {
            OpenRequest::Open { path } => (PathBuf::from(path), true),
            OpenRequest::OpenExisting { path } => (PathBuf::from(path), false),
            OpenRequest::Clone {
                remote,
                destination,
                operation_id,
            } => {
                let destination = PathBuf::from(destination);
                let (lifecycle, control) = self.start_clone_lifecycle(
                    &operation_id,
                    &destination,
                    channel.as_ref().cloned(),
                )?;
                match self.run_clone(&lifecycle, &control, remote, &destination) {
                    Ok(output) => clone_output = Some(output),
                    Err(error) => {
                        self.finish_clone_lifecycle(&lifecycle, Some(&error), None, None);
                        return Err(error);
                    }
                }
                clone_lifecycle = Some(lifecycle);
                clone_control = Some(control);
                (destination, false)
            }
        };
        let mut result = (|| {
            if clone_control.as_ref().is_some_and(RunControl::is_cancelled) {
                return Err(cancelled_error());
            }
            let requested_path = match requested_path.canonicalize() {
                Ok(path) => path,
                Err(error)
                    if initialize_if_missing && error.kind() == std::io::ErrorKind::NotFound =>
                {
                    self.initialize_repository(&requested_path)?;
                    canonicalize_repository_path(&requested_path)?
                }
                Err(error) => return Err(open_path_error(error)),
            };
            let top_level =
                self.git
                    .run(Some(&requested_path), GitCommand::TopLevel, None, None)?;
            let root = if top_level.success() {
                canonicalize_git_path(&top_level)?
            } else if initialize_if_missing && is_not_a_git_repository(&top_level) {
                self.initialize_repository(&requested_path)?;
                command_path(&self.git, &requested_path, GitCommand::TopLevel)?
            } else {
                top_level.ensure_success()?;
                unreachable!("successful Git output returned from the failure branch")
            };
            let bare = self
                .git
                .run(Some(&root), GitCommand::IsBare, None, None)?
                .ensure_success()?
                .stdout_text();
            if bare.trim() == "true" {
                return Err(WorkspaceError::new(
                    ErrorCode::UnsupportedRepository,
                    "Bare repositories are not supported",
                ));
            }
            let git_dir = command_path(&self.git, &root, GitCommand::GitDir)?;
            let common_dir = command_path(&self.git, &root, GitCommand::CommonDir)?;
            self.ensure_lfs_repository_supported(&root, clone_control.as_ref())?;
            let id = repo_id(&root, &git_dir);
            let mutation = self
                .common_mutations
                .lock()
                .expect("common mutation lock")
                .entry(common_dir.clone())
                .or_insert_with(|| Arc::new(RwLock::new(())))
                .clone();

            let repo = {
                let existing = self
                    .repos
                    .read()
                    .expect("repos read lock")
                    .get(&id)
                    .cloned();
                if let Some(existing) = existing {
                    existing
                } else {
                    let repo = Arc::new(RepoContext {
                        id: id.clone(),
                        root,
                        git_dir,
                        common_dir,
                        mutation,
                        snapshot: Mutex::new(()),
                        tracker: Mutex::new(GenerationTracker::default()),
                        event_seq: AtomicU64::new(0),
                        channel: Mutex::new(None),
                        conflicts: Mutex::new(HashMap::new()),
                        commit_activity_cache: Mutex::new(VecDeque::new()),
                    });
                    self.repos
                        .write()
                        .expect("repos write lock")
                        .insert(id.clone(), repo.clone());
                    repo
                }
            };
            if let Some(channel) = channel {
                *repo.channel.lock().expect("channel lock") = Some(channel);
            }
            let snapshot = self.snapshot(&repo)?;
            if clone_control.as_ref().is_some_and(RunControl::is_cancelled) {
                return Err(cancelled_error());
            }
            Ok(WorkspaceSession {
                repo_id: id,
                snapshot,
            })
        })();
        if let Some(lifecycle) = &clone_lifecycle {
            let terminal_seq = self.finish_clone_lifecycle(
                lifecycle,
                result.as_ref().err(),
                result.as_ref().ok().map(|session| session.repo_id.as_str()),
                clone_output.as_ref(),
            );
            if let (Ok(session), Some(event_seq)) = (&mut result, terminal_seq) {
                session.snapshot.event_seq = event_seq;
            }
        }
        result
    }

    fn initialize_repository(&self, path: &Path) -> WorkspaceResult<()> {
        self.git
            .run(
                None,
                GitCommand::Init {
                    path: path.to_path_buf(),
                    initial_branch: "main".into(),
                },
                None,
                None,
            )?
            .ensure_success()?;
        Ok(())
    }

    fn ensure_lfs_repository_supported(
        &self,
        root: &Path,
        control: Option<&RunControl>,
    ) -> WorkspaceResult<()> {
        if self.git.has_lfs() {
            return Ok(());
        }
        let output = self
            .git
            .run(Some(root), GitCommand::AttributeFiles, None, control)?
            .ensure_success()?;
        let mut paths = vec![".gitattributes".to_owned()];
        paths.extend(
            output
                .stdout
                .split(|byte| *byte == 0)
                .filter(|path| !path.is_empty())
                .map(|path| String::from_utf8_lossy(path).into_owned()),
        );
        paths.sort();
        paths.dedup();
        for relative_path in paths {
            validate_path(&relative_path)?;
            let path = root.join(&relative_path);
            let Ok(metadata) = fs::symlink_metadata(&path) else {
                continue;
            };
            if !metadata.file_type().is_file() {
                continue;
            }
            let contents = fs::read_to_string(&path).map_err(|error| {
                WorkspaceError::new(
                    ErrorCode::Io,
                    format!("{relative_path}を確認できませんでした: {error}"),
                )
            })?;
            let uses_lfs = contents.lines().any(|line| {
                let rule = line.split_once('#').map_or(line, |(rule, _)| rule);
                rule.split_ascii_whitespace()
                    .any(|attribute| attribute == "filter=lfs")
            });
            if uses_lfs {
                return Err(WorkspaceError::new(
                    ErrorCode::UnsupportedRepository,
                    "このリポジトリはGit LFSを使用していますが、選択中のシステムツールチェーンにGit LFSがありません。",
                )
                .detail("path", relative_path)
                .detail("requiredComponent", "git-lfs"));
            }
        }
        Ok(())
    }

    fn start_clone_lifecycle(
        &self,
        operation_id: &str,
        destination: &Path,
        channel: Option<Channel<WorkspaceEvent>>,
    ) -> WorkspaceResult<(CloneLifecycle, RunControl)> {
        if operation_id.trim().is_empty() {
            return Err(WorkspaceError::new(
                ErrorCode::InvalidRequest,
                "Clone operationId is required",
            ));
        }
        let control = RunControl::new();
        {
            let mut running = self.running.lock().expect("running lock");
            if running.contains_key(operation_id) {
                return Err(WorkspaceError::new(
                    ErrorCode::OperationInProgress,
                    "An operation with the same operationId is already running",
                ));
            }
            running.insert(operation_id.to_owned(), control.clone());
        }
        let lifecycle = CloneLifecycle {
            operation_id: operation_id.to_owned(),
            temporary_repo_id: clone_temporary_repo_id(destination),
            event_seq: Arc::new(AtomicU64::new(0)),
            channel,
        };
        lifecycle.send(
            EventPhase::Started,
            LocalizedMessage::new("backendCloneStarted"),
            BTreeMap::new(),
        );
        Ok((lifecycle, control))
    }

    fn run_clone(
        &self,
        lifecycle: &CloneLifecycle,
        control: &RunControl,
        remote: String,
        destination: &Path,
    ) -> WorkspaceResult<GitOutput> {
        validate_remote(&remote)?;
        if destination.as_os_str().is_empty() {
            return Err(WorkspaceError::new(
                ErrorCode::InvalidRequest,
                "Clone destination is required",
            ));
        }
        std::thread::scope(|scope| {
            let (finished, progress_finished) = mpsc::channel();
            let progress = lifecycle.clone();
            let heartbeat = scope.spawn(move || {
                loop {
                    match progress_finished.recv_timeout(Duration::from_millis(500)) {
                        Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                        Err(mpsc::RecvTimeoutError::Timeout) => {
                            progress.send(
                                EventPhase::Progress,
                                LocalizedMessage::new("backendCloningRepository"),
                                BTreeMap::new(),
                            );
                        }
                    }
                }
            });
            let result = self
                .git
                .run(
                    None,
                    GitCommand::Clone {
                        remote,
                        destination: destination.to_path_buf(),
                    },
                    None,
                    Some(control),
                )?
                .ensure_success();
            let _ = finished.send(());
            let _ = heartbeat.join();
            result
        })
    }

    fn finish_clone_lifecycle(
        &self,
        lifecycle: &CloneLifecycle,
        error: Option<&WorkspaceError>,
        attached_repo_id: Option<&str>,
        output: Option<&GitOutput>,
    ) -> Option<EventSeq> {
        self.running
            .lock()
            .expect("running lock")
            .remove(&lifecycle.operation_id);
        match error {
            None => {
                let mut details = BTreeMap::new();
                if let Some(repo_id) = attached_repo_id {
                    details.insert("attachedRepoId".into(), repo_id.to_owned());
                }
                if let Some(output) = output {
                    details.extend(command_activity_details(&output.activity()));
                }
                let event_seq = lifecycle.send_for_repo(
                    attached_repo_id.unwrap_or(&lifecycle.temporary_repo_id),
                    EventPhase::Completed,
                    LocalizedMessage::new("backendCloneCompleted"),
                    details,
                );
                if let Some(repo_id) = attached_repo_id
                    && let Some(repo) = self.repos.read().expect("repos read lock").get(repo_id)
                {
                    repo.event_seq.fetch_max(event_seq, Ordering::SeqCst);
                }
                Some(event_seq)
            }
            Some(error) => {
                lifecycle.send(
                    if error.code == ErrorCode::Cancelled {
                        EventPhase::Cancelled
                    } else {
                        EventPhase::Failed
                    },
                    error.localized_message.clone(),
                    error.details.clone(),
                );
                None
            }
        }
    }

    #[cfg(test)]
    fn query(&self, request: QueryRequest) -> WorkspaceResult<QueryOutcome> {
        let registration = self.prepare_query(&request)?;
        self.query_prepared(request, registration)
    }

    fn prepare_query(&self, request: &QueryRequest) -> WorkspaceResult<Option<QueryRegistration>> {
        let Query::CommitActivity {
            operation_id,
            bucket_boundaries_unix_seconds,
        } = &request.query
        else {
            return Ok(None);
        };

        // 通常の問い合わせエラーの優先順位を維持しつつ、Tauriコマンドがワーカーを予約する前に登録する。
        self.repo(&request.repo_id)?;
        if operation_id.trim().is_empty() {
            return Err(WorkspaceError::new(
                ErrorCode::InvalidRequest,
                "operationId is required",
            ));
        }
        validate_commit_activity_boundaries(bucket_boundaries_unix_seconds)?;

        let control = RunControl::new();
        {
            let mut running = self.running.lock().expect("running lock");
            if running.contains_key(operation_id) {
                return Err(WorkspaceError::new(
                    ErrorCode::OperationInProgress,
                    "An operation with the same operationId is already running",
                ));
            }
            running.insert(operation_id.clone(), control.clone());
        }
        Ok(Some(QueryRegistration {
            operation_id: operation_id.clone(),
            control,
            running: self.running.clone(),
        }))
    }

    fn query_prepared(
        &self,
        request: QueryRequest,
        registration: Option<QueryRegistration>,
    ) -> WorkspaceResult<QueryOutcome> {
        if let Query::RepositoryAvailability { path } = &request.query {
            return Ok(QueryOutcome::RepositoryAvailability(
                self.repository_availability(path.clone()),
            ));
        }
        let repo = self.repo(&request.repo_id)?;
        match request.query {
            Query::RepositoryAvailability { .. } => unreachable!("handled before repo lookup"),
            Query::Status => Ok(QueryOutcome::Status(self.snapshot(&repo)?)),
            Query::Diff { target, paths } => {
                let snapshot = self.snapshot(&repo)?;
                validate_paths(&paths)?;
                let material = self.diff_material(&repo, &snapshot, target, &paths, None)?;
                let revision = hash(&material.bytes);
                let truncated = material.truncated || material.bytes.len() > DIFF_LIMIT;
                let bytes = if truncated {
                    &material.bytes[..material.bytes.len().min(DIFF_LIMIT)]
                } else {
                    &material.bytes
                };
                let patch = String::from_utf8_lossy(bytes).into_owned();
                Ok(QueryOutcome::Diff(DiffResult {
                    patch,
                    diff_revision: revision,
                    repo_generation: snapshot.repo_generation,
                    truncated,
                }))
            }
            Query::History {
                limit,
                skip,
                search,
            } => {
                let snapshot = self.snapshot(&repo)?;
                let requested_limit = limit.clamp(1, HISTORY_PAGE_LIMIT);
                let normalized_search = search
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_lowercase);
                let read_page = |page_limit: u32, page_skip: u32| {
                    let output = self.git.run(
                        Some(&repo.root),
                        GitCommand::History {
                            limit: page_limit,
                            skip: page_skip,
                        },
                        None,
                        None,
                    )?;
                    if output.success() {
                        Ok(parse_history(&output.stdout_text()))
                    } else if matches!(&snapshot.head, HeadState::Unborn { .. }) {
                        Ok(Vec::new())
                    } else {
                        Err(output.ensure_success().expect_err("failed history"))
                    }
                };
                let commits = if let Some(search) = normalized_search {
                    let mut commits = Vec::with_capacity(requested_limit as usize);
                    let mut raw_skip = 0_u32;
                    let mut matched = 0_u32;
                    loop {
                        let page = read_page(HISTORY_PAGE_LIMIT, raw_skip)?;
                        let page_len = page.len() as u32;
                        for commit in page {
                            if !history_commit_matches_search(&commit, &search) {
                                continue;
                            }
                            if matched >= skip {
                                commits.push(commit);
                            }
                            matched = matched.saturating_add(1);
                            if commits.len() >= requested_limit as usize {
                                break;
                            }
                        }
                        if commits.len() >= requested_limit as usize
                            || page_len < HISTORY_PAGE_LIMIT
                        {
                            break;
                        }
                        let next_skip = raw_skip.saturating_add(page_len);
                        if next_skip == raw_skip {
                            break;
                        }
                        raw_skip = next_skip;
                    }
                    commits
                } else {
                    read_page(requested_limit, skip)?
                };
                Ok(QueryOutcome::History(HistoryResult {
                    commits,
                    repo_generation: snapshot.repo_generation,
                }))
            }
            Query::CommitActivity {
                operation_id,
                bucket_boundaries_unix_seconds,
            } => {
                let registration = registration.as_ref().ok_or_else(|| {
                    WorkspaceError::new(
                        ErrorCode::Internal,
                        "Commit activity query was not registered",
                    )
                })?;
                if registration.operation_id != operation_id {
                    return Err(WorkspaceError::new(
                        ErrorCode::Internal,
                        "Commit activity query registration did not match the request",
                    ));
                }
                self.query_commit_activity_registered(
                    &repo,
                    &bucket_boundaries_unix_seconds,
                    &registration.control,
                )
                .map(QueryOutcome::CommitActivity)
            }
            Query::Branches => {
                let snapshot = self.snapshot(&repo)?;
                let output = self
                    .git
                    .run(Some(&repo.root), GitCommand::Branches, None, None)?
                    .ensure_success()?;
                Ok(QueryOutcome::Branches(BranchResult {
                    branches: parse_branches(&output.stdout),
                    repo_generation: snapshot.repo_generation,
                }))
            }
            Query::GitFlowOverview => {
                let snapshot = self.snapshot(&repo)?;
                git_flow::overview(&self.git, &repo.root, snapshot.repo_generation)
                    .map(QueryOutcome::GitFlowOverview)
            }
            Query::CommitDetails { oid } => {
                validate_revision(&oid)?;
                let snapshot = self.snapshot(&repo)?;
                let resolved = self
                    .git
                    .run(
                        Some(&repo.root),
                        GitCommand::Resolve { revision: oid },
                        None,
                        None,
                    )?
                    .ensure_success()?
                    .stdout_text()
                    .trim()
                    .to_owned();
                let metadata = self
                    .git
                    .run(
                        Some(&repo.root),
                        GitCommand::CommitMetadata {
                            oid: resolved.clone(),
                        },
                        None,
                        None,
                    )?
                    .ensure_success()?;
                let fields: Vec<&[u8]> = metadata.stdout.splitn(8, |byte| *byte == 0).collect();
                if fields.len() != 8 {
                    return Err(WorkspaceError::new(
                        ErrorCode::GitFailed,
                        "Failed to parse commit metadata",
                    ));
                }
                let text = |value: &[u8]| String::from_utf8_lossy(value).trim().to_owned();
                let parents: Vec<String> = text(fields[1])
                    .split_whitespace()
                    .map(str::to_owned)
                    .collect();
                let patch_output = self
                    .git
                    .run(
                        Some(&repo.root),
                        GitCommand::CommitPatch {
                            oid: resolved.clone(),
                            parent: parents.first().cloned(),
                            paths: Vec::new(),
                        },
                        None,
                        None,
                    )?
                    .ensure_success()?;
                let truncated = patch_output.truncated || patch_output.stdout.len() > DIFF_LIMIT;
                let files = if truncated {
                    let name_status = self
                        .git
                        .run(
                            Some(&repo.root),
                            GitCommand::CommitNameStatus {
                                oid: resolved.clone(),
                                parent: parents.first().cloned(),
                            },
                            None,
                            None,
                        )?
                        .ensure_success()?;
                    Some(parse_commit_diff_files(&name_status.stdout)?)
                } else {
                    None
                };
                let patch = if truncated {
                    String::new()
                } else {
                    String::from_utf8_lossy(&patch_output.stdout).into_owned()
                };
                Ok(QueryOutcome::CommitDetails(CommitDetails {
                    oid: resolved,
                    parents,
                    refs: text(fields[2])
                        .split(',')
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(str::to_owned)
                        .collect(),
                    author: text(fields[3]),
                    author_email: text(fields[4]),
                    authored_at: text(fields[5]),
                    subject: text(fields[6]),
                    body: text(fields[7]),
                    diff_revision: hash(&patch_output.stdout),
                    patch,
                    truncated,
                    repo_generation: snapshot.repo_generation,
                    files,
                }))
            }
            Query::CommitFileDiff {
                oid,
                path,
                previous_path,
            } => {
                validate_revision(&oid)?;
                validate_path(&path)?;
                if let Some(previous_path) = &previous_path {
                    validate_path(previous_path)?;
                }
                let snapshot = self.snapshot(&repo)?;
                let resolved = self
                    .git
                    .run(
                        Some(&repo.root),
                        GitCommand::Resolve { revision: oid },
                        None,
                        None,
                    )?
                    .ensure_success()?
                    .stdout_text()
                    .trim()
                    .to_owned();
                let parents = self
                    .git
                    .run(
                        Some(&repo.root),
                        GitCommand::CommitParents {
                            oid: resolved.clone(),
                        },
                        None,
                        None,
                    )?
                    .ensure_success()?
                    .stdout_text()
                    .split_whitespace()
                    .map(str::to_owned)
                    .collect::<Vec<_>>();
                let mut paths = vec![path.clone()];
                if let Some(previous_path) = &previous_path
                    && previous_path != &path
                {
                    paths.insert(0, previous_path.clone());
                }
                let output = self
                    .git
                    .run(
                        Some(&repo.root),
                        GitCommand::CommitPatch {
                            oid: resolved,
                            parent: parents.first().cloned(),
                            paths,
                        },
                        None,
                        None,
                    )?
                    .ensure_success()?;
                let truncated = output.truncated || output.stdout.len() > DIFF_LIMIT;
                Ok(QueryOutcome::CommitFileDiff(DiffResult {
                    patch: if truncated {
                        String::new()
                    } else {
                        String::from_utf8_lossy(&output.stdout).into_owned()
                    },
                    truncated,
                    diff_revision: hash(&output.stdout),
                    repo_generation: snapshot.repo_generation,
                }))
            }
            Query::Conflict { path } => {
                validate_path(&path)?;
                let snapshot = self.snapshot(&repo)?;
                let (mut document, mut session) = conflict::load(
                    &self.git,
                    &repo.root,
                    &repo.id,
                    &path,
                    &snapshot.operation,
                    None,
                )?;
                let mut sessions = repo.conflicts.lock().expect("conflicts lock");
                if let Some(existing) = sessions
                    .values()
                    .find(|existing| {
                        existing.path == path
                            && existing.generation == session.generation
                            && existing.content_hash == session.content_hash
                            && existing.kind == session.kind
                    })
                    .cloned()
                {
                    document.session_id = existing.id;
                    document.result.text = existing.draft_text;
                    document.blocks = existing.blocks;
                    return Ok(QueryOutcome::Conflict(Box::new(document)));
                }
                if let Some(existing) = sessions.values().find(|existing| existing.path == path)
                    && let Some(baseline) = &existing.external_baseline_hash
                {
                    session.external_baseline_hash = Some(baseline.clone());
                    if baseline != &session.content_hash {
                        session.resolution_evidence = true;
                    }
                }
                sessions.retain(|_, existing| existing.path != path);
                sessions.insert(session.id.clone(), session);
                Ok(QueryOutcome::Conflict(Box::new(document)))
            }
            Query::FileContents { path } => {
                validate_path(&path)?;
                let snapshot = self.snapshot(&repo)?;
                let entry = snapshot
                    .entries
                    .iter()
                    .find(|entry| entry.path == path)
                    .ok_or_else(|| {
                        WorkspaceError::new(
                            ErrorCode::InvalidRequest,
                            "Only working tree files can be edited",
                        )
                        .localized_message(LocalizedMessage::new("fileEditUnavailable"))
                        .detail("path", path.clone())
                    })?;
                if entry.conflict || entry.submodule != "N..." {
                    return Err(WorkspaceError::new(
                        ErrorCode::InvalidRequest,
                        "Conflicted files and submodules cannot be edited here",
                    )
                    .localized_message(LocalizedMessage::new("fileEditUnsupported").arg(
                        "context",
                        if entry.conflict {
                            "conflict"
                        } else {
                            "submodule"
                        },
                    ))
                    .detail("path", path)
                    .detail(
                        "reason",
                        if entry.conflict {
                            "conflict"
                        } else {
                            "submodule"
                        },
                    ));
                }
                let contents = load_editable_file(&self.git, &repo.root, &path, None)?;
                Ok(QueryOutcome::FileContents(FileDocument {
                    repo_id: repo.id.clone(),
                    path,
                    text: contents.text,
                    line_ending: contents.line_ending,
                    has_utf8_bom: contents.has_utf8_bom,
                    content_hash: contents.content_hash,
                    repo_generation: snapshot.repo_generation,
                }))
            }
            Query::Remotes => {
                let snapshot = self.snapshot(&repo)?;
                Ok(QueryOutcome::Remotes(RemoteResult {
                    remotes: self.remote_definitions(&repo, None)?,
                    repo_generation: snapshot.repo_generation,
                }))
            }
        }
    }

    fn image_bytes(&self, request: ImageBytesRequest) -> WorkspaceResult<Vec<u8>> {
        let repo = self.repo(&request.repo_id)?;
        match request.target {
            ImageBytesTarget::WorkingTree {
                path,
                previous_path,
                area,
                generation,
                diff_id,
            } => {
                validate_path(&path)?;
                if let Some(previous_path) = &previous_path {
                    validate_path(previous_path)?;
                }
                let snapshot = self.snapshot(&repo)?;
                ensure_generation(generation, snapshot.repo_generation)?;
                let diff_target = match area {
                    ImageChangeArea::Staged => DiffTarget::Staged,
                    ImageChangeArea::Unstaged => DiffTarget::Unstaged,
                    ImageChangeArea::Untracked => DiffTarget::Unstaged,
                };
                let mut diff_paths = previous_path.iter().cloned().collect::<Vec<_>>();
                if !diff_paths.iter().any(|candidate| candidate == &path) {
                    diff_paths.push(path.clone());
                }
                let material =
                    self.diff_material(&repo, &snapshot, diff_target, &diff_paths, None)?;
                if material.bytes.is_empty() || hash(&material.bytes) != diff_id {
                    return Err(stale_image_error());
                }
                ensure_image_target_in_patch(&material.bytes, &path, previous_path.as_deref())?;
                let before_path = previous_path.as_deref().unwrap_or(&path);
                match (area, request.side) {
                    (ImageChangeArea::Staged, ImageDiffSide::Before) => {
                        let head = snapshot_head_oid(&snapshot).ok_or_else(image_side_missing)?;
                        self.tree_image_bytes(&repo, &head, before_path)
                    }
                    (ImageChangeArea::Staged, ImageDiffSide::After) => {
                        self.index_image_bytes(&repo, &path)
                    }
                    (ImageChangeArea::Unstaged, ImageDiffSide::Before) => {
                        self.index_image_bytes(&repo, before_path)
                    }
                    (ImageChangeArea::Unstaged, ImageDiffSide::After)
                    | (ImageChangeArea::Untracked, ImageDiffSide::After) => {
                        load_raw_file(&repo.root, &path, OUTPUT_LIMIT)
                    }
                    (ImageChangeArea::Untracked, ImageDiffSide::Before) => {
                        Err(image_side_missing())
                    }
                }
            }
            ImageBytesTarget::Commit {
                oid,
                path,
                previous_path,
                diff_id,
                patch_scope,
            } => {
                validate_revision(&oid)?;
                validate_path(&path)?;
                if let Some(previous_path) = &previous_path {
                    validate_path(previous_path)?;
                }
                let resolved = self
                    .git
                    .run(
                        Some(&repo.root),
                        GitCommand::Resolve { revision: oid },
                        None,
                        None,
                    )?
                    .ensure_success()?
                    .stdout_text()
                    .trim()
                    .to_owned();
                let parents = self
                    .git
                    .run(
                        Some(&repo.root),
                        GitCommand::CommitParents {
                            oid: resolved.clone(),
                        },
                        None,
                        None,
                    )?
                    .ensure_success()?
                    .stdout_text()
                    .split_whitespace()
                    .map(str::to_owned)
                    .collect::<Vec<_>>();
                let matches_image_diff = |patch: &GitOutput| {
                    !patch.truncated
                        && patch.stdout.len() <= DIFF_LIMIT
                        && hash(&patch.stdout) == diff_id
                };
                let mut paths = vec![path.clone()];
                if let Some(previous_path) = &previous_path
                    && previous_path != &path
                {
                    paths.insert(0, previous_path.clone());
                }
                let scoped_patch = || {
                    self.git
                        .run(
                            Some(&repo.root),
                            GitCommand::CommitPatch {
                                oid: resolved.clone(),
                                parent: parents.first().cloned(),
                                paths: paths.clone(),
                            },
                            None,
                            None,
                        )?
                        .ensure_success()
                };
                let patch = match patch_scope {
                    CommitImagePatchScope::File => scoped_patch()?,
                    CommitImagePatchScope::All => self
                        .git
                        .run(
                            Some(&repo.root),
                            GitCommand::CommitPatch {
                                oid: resolved.clone(),
                                parent: parents.first().cloned(),
                                paths: Vec::new(),
                            },
                            None,
                            None,
                        )?
                        .ensure_success()?,
                };
                if !matches_image_diff(&patch) {
                    return Err(stale_image_error());
                }
                ensure_image_target_in_patch(&patch.stdout, &path, previous_path.as_deref())?;
                match request.side {
                    ImageDiffSide::Before => {
                        let parent = parents.first().ok_or_else(image_side_missing)?;
                        self.tree_image_bytes(
                            &repo,
                            parent,
                            previous_path.as_deref().unwrap_or(&path),
                        )
                    }
                    ImageDiffSide::After => self.tree_image_bytes(&repo, &resolved, &path),
                }
            }
        }
    }

    fn index_image_bytes(&self, repo: &RepoContext, path: &str) -> WorkspaceResult<Vec<u8>> {
        let output = self
            .git
            .run(
                Some(&repo.root),
                GitCommand::IndexEntries {
                    paths: vec![path.to_owned()],
                },
                None,
                None,
            )?
            .ensure_success()?;
        let entry = parse_index_entries(&output.stdout)?
            .into_iter()
            .find(|entry| entry.stage == 0 && entry.path == path)
            .ok_or_else(image_side_missing)?;
        self.git_blob_image_bytes(repo, path, &entry.mode, &entry.oid)
    }

    fn tree_image_bytes(
        &self,
        repo: &RepoContext,
        treeish: &str,
        path: &str,
    ) -> WorkspaceResult<Vec<u8>> {
        let output = self
            .git
            .run(
                Some(&repo.root),
                GitCommand::TreeEntries {
                    treeish: treeish.to_owned(),
                    paths: vec![path.to_owned()],
                },
                None,
                None,
            )?
            .ensure_success()?;
        let entry = parse_tree_entries(&output.stdout)?
            .into_iter()
            .find(|entry| entry.path == path)
            .ok_or_else(image_side_missing)?;
        if entry.kind != "blob" {
            return Err(image_file_type_error(path));
        }
        self.git_blob_image_bytes(repo, path, &entry.mode, &entry.oid)
    }

    fn git_blob_image_bytes(
        &self,
        repo: &RepoContext,
        path: &str,
        mode: &str,
        oid: &str,
    ) -> WorkspaceResult<Vec<u8>> {
        if !mode.starts_with("100") {
            return Err(image_file_type_error(path));
        }
        let size = self
            .git
            .run(
                Some(&repo.root),
                GitCommand::CatFileSize {
                    oid: oid.to_owned(),
                },
                None,
                None,
            )?
            .ensure_success()?
            .stdout_text()
            .trim()
            .parse::<usize>()
            .map_err(|_| {
                WorkspaceError::new(
                    ErrorCode::UnsupportedRepository,
                    "Failed to read the image blob size",
                )
            })?;
        if size > OUTPUT_LIMIT {
            return Err(image_too_large_error(path));
        }
        let output = self
            .git
            .run(
                Some(&repo.root),
                GitCommand::CatFile {
                    oid: oid.to_owned(),
                },
                None,
                None,
            )?
            .ensure_success()?;
        if output.truncated || output.stdout.len() != size {
            return Err(WorkspaceError::new(
                ErrorCode::GitFailed,
                "The image blob changed while it was being read",
            ));
        }
        Ok(output.stdout)
    }

    fn repository_availability(&self, path: String) -> RepositoryAvailabilityResult {
        let requested = PathBuf::from(&path);
        let availability = match requested.canonicalize() {
            Ok(canonical) => match self
                .git
                .run(Some(&canonical), GitCommand::TopLevel, None, None)
            {
                Ok(output) if output.success() => RepositoryAvailability::Available,
                Ok(output) if is_not_a_git_repository(&output) => {
                    RepositoryAvailability::NotRepository
                }
                Ok(_) | Err(_) => RepositoryAvailability::Inaccessible,
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                RepositoryAvailability::Missing
            }
            Err(_) => RepositoryAvailability::Inaccessible,
        };
        RepositoryAvailabilityResult { path, availability }
    }

    fn remote_definitions(
        &self,
        repo: &RepoContext,
        control: Option<&RunControl>,
    ) -> WorkspaceResult<Vec<RemoteDefinition>> {
        let names = self
            .git
            .run(Some(&repo.root), GitCommand::RemoteNames, None, control)?
            .ensure_success()?
            .stdout_text();
        names
            .lines()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(|name| {
                validate_remote(name)?;
                let urls = |push| -> WorkspaceResult<Vec<String>> {
                    Ok(self
                        .git
                        .run(
                            Some(&repo.root),
                            GitCommand::RemoteUrls {
                                remote: name.to_owned(),
                                push,
                            },
                            None,
                            control,
                        )?
                        .ensure_success()?
                        .stdout_text()
                        .lines()
                        .map(str::trim)
                        .filter(|url| !url.is_empty())
                        .map(str::to_owned)
                        .collect())
                };
                Ok(RemoteDefinition {
                    name: name.to_owned(),
                    fetch_urls: urls(false)?,
                    push_urls: urls(true)?,
                })
            })
            .collect()
    }

    fn query_commit_activity_registered(
        &self,
        repo: &RepoContext,
        bucket_boundaries_unix_seconds: &[i64],
        control: &RunControl,
    ) -> WorkspaceResult<CommitActivityResult> {
        let mut last_before = String::new();
        let mut last_after = String::new();

        for _attempt in 0..2 {
            if control.is_cancelled() {
                return Err(cancelled_error());
            }
            let snapshot = self.snapshot(repo)?;
            if control.is_cancelled() {
                return Err(cancelled_error());
            }
            let head_oid = snapshot_head_oid(&snapshot);
            let history_revision = head_oid
                .clone()
                .unwrap_or_else(|| UNBORN_HISTORY_REVISION.to_owned());
            let key = CommitActivityCacheKey {
                history_revision: history_revision.clone(),
                bucket_boundaries_unix_seconds: bucket_boundaries_unix_seconds.to_vec(),
            };

            let cached = {
                let mut cache = repo
                    .commit_activity_cache
                    .lock()
                    .expect("commit activity cache lock");
                commit_activity_cache_get(&mut cache, &key)
            };
            let mut result = if let Some(cached) = cached {
                cached
            } else if let Some(head_oid) = &head_oid {
                self.scan_commit_activity(repo, head_oid, bucket_boundaries_unix_seconds, control)?
            } else {
                aggregate_commit_activity(
                    "",
                    bucket_boundaries_unix_seconds,
                    COMMIT_ACTIVITY_SCAN_LIMIT,
                )?
            };

            let after_head = self.head_oid_optional(repo, control)?;
            if after_head != head_oid {
                last_before = history_revision;
                last_after = after_head.unwrap_or_else(|| UNBORN_HISTORY_REVISION.to_owned());
                continue;
            }

            result.repo_generation = snapshot.repo_generation;
            result.history_revision = history_revision;
            let (branch_total, branch_counts) =
                self.local_branch_activity(repo, bucket_boundaries_unix_seconds, control)?;
            result.totals.branches = branch_total;
            for (bucket, branch_count) in result.buckets.iter_mut().zip(branch_counts) {
                bucket.branch_count = branch_count;
            }
            let after_branches_head = self.head_oid_optional(repo, control)?;
            if after_branches_head != head_oid {
                last_before = result.history_revision.clone();
                last_after =
                    after_branches_head.unwrap_or_else(|| UNBORN_HISTORY_REVISION.to_owned());
                continue;
            }
            {
                let mut cache = repo
                    .commit_activity_cache
                    .lock()
                    .expect("commit activity cache lock");
                commit_activity_cache_insert(
                    &mut cache,
                    CommitActivityCacheEntry {
                        key,
                        result: result.clone(),
                    },
                );
            }
            return Ok(result);
        }

        Err(WorkspaceError::new(
            ErrorCode::StaleGeneration,
            "HEAD changed while commit activity was being read. Retry the query",
        )
        .detail("beforeHead", last_before)
        .detail("afterHead", last_after))
    }

    fn scan_commit_activity(
        &self,
        repo: &RepoContext,
        head_oid: &str,
        bucket_boundaries_unix_seconds: &[i64],
        control: &RunControl,
    ) -> WorkspaceResult<CommitActivityResult> {
        let start = bucket_boundaries_unix_seconds[0];
        let end = *bucket_boundaries_unix_seconds
            .last()
            .expect("validated commit activity boundaries");
        let output = self
            .git
            .run(
                Some(&repo.root),
                GitCommand::CommitActivity {
                    head_oid: head_oid.to_owned(),
                    since_unix_seconds: start.saturating_sub(1),
                    until_unix_seconds: end.saturating_sub(1),
                    limit: COMMIT_ACTIVITY_SCAN_LIMIT + 1,
                },
                None,
                Some(control),
            )?
            .ensure_success()?;
        aggregate_commit_activity(
            &output.stdout_text(),
            bucket_boundaries_unix_seconds,
            COMMIT_ACTIVITY_SCAN_LIMIT,
        )
    }

    fn head_oid_optional(
        &self,
        repo: &RepoContext,
        control: &RunControl,
    ) -> WorkspaceResult<Option<String>> {
        let output = self
            .git
            .run(Some(&repo.root), GitCommand::HeadOid, None, Some(control))?;
        if output.cancelled {
            return Err(cancelled_error());
        }
        Ok(output
            .success()
            .then(|| output.stdout_text().trim().to_owned()))
    }

    fn local_branch_activity(
        &self,
        repo: &RepoContext,
        boundaries: &[i64],
        control: &RunControl,
    ) -> WorkspaceResult<(u64, Vec<u64>)> {
        let output = self
            .git
            .run(Some(&repo.root), GitCommand::Branches, None, Some(control))?
            .ensure_success()?;
        let mut bucket_counts = vec![0; boundaries.len().saturating_sub(1)];
        let mut total = 0_u64;
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            let fields = line.split('\0').collect::<Vec<_>>();
            if fields.len() != 6 || !fields[0].starts_with("refs/heads/") {
                continue;
            }
            total += 1;
            let Ok(committed_at) = fields[5].parse::<i64>() else {
                continue;
            };
            if let Some(index) = bucket_index(boundaries, committed_at) {
                bucket_counts[index] += 1;
            }
        }
        Ok((total, bucket_counts))
    }

    fn preview(&self, request: PreviewRequest) -> WorkspaceResult<PreviewOutcome> {
        let repo = self.repo(&request.repo_id)?;
        let snapshot = self.snapshot(&repo)?;
        ensure_generation(request.expected_generation, snapshot.repo_generation)?;
        validate_action(&request.action)?;
        validate_action_targets(&snapshot, &request.action)?;
        ensure_action_allowed(&repo, &snapshot, &request.action)?;

        let destructive = request.action.requires_confirmation();
        let target_binding = self.target_binding(&repo, &snapshot, &request.action, None)?;
        let affected_paths = target_binding.as_ref().map_or_else(
            || action_paths(&request.action),
            |value| value.affected_paths.clone(),
        );
        let affected_commits = target_binding.as_ref().map_or_else(
            || action_commits(&request.action),
            |value| value.affected_commits.clone(),
        );
        let remote_effect = remote_effect(&self.git, &repo.root, &request.action)?;
        let summary = preview_summary(&request.action, target_binding.as_ref());
        let (confirmation_token, expires_at_unix_ms) = if request.action.requires_preview_binding()
        {
            let token = Uuid::new_v4().to_string();
            let now = SystemTime::now();
            let expires_at = now + PREVIEW_TTL;
            let action_hash = action_hash(&request.action)?;
            let mut previews = self.previews.lock().expect("previews lock");
            prune_expired_preview_records(&mut previews, now);
            reserve_preview_capacity(&mut previews);
            previews.insert(
                token.clone(),
                PreviewRecord {
                    repo_id: repo.id.clone(),
                    generation: snapshot.repo_generation,
                    action_hash,
                    target_binding: target_binding.clone(),
                    expires_at,
                },
            );
            (
                Some(token),
                Some(
                    expires_at
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis(),
                ),
            )
        } else {
            (None, None)
        };
        Ok(PreviewOutcome {
            confirmation_token,
            expires_at_unix_ms,
            summary,
            destructive,
            affected_paths,
            affected_commits,
            remote_effect,
            resolved_targets: target_binding
                .as_ref()
                .map_or_else(Vec::new, |value| value.resolved_targets.clone()),
            impact_digest: target_binding
                .as_ref()
                .map(|value| value.impact_digest.clone()),
            lost_commit_oids: target_binding.map_or_else(Vec::new, |value| value.lost_commit_oids),
        })
    }

    fn target_binding(
        &self,
        repo: &RepoContext,
        snapshot: &RepoSnapshot,
        action: &Action,
        control: Option<&RunControl>,
    ) -> WorkspaceResult<Option<TargetBinding>> {
        let input = match action {
            Action::Reset { commit, .. }
            | Action::CherryPick { commit, .. }
            | Action::Revert { commit, .. } => Some(commit.clone()),
            Action::Merge { source, .. } => Some(source.clone()),
            Action::Rebase { onto } => Some(onto.clone()),
            Action::CreateBranch { start_point, .. } => Some(start_point.clone()),
            Action::DeleteBranch { name } => Some(format!("refs/heads/{name}")),
            Action::CreateTag { target, .. } => Some(target.clone()),
            _ => None,
        };
        let current_head = snapshot_head_oid(snapshot);
        let mut affected_paths = Vec::new();
        let mut affected_commits = Vec::new();
        let mut lost_commit_oids = Vec::new();
        let mut resolved_targets = Vec::new();

        if let Action::SetRemoteUrl {
            remote,
            url_kind,
            expected_url,
            ..
        } = action
        {
            let definition = self
                .remote_definitions(repo, control)?
                .into_iter()
                .find(|definition| definition.name == *remote)
                .ok_or_else(|| {
                    WorkspaceError::new(ErrorCode::PreviewMismatch, "The remote no longer exists")
                })?;
            let urls = match url_kind {
                RemoteUrlKind::Fetch => &definition.fetch_urls,
                RemoteUrlKind::Push => &definition.push_urls,
            };
            if !urls.contains(expected_url) {
                return Err(WorkspaceError::new(
                    ErrorCode::PreviewMismatch,
                    "The remote URL changed before confirmation",
                ));
            }
            let impact_payload = serde_json::to_vec(&(
                action.kind_name(),
                remote,
                url_kind,
                urls,
                &snapshot.operation,
            ))
            .map_err(|error| WorkspaceError::new(ErrorCode::Internal, error.to_string()))?;
            return Ok(Some(TargetBinding {
                resolved_targets: Vec::new(),
                impact_digest: hash(&impact_payload),
                affected_paths: Vec::new(),
                affected_commits: Vec::new(),
                lost_commit_oids: Vec::new(),
            }));
        }

        if let Action::AddRemote { remote, .. } = action {
            let remotes = self.remote_definitions(repo, control)?;
            if remotes.iter().any(|definition| definition.name == *remote) {
                return Err(WorkspaceError::new(
                    ErrorCode::PreviewMismatch,
                    "The remote already exists",
                ));
            }
            let impact_payload = serde_json::to_vec(&(
                action.kind_name(),
                remote,
                remotes
                    .iter()
                    .map(|definition| &definition.name)
                    .collect::<Vec<_>>(),
                &snapshot.operation,
            ))
            .map_err(|error| WorkspaceError::new(ErrorCode::Internal, error.to_string()))?;
            return Ok(Some(TargetBinding {
                resolved_targets: Vec::new(),
                impact_digest: hash(&impact_payload),
                affected_paths: Vec::new(),
                affected_commits: Vec::new(),
                lost_commit_oids: Vec::new(),
            }));
        }

        let oid = if let Some(input) = input {
            let oid = self
                .git
                .run(
                    Some(&repo.root),
                    GitCommand::Resolve {
                        revision: input.clone(),
                    },
                    None,
                    control,
                )?
                .ensure_success()?
                .stdout_text()
                .trim()
                .to_owned();
            affected_commits.push(oid.clone());
            resolved_targets.push(ResolvedTarget {
                input: input.clone(),
                oid: oid.clone(),
            });
            Some(oid)
        } else {
            None
        };
        let structured_parent = match (action, oid.as_deref()) {
            (Action::CherryPick { mainline, .. } | Action::Revert { mainline, .. }, Some(oid)) => {
                self.structured_parent_oid(repo, oid, *mainline, control)?
            }
            _ => None,
        };

        match action {
            Action::Reset { mode, .. } => {
                let oid = oid.as_ref().expect("reset target was resolved");
                let head = current_head.as_ref().ok_or_else(|| {
                    WorkspaceError::new(ErrorCode::InvalidRequest, "Cannot reset an unborn HEAD")
                })?;
                let target_changed_paths = self.changed_paths(repo, oid, head, control)?;
                affected_paths = target_changed_paths.clone();
                if matches!(mode, ResetMode::Soft | ResetMode::Mixed) {
                    affected_paths.extend(
                        snapshot
                            .entries
                            .iter()
                            .filter(|entry| !entry.untracked && entry.index_status != ".")
                            .map(|entry| entry.path.clone()),
                    );
                }
                if *mode == ResetMode::Hard {
                    let dirty_tracked = snapshot
                        .entries
                        .iter()
                        .filter(|entry| !entry.untracked)
                        .map(|entry| entry.path.clone())
                        .collect::<Vec<_>>();
                    affected_paths.extend(dirty_tracked.iter().cloned());
                    let mut overwrite_paths = target_changed_paths;
                    overwrite_paths.extend(dirty_tracked);
                    overwrite_paths.sort();
                    overwrite_paths.dedup();
                    let write_targets =
                        self.tree_write_targets(repo, oid, &overwrite_paths, control)?;
                    self.bind_worktree_writes(
                        repo,
                        snapshot,
                        &write_targets,
                        &mut affected_paths,
                        control,
                    )?;
                }
                lost_commit_oids = self.lost_commits(repo, head, oid, control)?;
                affected_commits.extend(lost_commit_oids.iter().cloned());
            }
            Action::Merge { .. } => {
                let oid = oid.as_ref().expect("merge target was resolved");
                let head = current_head.as_ref().ok_or_else(|| {
                    WorkspaceError::new(
                        ErrorCode::InvalidRequest,
                        "Cannot merge with an unborn HEAD",
                    )
                })?;
                let base = self
                    .git
                    .run(
                        Some(&repo.root),
                        GitCommand::MergeBase {
                            left: head.clone(),
                            right: oid.clone(),
                        },
                        None,
                        control,
                    )?
                    .ensure_success()?
                    .stdout_text()
                    .trim()
                    .to_owned();
                affected_paths = self.changed_paths(repo, &base, oid, control)?;
                let write_targets = self.tree_write_targets(repo, oid, &affected_paths, control)?;
                self.bind_worktree_writes(
                    repo,
                    snapshot,
                    &write_targets,
                    &mut affected_paths,
                    control,
                )?;
            }
            Action::Rebase { .. } => {
                let oid = oid.as_ref().expect("rebase target was resolved");
                let head = current_head.as_ref().ok_or_else(|| {
                    WorkspaceError::new(ErrorCode::InvalidRequest, "Cannot rebase an unborn HEAD")
                })?;
                affected_paths = self.changed_paths(repo, oid, head, control)?;
                let mut write_targets =
                    self.tree_write_targets(repo, oid, &affected_paths, control)?;
                for commit in self.commits_not_reachable(repo, head, oid, control)? {
                    let commit_paths = self.commit_changed_paths(repo, &commit, control)?;
                    write_targets.extend(self.tree_write_targets(
                        repo,
                        &commit,
                        &commit_paths,
                        control,
                    )?);
                    affected_paths.extend(commit_paths);
                }
                write_targets.sort_by(|left, right| {
                    (&left.path, &left.mode).cmp(&(&right.path, &right.mode))
                });
                write_targets.dedup();
                self.bind_worktree_writes(
                    repo,
                    snapshot,
                    &write_targets,
                    &mut affected_paths,
                    control,
                )?;
                affected_commits.extend(self.lost_commits(repo, head, oid, control)?);
            }
            Action::CherryPick { .. } => {
                let oid = oid.as_ref().expect("structured target was resolved");
                affected_paths = if let Some(parent) = structured_parent.as_ref() {
                    self.changed_paths(repo, parent, oid, control)?
                } else {
                    self.commit_changed_paths(repo, oid, control)?
                };
                let write_targets = self.tree_write_targets(repo, oid, &affected_paths, control)?;
                self.bind_worktree_writes(
                    repo,
                    snapshot,
                    &write_targets,
                    &mut affected_paths,
                    control,
                )?;
            }
            Action::Revert { .. } => {
                let oid = oid.as_ref().expect("structured target was resolved");
                affected_paths = if let Some(parent) = structured_parent.as_ref() {
                    self.changed_paths(repo, parent, oid, control)?
                } else {
                    self.commit_changed_paths(repo, oid, control)?
                };
                let write_targets = if let Some(parent) = structured_parent.as_ref() {
                    self.tree_write_targets(repo, parent, &affected_paths, control)?
                } else {
                    Vec::new()
                };
                self.bind_worktree_writes(
                    repo,
                    snapshot,
                    &write_targets,
                    &mut affected_paths,
                    control,
                )?;
            }
            Action::DeleteBranch { .. } => {
                let oid = oid.as_ref().expect("branch target was resolved");
                let head = current_head.as_ref().ok_or_else(|| {
                    WorkspaceError::new(
                        ErrorCode::InvalidRequest,
                        "Cannot compare a branch with an unborn HEAD",
                    )
                })?;
                lost_commit_oids = self.commits_not_reachable(repo, oid, head, control)?;
                affected_commits.extend(lost_commit_oids.iter().cloned());
            }
            Action::CreateBranch { .. } | Action::CreateTag { .. } => {}
            Action::Discard {
                paths,
                target: DiscardTarget::Unstaged,
                selection: None,
            } => {
                affected_paths = paths.clone();
                let write_targets = self.index_write_targets(repo, paths, control)?;
                self.bind_worktree_writes(
                    repo,
                    snapshot,
                    &write_targets,
                    &mut affected_paths,
                    control,
                )?;
            }
            Action::Discard { .. } => affected_paths = action_paths(action),
            Action::Abort => {
                affected_paths = snapshot
                    .entries
                    .iter()
                    .map(|entry| entry.path.clone())
                    .collect();
                let target_oid = self.abort_target_oid(repo, snapshot, control)?;
                let mut overwrite_paths = snapshot
                    .entries
                    .iter()
                    .filter(|entry| !entry.untracked)
                    .map(|entry| entry.path.clone())
                    .collect::<Vec<_>>();
                if let Some(head) = current_head.as_ref() {
                    overwrite_paths.extend(self.changed_paths(repo, &target_oid, head, control)?);
                }
                overwrite_paths.sort();
                overwrite_paths.dedup();
                let write_targets =
                    self.tree_write_targets(repo, &target_oid, &overwrite_paths, control)?;
                self.bind_worktree_writes(
                    repo,
                    snapshot,
                    &write_targets,
                    &mut affected_paths,
                    control,
                )?;
            }
            Action::ConflictMaterialize { session_id, .. } => {
                affected_paths = self.conflict_session(repo, session_id)?.related_paths;
            }
            Action::FileAction {
                paths,
                operation: FileOperation::MoveToTrash,
            } => {
                for path in paths {
                    let absolute = checked_repo_path(&repo.root, path)?;
                    ensure_trashable_file(&absolute)?;
                    affected_paths.push(path.clone());
                }
            }
            _ => return Ok(None),
        }
        affected_paths.sort();
        affected_paths.dedup();
        affected_commits.sort();
        affected_commits.dedup();
        lost_commit_oids.sort();
        lost_commit_oids.dedup();
        let state_digest =
            self.repository_state_digest(repo, snapshot, Some(&affected_paths), control)?;
        let impact_payload = serde_json::to_vec(&(
            action.kind_name(),
            &current_head,
            &resolved_targets,
            &affected_paths,
            &affected_commits,
            &lost_commit_oids,
            &state_digest,
            &snapshot.operation,
        ))
        .map_err(|error| WorkspaceError::new(ErrorCode::Internal, error.to_string()))?;
        Ok(Some(TargetBinding {
            resolved_targets,
            impact_digest: hash(&impact_payload),
            affected_paths,
            affected_commits,
            lost_commit_oids,
        }))
    }

    fn changed_paths(
        &self,
        repo: &RepoContext,
        from: &str,
        to: &str,
        control: Option<&RunControl>,
    ) -> WorkspaceResult<Vec<String>> {
        let output = self
            .git
            .run(
                Some(&repo.root),
                GitCommand::ChangedPaths {
                    from: from.to_owned(),
                    to: to.to_owned(),
                },
                None,
                control,
            )?
            .ensure_success()?;
        parse_nul_paths(&output.stdout)
    }

    fn commit_changed_paths(
        &self,
        repo: &RepoContext,
        oid: &str,
        control: Option<&RunControl>,
    ) -> WorkspaceResult<Vec<String>> {
        let output = self
            .git
            .run(
                Some(&repo.root),
                GitCommand::CommitChangedPaths {
                    oid: oid.to_owned(),
                },
                None,
                control,
            )?
            .ensure_success()?;
        parse_nul_paths(&output.stdout)
    }

    fn tree_write_targets(
        &self,
        repo: &RepoContext,
        treeish: &str,
        paths: &[String],
        control: Option<&RunControl>,
    ) -> WorkspaceResult<Vec<WorktreeWriteTarget>> {
        if paths.is_empty() {
            return Ok(Vec::new());
        }
        validate_paths(paths)?;
        let output = self
            .git
            .run(
                Some(&repo.root),
                GitCommand::TreeEntries {
                    treeish: treeish.to_owned(),
                    paths: paths.to_vec(),
                },
                None,
                control,
            )?
            .ensure_success()?;
        Ok(parse_tree_entries(&output.stdout)?
            .into_iter()
            .map(|entry| WorktreeWriteTarget {
                mode: entry.mode,
                path: entry.path,
            })
            .collect())
    }

    fn index_write_targets(
        &self,
        repo: &RepoContext,
        paths: &[String],
        control: Option<&RunControl>,
    ) -> WorkspaceResult<Vec<WorktreeWriteTarget>> {
        if paths.is_empty() {
            return Ok(Vec::new());
        }
        validate_paths(paths)?;
        let output = self
            .git
            .run(
                Some(&repo.root),
                GitCommand::IndexEntries {
                    paths: paths.to_vec(),
                },
                None,
                control,
            )?
            .ensure_success()?;
        Ok(parse_index_entries(&output.stdout)?
            .into_iter()
            .filter(|entry| entry.stage == 0)
            .map(|entry| WorktreeWriteTarget {
                mode: entry.mode,
                path: entry.path,
            })
            .collect())
    }

    /// 表示中の未追跡ファイルの衝突を固定し、通常の状態スナップショットでは内容を証明できない作業ツリー障害を拒否する。
    /// プレビューの発行時と、変更直前にプレビューを使用するときの両方で意図的に実行する。
    fn bind_worktree_writes(
        &self,
        repo: &RepoContext,
        snapshot: &RepoSnapshot,
        write_targets: &[WorktreeWriteTarget],
        affected_paths: &mut Vec<String>,
        control: Option<&RunControl>,
    ) -> WorkspaceResult<()> {
        if write_targets.is_empty() {
            return Ok(());
        }
        let target_paths = write_targets
            .iter()
            .map(|target| target.path.clone())
            .collect::<Vec<_>>();
        validate_paths(&target_paths)?;

        let all_visible_untracked = snapshot
            .entries
            .iter()
            .filter(|entry| entry.untracked)
            .map(|entry| entry.path.clone())
            .collect::<BTreeSet<_>>();
        let visible_untracked = all_visible_untracked
            .iter()
            .filter(|path| {
                target_paths
                    .iter()
                    .any(|target| paths_overlap_components(path, target))
            })
            .cloned()
            .collect::<BTreeSet<_>>();
        affected_paths.extend(visible_untracked.iter().cloned());

        let mut index_pathspecs = target_paths.clone();
        for target in &target_paths {
            index_pathspecs.extend(path_ancestors(target));
        }
        index_pathspecs.sort();
        index_pathspecs.dedup();
        let index = self
            .git
            .run(
                Some(&repo.root),
                GitCommand::IndexEntries {
                    paths: index_pathspecs,
                },
                None,
                control,
            )?
            .ensure_success()?;
        let mut tracked_modes = BTreeMap::<String, BTreeSet<String>>::new();
        for entry in parse_index_entries(&index.stdout)? {
            tracked_modes
                .entry(entry.path)
                .or_default()
                .insert(entry.mode);
        }

        for target in write_targets {
            let components = target.path.split('/').collect::<Vec<_>>();
            let mut relative = PathBuf::new();
            for (index, component) in components.iter().enumerate() {
                relative.push(component);
                let metadata = match fs::symlink_metadata(repo.root.join(&relative)) {
                    Ok(metadata) => metadata,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
                    Err(error) => {
                        return Err(WorkspaceError::new(ErrorCode::Io, error.to_string()));
                    }
                };
                let relative_text = relative.to_string_lossy().into_owned();
                let is_leaf = index + 1 == components.len();
                if !is_leaf {
                    if metadata.file_type().is_dir() {
                        if let Some(modes) = tracked_modes.get(&relative_text) {
                            if modes.contains("160000") {
                                return Err(worktree_write_obstruction(
                                    &target.path,
                                    &relative_text,
                                    &target.mode,
                                ));
                            }
                            bind_directory_contents(
                                &repo.root,
                                &relative,
                                &target.path,
                                &target.mode,
                                &tracked_modes,
                                &all_visible_untracked,
                                affected_paths,
                                control,
                            )?;
                            affected_paths.push(relative_text);
                            break;
                        }
                        continue;
                    }
                    if metadata.file_type().is_symlink() || !metadata.file_type().is_dir() {
                        let Some(modes) = tracked_modes.get(&relative_text) else {
                            return Err(worktree_write_obstruction(
                                &target.path,
                                &relative_text,
                                &target.mode,
                            ));
                        };
                        if !worktree_type_matches_index(&metadata, modes) {
                            return Err(worktree_write_obstruction(
                                &target.path,
                                &relative_text,
                                &target.mode,
                            ));
                        }
                        affected_paths.push(relative_text);
                        break;
                    }
                }
                if metadata.file_type().is_dir() {
                    if tracked_modes
                        .get(&target.path)
                        .is_some_and(|modes| modes.contains("160000"))
                    {
                        return Err(worktree_write_obstruction(
                            &target.path,
                            &relative_text,
                            &target.mode,
                        ));
                    }
                    bind_directory_contents(
                        &repo.root,
                        &relative,
                        &target.path,
                        &target.mode,
                        &tracked_modes,
                        &all_visible_untracked,
                        affected_paths,
                        control,
                    )?;
                    continue;
                }
                if let Some(modes) = tracked_modes.get(&target.path) {
                    if !worktree_type_matches_index(&metadata, modes) {
                        return Err(worktree_write_obstruction(
                            &target.path,
                            &relative_text,
                            &target.mode,
                        ));
                    }
                } else if !visible_untracked.contains(&target.path)
                    || !(metadata.file_type().is_file() || metadata.file_type().is_symlink())
                {
                    return Err(worktree_write_obstruction(
                        &target.path,
                        &relative_text,
                        &target.mode,
                    ));
                }
            }
        }
        Ok(())
    }

    fn lost_commits(
        &self,
        repo: &RepoContext,
        head: &str,
        target: &str,
        control: Option<&RunControl>,
    ) -> WorkspaceResult<Vec<String>> {
        let output = self
            .git
            .run(
                Some(&repo.root),
                GitCommand::LostCommits {
                    head: head.to_owned(),
                    target: target.to_owned(),
                },
                None,
                control,
            )?
            .ensure_success()?;
        Ok(output
            .stdout_text()
            .lines()
            .filter(|line| !line.is_empty())
            .map(str::to_owned)
            .collect())
    }

    fn commits_not_reachable(
        &self,
        repo: &RepoContext,
        head: &str,
        excluded: &str,
        control: Option<&RunControl>,
    ) -> WorkspaceResult<Vec<String>> {
        let output = self
            .git
            .run(
                Some(&repo.root),
                GitCommand::CommitsNotReachable {
                    head: head.to_owned(),
                    excluded: excluded.to_owned(),
                },
                None,
                control,
            )?
            .ensure_success()?;
        Ok(output
            .stdout_text()
            .lines()
            .filter(|line| !line.is_empty())
            .map(str::to_owned)
            .collect())
    }

    fn commit_parent_oids(
        &self,
        repo: &RepoContext,
        oid: &str,
        control: Option<&RunControl>,
    ) -> WorkspaceResult<Vec<String>> {
        let output = self
            .git
            .run(
                Some(&repo.root),
                GitCommand::CommitParents {
                    oid: oid.to_owned(),
                },
                None,
                control,
            )?
            .ensure_success()?;
        Ok(output
            .stdout_text()
            .split_whitespace()
            .map(str::to_owned)
            .collect())
    }

    fn structured_parent_oid(
        &self,
        repo: &RepoContext,
        oid: &str,
        mainline: Option<u32>,
        control: Option<&RunControl>,
    ) -> WorkspaceResult<Option<String>> {
        let parents = self.commit_parent_oids(repo, oid, control)?;
        if parents.len() > 1 {
            let mainline = mainline.ok_or_else(|| {
                WorkspaceError::new(
                    ErrorCode::InvalidRequest,
                    "Cherry-picking or reverting a merge commit requires a mainline parent",
                )
            })?;
            let index = usize::try_from(mainline)
                .ok()
                .and_then(|value| value.checked_sub(1))
                .ok_or_else(|| {
                    WorkspaceError::new(ErrorCode::InvalidRequest, "Invalid mainline parent")
                })?;
            return parents.get(index).cloned().map(Some).ok_or_else(|| {
                WorkspaceError::new(
                    ErrorCode::InvalidRequest,
                    "The mainline parent is outside the merge commit's parent range",
                )
            });
        }
        if mainline.is_some() {
            return Err(WorkspaceError::new(
                ErrorCode::InvalidRequest,
                "A mainline parent can only be specified for a merge commit",
            ));
        }
        Ok(parents.into_iter().next())
    }

    fn abort_target_oid(
        &self,
        repo: &RepoContext,
        snapshot: &RepoSnapshot,
        control: Option<&RunControl>,
    ) -> WorkspaceResult<String> {
        if let OperationState::PendingStructuredCommit { pre_head_oid, .. }
        | OperationState::StructuredAbortRecovery { pre_head_oid, .. } = &snapshot.operation
        {
            return Ok(pre_head_oid.clone());
        }
        if matches!(
            snapshot.operation,
            OperationState::CherryPick { .. } | OperationState::Revert { .. }
        ) && let Some(journal) = self.journal.load(&repo.id)?
        {
            return Ok(journal.pre_head_oid);
        }
        if matches!(
            snapshot.operation,
            OperationState::Merge { .. }
                | OperationState::Rebase
                | OperationState::CherryPick { .. }
                | OperationState::Revert { .. }
        ) {
            return Ok(self
                .git
                .run(
                    Some(&repo.root),
                    GitCommand::Resolve {
                        revision: "ORIG_HEAD".into(),
                    },
                    None,
                    control,
                )?
                .ensure_success()?
                .stdout_text()
                .trim()
                .to_owned());
        }
        Err(WorkspaceError::new(
            ErrorCode::InvalidRequest,
            "Unable to determine a safe abort target",
        ))
    }

    fn repository_state_digest(
        &self,
        repo: &RepoContext,
        snapshot: &RepoSnapshot,
        selected_paths: Option<&[String]>,
        control: Option<&RunControl>,
    ) -> WorkspaceResult<String> {
        let mut paths = selected_paths.map_or_else(
            || {
                snapshot
                    .entries
                    .iter()
                    .map(|entry| entry.path.clone())
                    .collect::<Vec<_>>()
            },
            <[String]>::to_vec,
        );
        paths.sort();
        paths.dedup();
        if paths.is_empty() {
            return Ok(hash(b"empty repository impact"));
        }
        validate_paths(&paths)?;
        let tracked_paths: Vec<String> = paths
            .iter()
            .filter(|path| {
                !snapshot
                    .entries
                    .iter()
                    .any(|entry| entry.path == path.as_str() && entry.untracked)
            })
            .cloned()
            .collect();
        let mut digest = Sha256::new();
        if !tracked_paths.is_empty() {
            let index = self
                .git
                .run(
                    Some(&repo.root),
                    GitCommand::IndexEntries {
                        paths: tracked_paths,
                    },
                    None,
                    control,
                )?
                .ensure_success()?;
            digest.update(index.stdout);
        }
        for path in paths {
            digest.update(path.as_bytes());
            if let Some(entry) = snapshot.entries.iter().find(|entry| entry.path == path) {
                digest.update(serde_json::to_vec(entry).map_err(|error| {
                    WorkspaceError::new(ErrorCode::Internal, error.to_string())
                })?);
            }
            digest.update(worktree_impact_digest(&repo.root, &path, control)?);
        }
        Ok(hex_bytes(&digest.finalize()))
    }

    /// 通常ファイルの内容を開かずに定期確認用の指紋を構築する。
    ///
    /// Porcelain形式の状態は論理的なGit構造を表す。
    /// 索引項目はその構造をステージ済みブロブのOIDとモードに結び付け、作業ツリーのメタデータは通常の同一サイズ書き換えを検出する。
    /// 正確な内容ハッシュは、破壊的なプレビューと実行の境界にある`repository_state_digest`が担う。
    fn repository_generation_fingerprint(
        &self,
        repo: &RepoContext,
        snapshot: &RepoSnapshot,
        status: &[u8],
        control: Option<&RunControl>,
    ) -> WorkspaceResult<String> {
        let mut paths = snapshot
            .entries
            .iter()
            .map(|entry| entry.path.clone())
            .collect::<Vec<_>>();
        paths.sort();
        paths.dedup();
        validate_paths(&paths)?;

        let tracked_paths = paths
            .iter()
            .filter(|path| {
                !snapshot
                    .entries
                    .iter()
                    .any(|entry| entry.path == path.as_str() && entry.untracked)
            })
            .cloned()
            .collect::<Vec<_>>();
        let mut fingerprint = Sha256::new();
        fingerprint.update(status);
        if !tracked_paths.is_empty() {
            let index = self
                .git
                .run(
                    Some(&repo.root),
                    GitCommand::IndexEntries {
                        paths: tracked_paths,
                    },
                    None,
                    control,
                )?
                .ensure_success()?;
            fingerprint.update(index.stdout);
        }
        for path in paths {
            fingerprint.update(path.as_bytes());
            fingerprint.update(worktree_entry_fingerprint(&repo.root, &path)?);
        }
        Ok(hex_bytes(&fingerprint.finalize()))
    }

    fn repo(&self, id: &str) -> WorkspaceResult<Arc<RepoContext>> {
        self.repos
            .read()
            .expect("repos read lock")
            .get(id)
            .cloned()
            .ok_or_else(|| WorkspaceError::new(ErrorCode::RepoNotFound, "Repository not attached"))
    }

    fn snapshot(&self, repo: &RepoContext) -> WorkspaceResult<RepoSnapshot> {
        let _mutation = repo.mutation.read().expect("mutation read lock");
        self.snapshot_locked(repo)
    }

    /// `repo.mutation`の書き込みロックを保持する変更操作から呼び出す。
    fn snapshot_locked(&self, repo: &RepoContext) -> WorkspaceResult<RepoSnapshot> {
        let _snapshot = repo.snapshot.lock().expect("snapshot lock");
        let output = self
            .git
            .run(Some(&repo.root), GitCommand::Status, None, None)?
            .ensure_success()?;
        let mut parsed = parse_status(&output.stdout)?;
        let mut total = Some(Numstat::default());
        for target in [DiffTarget::Staged, DiffTarget::Unstaged] {
            let Ok(numstat) = self
                .git
                .run(
                    Some(&repo.root),
                    GitCommand::DiffNumstat { target },
                    None,
                    None,
                )
                .and_then(GitOutput::ensure_success)
            else {
                // 行数は補助情報なので、読めないファイルがあっても状態の表示は止めない。
                total = None;
                break;
            };
            let Ok(stats) = parse_numstat(&numstat.stdout) else {
                total = None;
                break;
            };
            if let Some(total) = &mut total {
                total.additions += stats.additions;
                total.deletions += stats.deletions;
            }
        }
        parsed.additions = total.map(|stats| stats.additions);
        parsed.deletions = total.map(|stats| stats.deletions);
        let state_fingerprint =
            self.repository_generation_fingerprint(repo, &parsed, &output.stdout, None)?;
        let has_tracked_changes = parsed.entries.iter().any(|entry| !entry.untracked);
        let has_conflicts = parsed.entries.iter().any(|entry| entry.conflict);
        let operation =
            self.operation_state(repo, has_tracked_changes, has_conflicts, &state_fingerprint)?;
        if matches!(operation, OperationState::None) {
            repo.conflicts.lock().expect("conflicts lock").clear();
        }
        let refs = self
            .git
            .run(Some(&repo.root), GitCommand::References, None, None)?
            .ensure_success()?;
        let mut fingerprint = Sha256::new();
        fingerprint.update(state_fingerprint.as_bytes());
        fingerprint.update(refs.stdout);
        fingerprint.update(repo.common_dir.as_os_str().as_encoded_bytes());
        fingerprint.update(
            serde_json::to_vec(&operation)
                .map_err(|error| WorkspaceError::new(ErrorCode::Internal, error.to_string()))?,
        );
        let fingerprint = hex_bytes(&fingerprint.finalize());
        let generation = {
            let mut tracker = repo.tracker.lock().expect("tracker lock");
            if tracker.value == 0 || tracker.fingerprint != fingerprint {
                tracker.value += 1;
                tracker.fingerprint = fingerprint;
            }
            tracker.value
        };
        parsed.repo_id = repo.id.clone();
        parsed.root = repo.root.display().to_string();
        parsed.operation = operation;
        parsed.git_flow_operation = git_flow::pending_operation(&repo.git_dir).map(str::to_owned);
        parsed.repo_generation = generation;
        parsed.event_seq = repo.event_seq.load(Ordering::SeqCst);
        Ok(parsed)
    }

    fn operation_state(
        &self,
        repo: &RepoContext,
        has_tracked_changes: bool,
        has_conflicts: bool,
        state_fingerprint: &str,
    ) -> WorkspaceResult<OperationState> {
        if repo.git_dir.join("rebase-merge").exists() || repo.git_dir.join("rebase-apply").exists()
        {
            return Ok(OperationState::Rebase);
        }
        if let Some(value) = read_marker(&repo.git_dir.join("MERGE_HEAD"))? {
            return Ok(OperationState::Merge {
                incoming_oid: Some(value),
            });
        }
        let cherry_pick_marker = read_marker(&repo.git_dir.join("CHERRY_PICK_HEAD"))?;
        let revert_marker = read_marker(&repo.git_dir.join("REVERT_HEAD"))?;
        let has_sequencer = repo.git_dir.join("sequencer").exists();
        let has_structured_marker =
            cherry_pick_marker.is_some() || revert_marker.is_some() || has_sequencer;
        let mut journal = self.journal.load(&repo.id)?;
        if let Some(value) = journal.as_ref() {
            let head = self.head_oid(repo).ok();
            if head.as_deref() != Some(value.pre_head_oid.as_str()) {
                self.journal.clear(&repo.id)?;
                journal = None;
            } else if value.effective_phase() == JournalPhase::AbortRecovery {
                return Ok(OperationState::StructuredAbortRecovery {
                    operation: value.operation,
                    source_oid: value.source_oid.clone(),
                    pre_head_oid: value.pre_head_oid.clone(),
                });
            } else if !has_conflicts {
                match value.effective_phase() {
                    JournalPhase::Preparing => {
                        return Ok(OperationState::StructuredAbortRecovery {
                            operation: value.operation,
                            source_oid: value.source_oid.clone(),
                            pre_head_oid: value.pre_head_oid.clone(),
                        });
                    }
                    JournalPhase::Applied
                        if value.state_fingerprint.as_deref() == Some(state_fingerprint)
                            && has_tracked_changes =>
                    {
                        return Ok(OperationState::PendingStructuredCommit {
                            operation: value.operation,
                            source_oid: value.source_oid.clone(),
                            pre_head_oid: value.pre_head_oid.clone(),
                        });
                    }
                    JournalPhase::Applied if !has_tracked_changes => {
                        if !has_structured_marker {
                            self.journal.clear(&repo.id)?;
                            journal = None;
                        }
                    }
                    JournalPhase::Applied => {
                        if !has_structured_marker {
                            return Ok(OperationState::Unknown {
                                marker: "stella-journal-mismatch".into(),
                            });
                        }
                    }
                    JournalPhase::AbortRecovery => unreachable!("handled above"),
                }
            }
        }
        if let Some(value) = cherry_pick_marker {
            return Ok(OperationState::CherryPick {
                source_oid: Some(value),
            });
        }
        if let Some(value) = revert_marker {
            return Ok(OperationState::Revert {
                source_oid: Some(value),
            });
        }
        if has_sequencer {
            return Ok(match journal.as_ref().map(|value| value.operation) {
                Some(StructuredOperation::CherryPick) => OperationState::CherryPick {
                    source_oid: journal.as_ref().map(|value| value.source_oid.clone()),
                },
                Some(StructuredOperation::Revert) => OperationState::Revert {
                    source_oid: journal.as_ref().map(|value| value.source_oid.clone()),
                },
                None => OperationState::Unknown {
                    marker: "sequencer".into(),
                },
            });
        }
        if let Some(journal) = journal {
            let head = self.head_oid(repo).ok();
            if head.as_deref() == Some(journal.pre_head_oid.as_str()) && has_conflicts {
                return Ok(match journal.operation {
                    StructuredOperation::CherryPick => OperationState::CherryPick {
                        source_oid: Some(journal.source_oid),
                    },
                    StructuredOperation::Revert => OperationState::Revert {
                        source_oid: Some(journal.source_oid),
                    },
                });
            }
        }
        Ok(OperationState::None)
    }

    fn head_oid(&self, repo: &RepoContext) -> WorkspaceResult<String> {
        let output = self
            .git
            .run(Some(&repo.root), GitCommand::HeadOid, None, None)?
            .ensure_success()?;
        Ok(output.stdout_text().trim().to_owned())
    }

    fn execute(&self, request: ExecuteRequest) -> WorkspaceResult<ActionOutcome> {
        if request.operation_id.trim().is_empty() {
            return Err(WorkspaceError::new(
                ErrorCode::InvalidRequest,
                "operationId is required",
            ));
        }
        self.git.ensure_development_build_current()?;
        let repo = self.repo(&request.repo_id)?;
        let control = RunControl::new();
        {
            let mut running = self.running.lock().expect("running lock");
            if running.contains_key(&request.operation_id) {
                return Err(WorkspaceError::new(
                    ErrorCode::OperationInProgress,
                    "An operation with the same operationId is already running",
                ));
            }
            running.insert(request.operation_id.clone(), control.clone());
        }

        let result = self.execute_registered(&repo, &request, &control);
        self.running
            .lock()
            .expect("running lock")
            .remove(&request.operation_id);
        result
    }

    fn execute_registered(
        &self,
        repo: &RepoContext,
        request: &ExecuteRequest,
        control: &RunControl,
    ) -> WorkspaceResult<ActionOutcome> {
        let _mutation = repo.mutation.write().expect("mutation write lock");
        if control.is_cancelled() {
            return Err(WorkspaceError::new(
                ErrorCode::Cancelled,
                "Git operation was cancelled",
            ));
        }
        let before = self.snapshot_locked(repo)?;
        ensure_generation(request.expected_generation, before.repo_generation)?;
        validate_action(&request.action)?;
        validate_action_targets(&before, &request.action)?;
        ensure_action_allowed(repo, &before, &request.action)?;

        self.send_event(
            repo,
            Some(&request.operation_id),
            before.repo_generation,
            EventPhase::Started,
            action_display_message(&request.action),
        );
        let target_binding = self
            .consume_preview(repo, &before, request, before.repo_generation, control)
            .map_err(|error| self.report_execution_error(repo, request, &before, error))?;

        if let Action::ConflictSave {
            session_id,
            conflict_generation,
            content_hash,
            result,
        } = &request.action
        {
            let execution: WorkspaceResult<ActionOutcome> = (|| {
                let session = self.conflict_session(repo, session_id)?;
                conflict::validate_session(&session, session_id, conflict_generation)?;
                if session.kind != ConflictKind::Text || !session.in_app_edit {
                    return Err(WorkspaceError::new(
                        ErrorCode::InvalidRequest,
                        "ConflictSave is only available for in-app text conflicts",
                    ));
                }
                let saved_hash = conflict::save_result(
                    &repo.root,
                    &session,
                    content_hash,
                    result.as_bytes(),
                    Some(control),
                )?;
                let resolution_evidence = session.resolution_evidence
                    || saved_hash != session.content_hash
                    || (!session.blocks.is_empty()
                        && session
                            .blocks
                            .iter()
                            .all(|block| block.state != ConflictBlockState::Unresolved));
                let (document, mut refreshed_session) = conflict::load(
                    &self.git,
                    &repo.root,
                    &repo.id,
                    &session.path,
                    &before.operation,
                    Some(control),
                )?;
                refreshed_session.resolution_evidence = resolution_evidence;
                {
                    let mut sessions = repo.conflicts.lock().expect("conflicts lock");
                    sessions.remove(session_id);
                    sessions.insert(refreshed_session.id.clone(), refreshed_session);
                }
                let mut snapshot = self.snapshot_locked(repo)?;
                let summary = LocalizedMessage::new("backendConflictResultSaved");
                let event_seq = self.send_event(
                    repo,
                    Some(&request.operation_id),
                    snapshot.repo_generation,
                    EventPhase::Completed,
                    summary.clone(),
                );
                snapshot.event_seq = event_seq;
                Ok(ActionOutcome {
                    operation_id: request.operation_id.clone(),
                    summary,
                    repo_generation: snapshot.repo_generation,
                    event_seq,
                    snapshot,
                    command: synthetic_output("conflict-save").activity(),
                    conflict_edit: None,
                    conflict_document: Some(document),
                })
            })();
            return execution
                .map_err(|error| self.report_execution_error(repo, request, &before, error));
        }

        if let Action::ConflictChoice {
            session_id,
            conflict_generation,
            content_hash,
            document_revision,
            base_document_revision,
            block_id,
            draft_text,
            choice,
        } = &request.action
        {
            let execution: WorkspaceResult<ActionOutcome> = (|| {
                let edit = {
                    let mut sessions = repo.conflicts.lock().expect("conflicts lock");
                    let session = sessions.get_mut(session_id).ok_or_else(|| {
                        WorkspaceError::new(
                            ErrorCode::ConflictStateChanged,
                            "The conflict session is stale. Reload the conflict",
                        )
                    })?;
                    conflict::apply_block_choice(
                        session,
                        conflict::BlockChoiceRequest {
                            generation: conflict_generation,
                            content_hash,
                            document_revision,
                            base_document_revision,
                            block_id,
                            draft_text,
                            choice: *choice,
                        },
                    )?
                };
                let mut snapshot = self.snapshot_locked(repo)?;
                let summary = LocalizedMessage::new("backendConflictChoiceApplied");
                let event_seq = self.send_event(
                    repo,
                    Some(&request.operation_id),
                    snapshot.repo_generation,
                    EventPhase::Completed,
                    summary.clone(),
                );
                snapshot.event_seq = event_seq;
                Ok(ActionOutcome {
                    operation_id: request.operation_id.clone(),
                    summary,
                    repo_generation: snapshot.repo_generation,
                    event_seq,
                    snapshot,
                    command: synthetic_output("conflict-choice").activity(),
                    conflict_edit: Some(edit),
                    conflict_document: None,
                })
            })();
            return execution
                .map_err(|error| self.report_execution_error(repo, request, &before, error));
        }

        if let Action::ConflictMaterialize {
            session_id,
            conflict_generation,
            choice,
        } = &request.action
        {
            let execution: WorkspaceResult<ActionOutcome> = (|| {
                let session = self.conflict_session(repo, session_id)?;
                conflict::validate_session(&session, session_id, conflict_generation)?;
                if !matches!(
                    session.kind,
                    ConflictKind::AddAdd | ConflictKind::ModifyDelete
                ) {
                    return Err(WorkspaceError::new(
                        ErrorCode::InvalidRequest,
                        "Whole-file choices are only available for add/add or modify/delete conflicts",
                    ));
                }
                // 競合結果の読み込み後に変更された内容は上書きしない。
                conflict::verify_saved_result(
                    &repo.root,
                    &session,
                    &session.content_hash,
                    Some(control),
                )?;
                conflict::materialize(&self.git, &repo.root, &session, *choice, Some(control))?;
                let (document, mut refreshed_session) = conflict::load(
                    &self.git,
                    &repo.root,
                    &repo.id,
                    &session.path,
                    &before.operation,
                    Some(control),
                )?;
                refreshed_session.resolution_evidence = true;
                {
                    let mut sessions = repo.conflicts.lock().expect("conflicts lock");
                    sessions.remove(session_id);
                    sessions.insert(refreshed_session.id.clone(), refreshed_session);
                }
                let mut snapshot = self.snapshot_locked(repo)?;
                let summary = LocalizedMessage::new("backendConflictSideApplied");
                let event_seq = self.send_event(
                    repo,
                    Some(&request.operation_id),
                    snapshot.repo_generation,
                    EventPhase::Completed,
                    summary.clone(),
                );
                snapshot.event_seq = event_seq;
                Ok(ActionOutcome {
                    operation_id: request.operation_id.clone(),
                    summary,
                    repo_generation: snapshot.repo_generation,
                    event_seq,
                    snapshot,
                    command: synthetic_output("conflict-materialize").activity(),
                    conflict_edit: None,
                    conflict_document: Some(document),
                })
            })();
            return execution
                .map_err(|error| self.report_execution_error(repo, request, &before, error));
        }

        let execution = self.dispatch_with_progress(
            repo,
            &before,
            &request.operation_id,
            &request.action,
            target_binding.as_ref(),
            control,
        );
        match execution {
            Ok((summary, output)) => {
                let snapshot = self.snapshot_locked(repo)?;
                let event_seq = self.send_event(
                    repo,
                    Some(&request.operation_id),
                    snapshot.repo_generation,
                    if output.cancelled {
                        EventPhase::Cancelled
                    } else {
                        EventPhase::Completed
                    },
                    summary.clone(),
                );
                let mut snapshot = snapshot;
                snapshot.event_seq = event_seq;
                Ok(ActionOutcome {
                    operation_id: request.operation_id.clone(),
                    summary,
                    repo_generation: snapshot.repo_generation,
                    event_seq,
                    snapshot,
                    command: output.activity(),
                    conflict_edit: None,
                    conflict_document: None,
                })
            }
            Err(error) => Err(self.report_execution_error(repo, request, &before, error)),
        }
    }

    fn report_execution_error(
        &self,
        repo: &RepoContext,
        request: &ExecuteRequest,
        before: &RepoSnapshot,
        error: WorkspaceError,
    ) -> WorkspaceError {
        // フック、フィルター、失敗したシーケンサーコマンドもGitの状態を変更する可能性がある。
        let refreshed = self.snapshot_locked(repo).ok();
        let generation = refreshed
            .as_ref()
            .map_or(before.repo_generation, |value| value.repo_generation);
        let error = error.detail("repoGeneration", generation.to_string());
        self.send_event_with_details(
            repo,
            Some(&request.operation_id),
            generation,
            if error.code == ErrorCode::Cancelled {
                EventPhase::Cancelled
            } else {
                EventPhase::Failed
            },
            error.localized_message.clone(),
            error.details.clone(),
        );
        error
    }

    fn dispatch_with_progress(
        &self,
        repo: &RepoContext,
        before: &RepoSnapshot,
        operation_id: &str,
        action: &Action,
        target_binding: Option<&TargetBinding>,
        control: &RunControl,
    ) -> WorkspaceResult<(LocalizedMessage, GitOutput)> {
        std::thread::scope(|scope| {
            let (finished, heartbeat_finished) = mpsc::channel();
            let heartbeat = scope.spawn(move || {
                loop {
                    match heartbeat_finished.recv_timeout(Duration::from_millis(500)) {
                        Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                        Err(mpsc::RecvTimeoutError::Timeout) => {}
                    }
                    self.send_event(
                        repo,
                        Some(operation_id),
                        before.repo_generation,
                        EventPhase::Progress,
                        LocalizedMessage::new("backendOperationInProgress"),
                    );
                }
            });
            let result = self.dispatch(repo, before, action, target_binding, control);
            let _ = finished.send(());
            let _ = heartbeat.join();
            result
        })
    }

    fn dispatch(
        &self,
        repo: &RepoContext,
        before: &RepoSnapshot,
        action: &Action,
        target_binding: Option<&TargetBinding>,
        control: &RunControl,
    ) -> WorkspaceResult<(LocalizedMessage, GitOutput)> {
        if matches!(
            action,
            Action::Stage { .. }
                | Action::Commit { .. }
                | Action::Pull { .. }
                | Action::Push { .. }
                | Action::Checkout { .. }
                | Action::Merge { .. }
                | Action::Rebase { .. }
                | Action::CherryPick { .. }
                | Action::Revert { .. }
                | Action::Reset { .. }
                | Action::GitFlow { .. }
                | Action::Continue
                | Action::Skip
                | Action::CreateBranch { checkout: true, .. }
        ) {
            self.ensure_lfs_repository_supported(&repo.root, Some(control))?;
        }
        match action {
            Action::Stage { paths, selection } => {
                let output = if let Some(selection) = selection {
                    self.reject_lfs_line_selection(repo, selection.path(), control)?;
                    let patch = self.selected_patch(
                        repo,
                        before,
                        DiffTarget::Unstaged,
                        selection,
                        control,
                    )?;
                    self.apply_patch(repo, &patch, true, false, control)?
                } else {
                    self.run_checked(
                        repo,
                        GitCommand::Add {
                            paths: paths.clone(),
                        },
                        None,
                        control,
                    )?
                };
                Ok((LocalizedMessage::new("backendChangesStaged"), output))
            }
            Action::Unstage { paths, selection } => {
                let output = if let Some(selection) = selection {
                    self.reject_lfs_line_selection(repo, selection.path(), control)?;
                    let patch =
                        self.selected_patch(repo, before, DiffTarget::Staged, selection, control)?;
                    self.apply_patch(repo, &patch, true, true, control)?
                } else {
                    let command = if matches!(&before.head, HeadState::Unborn { .. }) {
                        GitCommand::RemoveCached {
                            paths: paths.clone(),
                        }
                    } else {
                        GitCommand::RestoreStaged {
                            paths: paths.clone(),
                        }
                    };
                    self.run_checked(repo, command, None, control)?
                };
                Ok((LocalizedMessage::new("backendChangesUnstaged"), output))
            }
            Action::Discard {
                paths,
                target,
                selection,
            } => match target {
                DiscardTarget::Unstaged => {
                    let output = if let Some(selection) = selection {
                        let patch = self.selected_patch(
                            repo,
                            before,
                            DiffTarget::Unstaged,
                            selection,
                            control,
                        )?;
                        self.apply_patch(repo, &patch, false, true, control)?
                    } else {
                        self.run_checked(
                            repo,
                            GitCommand::RestoreWorktree {
                                paths: paths.clone(),
                            },
                            None,
                            control,
                        )?
                    };
                    Ok((
                        LocalizedMessage::new("backendUnstagedChangesDiscarded"),
                        output,
                    ))
                }
                DiscardTarget::Untracked => {
                    discard_untracked(repo, before, paths)?;
                    Ok((
                        LocalizedMessage::new("backendUntrackedFilesTrashed"),
                        synthetic_output("trash"),
                    ))
                }
            },
            Action::Commit {
                input,
                include_all_changes,
            } => {
                self.ensure_pending_journal_effect(repo, before, control)?;
                let message = build_message(input)?;
                let file = MessageFile::create(&repo.git_dir, &message)?;
                if *include_all_changes {
                    self.run_checked(repo, GitCommand::AddAll, None, control)?;
                }
                let output = self.run_checked(
                    repo,
                    GitCommand::Commit {
                        message_file: file.path().to_path_buf(),
                    },
                    None,
                    control,
                );
                let output = match output {
                    Ok(output) => output,
                    Err(error) => {
                        let error = match self.recover_failed_pending_commit(repo, before, control)
                        {
                            Ok(()) => error,
                            Err(recovery_error) => {
                                error.detail("journalRecovery", recovery_error.message)
                            }
                        };
                        return Err(error);
                    }
                };
                self.journal.clear(&repo.id)?;
                Ok((LocalizedMessage::new("backendCommitCreated"), output))
            }
            Action::Fetch { remote } => {
                let output = self.run_checked(
                    repo,
                    GitCommand::Fetch {
                        remote: remote.clone(),
                        branch: None,
                    },
                    None,
                    control,
                )?;
                Ok((LocalizedMessage::new("backendFetchCompleted"), output))
            }
            Action::Pull {
                remote,
                remote_branch,
            } => {
                self.run_checked(
                    repo,
                    GitCommand::Fetch {
                        remote: remote.clone(),
                        branch: Some(remote_branch.clone()),
                    },
                    None,
                    control,
                )?;
                let fetched = self.resolve(repo, "FETCH_HEAD", control)?;
                self.ensure_pull_not_diverged(repo, before, &fetched, control)?;
                let output = self.run_checked(
                    repo,
                    GitCommand::MergeFastForward { source: fetched },
                    None,
                    control,
                )?;
                Ok((LocalizedMessage::new("backendPullCompleted"), output))
            }
            Action::Push {
                remote,
                local_branch,
                remote_branch,
                set_upstream,
                force_with_lease,
                push_tags,
            } => {
                if self.git.has_lfs() {
                    let mut lfs_args = vec!["push".into()];
                    if *push_tags {
                        lfs_args.push("--all".into());
                    }
                    lfs_args.push(remote.into());
                    lfs_args.push(format!("refs/heads/{local_branch}").into());
                    if *push_tags {
                        let references = self
                            .git
                            .run(
                                Some(&repo.root),
                                GitCommand::References,
                                None,
                                Some(control),
                            )?
                            .ensure_success()?;
                        lfs_args.extend(
                            String::from_utf8_lossy(&references.stdout)
                                .lines()
                                .filter_map(|line| line.split_once('\0').map(|(name, _)| name))
                                .filter(|name| name.starts_with("refs/tags/"))
                                .map(Into::into),
                        );
                    }
                    self.git
                        .run_lfs(&repo.root, lfs_args, Some(control))?
                        .ensure_success()?;
                }
                let refspec = format!("refs/heads/{local_branch}:refs/heads/{remote_branch}");
                let lease = force_with_lease
                    .then(|| {
                        let remote_ref = format!("refs/remotes/{remote}/{remote_branch}");
                        let expected = self
                            .git
                            .run(Some(&repo.root), GitCommand::Branches, None, Some(control))
                            .and_then(GitOutput::ensure_success)
                            .map(|output| {
                                parse_branches(&output.stdout)
                                    .into_iter()
                                    .find(|branch| branch.full_name == remote_ref)
                                    .map_or_else(String::new, |branch| branch.oid)
                            })?;
                        Ok::<_, WorkspaceError>((format!("refs/heads/{remote_branch}"), expected))
                    })
                    .transpose()?;
                let output = self.run_checked(
                    repo,
                    GitCommand::Push {
                        remote: remote.clone(),
                        refspec,
                        set_upstream: *set_upstream,
                        force_with_lease: lease,
                        push_tags: *push_tags,
                    },
                    None,
                    control,
                )?;
                Ok((LocalizedMessage::new("backendPushCompleted"), output))
            }
            Action::SetRemoteUrl {
                remote,
                url_kind,
                expected_url,
                new_url,
            } => {
                let push = *url_kind == RemoteUrlKind::Push;
                let output = self.run_checked(
                    repo,
                    GitCommand::SetRemoteUrl {
                        remote: remote.clone(),
                        push,
                        new_url: new_url.clone(),
                        expected_url: expected_url.clone(),
                    },
                    None,
                    control,
                )?;
                let updated = self
                    .remote_definitions(repo, Some(control))?
                    .into_iter()
                    .find(|definition| definition.name == *remote)
                    .ok_or_else(|| {
                        WorkspaceError::new(
                            ErrorCode::Internal,
                            "The updated remote could not be read back",
                        )
                    })?;
                let urls = if push {
                    updated.push_urls
                } else {
                    updated.fetch_urls
                };
                if !urls.contains(new_url) {
                    return Err(WorkspaceError::new(
                        ErrorCode::Internal,
                        "The updated remote URL did not match the requested value",
                    ));
                }
                Ok((LocalizedMessage::new("backendRemoteUrlUpdated"), output))
            }
            Action::AddRemote { remote, url } => {
                let output = self.run_checked(
                    repo,
                    GitCommand::AddRemote {
                        remote: remote.clone(),
                        url: url.clone(),
                    },
                    None,
                    control,
                )?;
                let added = self
                    .remote_definitions(repo, Some(control))?
                    .into_iter()
                    .find(|definition| definition.name == *remote)
                    .ok_or_else(|| {
                        WorkspaceError::new(
                            ErrorCode::Internal,
                            "The added remote could not be read back",
                        )
                    })?;
                if !added.fetch_urls.contains(url) || !added.push_urls.contains(url) {
                    return Err(WorkspaceError::new(
                        ErrorCode::Internal,
                        "The added remote URL did not match the requested value",
                    ));
                }
                Ok((LocalizedMessage::new("backendRemoteAdded"), output))
            }
            Action::CreateBranch {
                name,
                start_point,
                checkout,
            } => {
                let start = self.bound_target(repo, start_point, target_binding, control)?;
                let output = if *checkout {
                    self.run_checked(
                        repo,
                        GitCommand::CreateAndSwitch {
                            name: name.clone(),
                            start_point: start,
                        },
                        None,
                        control,
                    )?
                } else {
                    self.run_checked(
                        repo,
                        GitCommand::CreateBranch {
                            name: name.clone(),
                            start_point: start,
                        },
                        None,
                        control,
                    )?
                };
                Ok((LocalizedMessage::new("backendBranchCreated"), output))
            }
            Action::DeleteBranch { name } => {
                let output = self.run_checked(
                    repo,
                    GitCommand::DeleteBranch {
                        name: name.clone(),
                        // 対象先端と失われるコミットはプレビューの紐付けで再検証済みなので、追跡先のマージ判定には委ねない。
                        force: true,
                    },
                    None,
                    control,
                )?;
                Ok((LocalizedMessage::new("backendBranchDeleted"), output))
            }
            Action::CreateTag { name, target } => {
                let target = self.bound_target(repo, target, target_binding, control)?;
                let output = self.run_checked(
                    repo,
                    GitCommand::CreateTag {
                        name: name.clone(),
                        target,
                    },
                    None,
                    control,
                )?;
                Ok((LocalizedMessage::new("backendTagCreated"), output))
            }
            Action::GitFlow { request } => {
                if request.requires_clean_worktree() {
                    require_clean(before)?;
                }
                let output = if matches!(
                    request.command,
                    GitFlowCommand::Continue | GitFlowCommand::Abort
                ) {
                    git_flow::recover(
                        &self.git,
                        &repo.root,
                        &repo.git_dir,
                        request.command,
                        Some(control),
                    )?
                    .ok_or_else(|| {
                        WorkspaceError::new(
                            ErrorCode::InvalidRequest,
                            "No Git Flow operation can be recovered",
                        )
                    })?
                } else {
                    git_flow::execute(&self.git, &repo.root, request, Some(control))?
                };
                Ok((LocalizedMessage::new("backendGitFlowCompleted"), output))
            }
            Action::Checkout { branch } => {
                let output = self.run_checked(
                    repo,
                    GitCommand::Switch {
                        branch: branch.clone(),
                    },
                    None,
                    control,
                )?;
                Ok((LocalizedMessage::new("backendBranchCheckedOut"), output))
            }
            Action::Merge {
                source,
                commit_immediately,
            } => {
                require_clean(before)?;
                let source = self.bound_target(repo, source, target_binding, control)?;
                let output = self.run_checked(
                    repo,
                    GitCommand::Merge {
                        source,
                        commit_immediately: *commit_immediately,
                    },
                    None,
                    control,
                )?;
                Ok((LocalizedMessage::new("backendMergeCreated"), output))
            }
            Action::Rebase { onto } => {
                require_clean(before)?;
                let onto = self.bound_target(repo, onto, target_binding, control)?;
                let output = self.run_checked(repo, GitCommand::Rebase { onto }, None, control)?;
                Ok((LocalizedMessage::new("backendRebaseCompleted"), output))
            }
            Action::CherryPick { commit, mainline } => {
                require_clean(before)?;
                let source_oid = self.bound_target(repo, commit, target_binding, control)?;
                let pre_head_oid = self.head_oid(repo)?;
                self.journal.save(&OperationJournal {
                    worktree_id: repo.id.clone(),
                    operation: StructuredOperation::CherryPick,
                    source_oid: source_oid.clone(),
                    pre_head_oid,
                    phase: Some(JournalPhase::Preparing),
                    effect_digest: None,
                    state_fingerprint: None,
                })?;
                let execution = self.run_checked(
                    repo,
                    GitCommand::CherryPickNoCommit {
                        commit: source_oid,
                        mainline: *mainline,
                    },
                    None,
                    control,
                );
                if execution.is_ok() || self.repo_has_unmerged(repo)? {
                    self.persist_operation_effect(repo, control)?;
                }
                let output = execution?;
                Ok((LocalizedMessage::new("backendCherryPickCreated"), output))
            }
            Action::Revert { commit, mainline } => {
                require_clean(before)?;
                let source_oid = self.bound_target(repo, commit, target_binding, control)?;
                let pre_head_oid = self.head_oid(repo)?;
                self.journal.save(&OperationJournal {
                    worktree_id: repo.id.clone(),
                    operation: StructuredOperation::Revert,
                    source_oid: source_oid.clone(),
                    pre_head_oid,
                    phase: Some(JournalPhase::Preparing),
                    effect_digest: None,
                    state_fingerprint: None,
                })?;
                let execution = self.run_checked(
                    repo,
                    GitCommand::RevertNoCommit {
                        commit: source_oid,
                        mainline: *mainline,
                    },
                    None,
                    control,
                );
                if execution.is_ok() || self.repo_has_unmerged(repo)? {
                    self.persist_operation_effect(repo, control)?;
                }
                let output = execution?;
                Ok((LocalizedMessage::new("backendRevertCreated"), output))
            }
            Action::Reset { commit, mode } => {
                let commit = self.bound_target(repo, commit, target_binding, control)?;
                let output = self.run_checked(
                    repo,
                    GitCommand::Reset {
                        commit,
                        mode: *mode,
                    },
                    None,
                    control,
                )?;
                Ok((
                    LocalizedMessage::new("backendResetCompleted").arg("mode", format!("{mode:?}")),
                    output,
                ))
            }
            Action::Continue => self.continue_operation(repo, before, control),
            Action::Skip => self.skip_operation(repo, before, control),
            Action::Abort => self.abort_operation(repo, before, control),
            Action::ConflictSave { .. } => Err(WorkspaceError::new(
                ErrorCode::Internal,
                "ConflictSave dispatch invariant violated",
            )),
            Action::ConflictChoice { .. } => Err(WorkspaceError::new(
                ErrorCode::Internal,
                "ConflictChoice dispatch invariant violated",
            )),
            Action::ConflictMarkResolved {
                session_id,
                conflict_generation,
                content_hash,
                result_kind: _,
            } => {
                let session = self.conflict_session(repo, session_id)?;
                conflict::validate_session(&session, session_id, conflict_generation)?;
                if !session.resolution_evidence
                    && (session.blocks.is_empty() || !session.in_app_edit)
                {
                    conflict::verify_saved_result_identity(
                        &repo.root,
                        &session,
                        content_hash,
                        Some(control),
                    )?;
                    return Err(WorkspaceError::new(
                        ErrorCode::InvalidRequest,
                        "Select or edit the conflict result before marking it resolved",
                    ));
                }
                if session
                    .blocks
                    .iter()
                    .any(|block| block.state == ConflictBlockState::Unresolved)
                {
                    return Err(WorkspaceError::new(
                        ErrorCode::InvalidRequest,
                        "Unresolved conflict blocks remain",
                    ));
                }
                let verified = conflict::verify_saved_result(
                    &repo.root,
                    &session,
                    content_hash,
                    Some(control),
                )?;
                if verified.contains_markers {
                    return Err(WorkspaceError::new(
                        ErrorCode::InvalidRequest,
                        "Conflict markers remain",
                    ));
                }
                let output = if conflict::worktree_entry_exists(&repo.root, &session)? {
                    self.run_checked(
                        repo,
                        GitCommand::Add {
                            paths: session.related_paths.clone(),
                        },
                        None,
                        control,
                    )?
                } else {
                    self.run_checked(
                        repo,
                        GitCommand::Remove {
                            paths: session.related_paths.clone(),
                        },
                        None,
                        control,
                    )?
                };
                for path in &session.related_paths {
                    let unmerged = self
                        .git
                        .run(
                            Some(&repo.root),
                            GitCommand::Unmerged {
                                path: Some(path.clone()),
                            },
                            None,
                            Some(control),
                        )?
                        .ensure_success()?;
                    if !unmerged.stdout.is_empty() {
                        return Err(WorkspaceError::new(
                            ErrorCode::GitFailed,
                            format!("Index stages remain for the target path: {path}"),
                        ));
                    }
                }
                repo.conflicts
                    .lock()
                    .expect("conflicts lock")
                    .remove(session_id);
                Ok((LocalizedMessage::new("backendConflictResolved"), output))
            }
            Action::ConflictMaterialize { .. } => Err(WorkspaceError::new(
                ErrorCode::Internal,
                "ConflictMaterialize dispatch invariant violated",
            )),
            Action::ConflictOpenExternal {
                session_id,
                conflict_generation,
                editor,
            } => {
                let session = self.conflict_session(repo, session_id)?;
                conflict::validate_session(&session, session_id, conflict_generation)?;
                conflict::open_external(&repo.root, &session, editor)?;
                self.record_external_conflict_baseline(repo, session_id, session.content_hash)?;
                Ok((
                    LocalizedMessage::new("backendExternalEditorOpened"),
                    synthetic_output("external-editor"),
                ))
            }
            Action::SaveFile {
                path,
                text,
                expected_content_hash,
            } => {
                save_editable_file(
                    &self.git,
                    &repo.root,
                    path,
                    expected_content_hash,
                    text,
                    Some(control),
                )?;
                Ok((
                    LocalizedMessage::new("backendFileSaved").arg("path", path.clone()),
                    synthetic_output("file-save"),
                ))
            }
            Action::RenameFile { path, new_path } => {
                let source = checked_repo_path(&repo.root, path)?;
                let destination = checked_repo_path(&repo.root, new_path)?;
                ensure_renameable_file(&source)?;
                match fs::symlink_metadata(&destination) {
                    Ok(_) => {
                        return Err(WorkspaceError::new(
                            ErrorCode::InvalidRequest,
                            "The destination file already exists",
                        )
                        .detail("path", new_path.clone()));
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => {
                        return Err(WorkspaceError::new(ErrorCode::Io, error.to_string()));
                    }
                }
                fs::rename(&source, &destination)
                    .map_err(|error| WorkspaceError::new(ErrorCode::Io, error.to_string()))?;
                Ok((
                    LocalizedMessage::new("backendFileRenamed")
                        .arg("path", path.clone())
                        .arg("newPath", new_path.clone()),
                    synthetic_output("file-rename"),
                ))
            }
            Action::FileAction { paths, operation } => match operation {
                FileOperation::MoveToTrash => {
                    let targets = paths
                        .iter()
                        .map(|path| checked_repo_path(&repo.root, path))
                        .collect::<WorkspaceResult<Vec<_>>>()?;
                    for target in &targets {
                        ensure_trashable_file(target)?;
                    }
                    for target in targets {
                        trash::delete(&target).map_err(|error| {
                            WorkspaceError::new(ErrorCode::Io, error.to_string())
                        })?;
                    }
                    Ok((
                        LocalizedMessage::new("backendFilesDeleted")
                            .number_arg("count", paths.len()),
                        synthetic_output("move-to-trash"),
                    ))
                }
                FileOperation::RevealInFinder => {
                    let path = paths.first().ok_or_else(|| {
                        WorkspaceError::new(
                            ErrorCode::InvalidRequest,
                            "A file action requires one path",
                        )
                    })?;
                    let absolute = checked_repo_path(&repo.root, path)?;
                    launch_macos_open(&finder_reveal_arguments(&repo.root, &absolute)?)?;
                    Ok((
                        LocalizedMessage::new("backendShownInFinder"),
                        synthetic_output("reveal-in-finder"),
                    ))
                }
                FileOperation::OpenInDefaultApp => {
                    let path = paths.first().ok_or_else(|| {
                        WorkspaceError::new(
                            ErrorCode::InvalidRequest,
                            "A file action requires one path",
                        )
                    })?;
                    let absolute = checked_repo_path(&repo.root, path)?;
                    ensure_openable_file(&absolute)?;
                    launch_macos_open(&macos_open_arguments(
                        FileOperation::OpenInDefaultApp,
                        &absolute,
                    )?)?;
                    Ok((
                        LocalizedMessage::new("backendOpenedInDefaultApp"),
                        synthetic_output("open-in-default-app"),
                    ))
                }
            },
        }
    }

    fn run_checked(
        &self,
        repo: &RepoContext,
        command: GitCommand,
        stdin: Option<&[u8]>,
        control: &RunControl,
    ) -> WorkspaceResult<GitOutput> {
        self.git
            .run(Some(&repo.root), command, stdin, Some(control))?
            .ensure_success()
    }

    fn ensure_pull_not_diverged(
        &self,
        repo: &RepoContext,
        before: &RepoSnapshot,
        fetched: &str,
        control: &RunControl,
    ) -> WorkspaceResult<()> {
        let head = match &before.head {
            HeadState::Branch { oid: Some(oid), .. } | HeadState::Detached { oid } => oid,
            HeadState::Branch { oid: None, .. } | HeadState::Unborn { .. } => return Ok(()),
        };
        let output = self.git.run(
            Some(&repo.root),
            GitCommand::MergeBase {
                left: head.clone(),
                right: fetched.to_owned(),
            },
            None,
            Some(control),
        )?;
        if output.status == Some(1) && !output.cancelled {
            return Err(WorkspaceError::new(
                ErrorCode::PullDiverged,
                "The local and remote branches have no common ancestor",
            ));
        }
        let base = output.ensure_success()?.stdout_text().trim().to_owned();
        if base != *head && base != fetched {
            return Err(WorkspaceError::new(
                ErrorCode::PullDiverged,
                "The local and remote branches have diverged",
            ));
        }
        Ok(())
    }

    fn record_external_conflict_baseline(
        &self,
        repo: &RepoContext,
        session_id: &str,
        content_hash: String,
    ) -> WorkspaceResult<()> {
        let mut sessions = repo.conflicts.lock().expect("conflicts lock");
        let session = sessions.get_mut(session_id).ok_or_else(|| {
            WorkspaceError::new(
                ErrorCode::ConflictStateChanged,
                "The conflict session is stale. Reload the conflict",
            )
        })?;
        session.external_baseline_hash = Some(content_hash);
        Ok(())
    }

    fn apply_patch(
        &self,
        repo: &RepoContext,
        patch: &str,
        cached: bool,
        reverse: bool,
        control: &RunControl,
    ) -> WorkspaceResult<GitOutput> {
        self.run_checked(
            repo,
            GitCommand::Apply {
                cached,
                reverse,
                check: true,
            },
            Some(patch.as_bytes()),
            control,
        )?;
        self.run_checked(
            repo,
            GitCommand::Apply {
                cached,
                reverse,
                check: false,
            },
            Some(patch.as_bytes()),
            control,
        )
    }

    fn resolve(
        &self,
        repo: &RepoContext,
        revision: &str,
        control: &RunControl,
    ) -> WorkspaceResult<String> {
        validate_revision(revision)?;
        let output = self.run_checked(
            repo,
            GitCommand::Resolve {
                revision: revision.to_owned(),
            },
            None,
            control,
        )?;
        Ok(output.stdout_text().trim().to_owned())
    }

    fn bound_target(
        &self,
        repo: &RepoContext,
        input: &str,
        binding: Option<&TargetBinding>,
        control: &RunControl,
    ) -> WorkspaceResult<String> {
        if let Some(binding) = binding {
            return binding
                .resolved_targets
                .iter()
                .find(|target| target.input == input)
                .map(|target| target.oid.clone())
                .ok_or_else(|| {
                    WorkspaceError::new(
                        ErrorCode::PreviewMismatch,
                        "The target resolved during preview was not found",
                    )
                });
        }
        self.resolve(repo, input, control)
    }

    fn selected_patch(
        &self,
        repo: &RepoContext,
        snapshot: &RepoSnapshot,
        target: DiffTarget,
        selection: &PatchSelection,
        control: &RunControl,
    ) -> WorkspaceResult<String> {
        let material = self.diff_material(
            repo,
            snapshot,
            target,
            &[selection.path().to_owned()],
            Some(control),
        )?;
        if hash(&material.bytes) != selection.diff_revision() {
            return Err(WorkspaceError::new(
                ErrorCode::StaleDiff,
                "The diff changed. Reload it and try again",
            ));
        }
        if material.truncated || material.bytes.len() > DIFF_LIMIT {
            return Err(WorkspaceError::new(
                ErrorCode::UnsupportedRepository,
                "Partial selection is unavailable for truncated diffs",
            ));
        }
        let patch = std::str::from_utf8(&material.bytes).map_err(|_| {
            WorkspaceError::new(
                ErrorCode::UnsupportedRepository,
                "Partial selection is unavailable for non-UTF-8 diffs",
            )
        })?;
        if patch.contains("GIT binary patch") || patch.contains("Binary files ") {
            return Err(WorkspaceError::new(
                ErrorCode::UnsupportedRepository,
                "Partial selection is unavailable for binary files or symlinks",
            ));
        }
        build_selected_patch(patch, selection)
    }

    fn diff_material(
        &self,
        repo: &RepoContext,
        snapshot: &RepoSnapshot,
        target: DiffTarget,
        paths: &[String],
        control: Option<&RunControl>,
    ) -> WorkspaceResult<DiffMaterial> {
        let untracked: Vec<String> = if target == DiffTarget::Unstaged {
            snapshot
                .entries
                .iter()
                .filter(|entry| {
                    entry.untracked
                        && (paths.is_empty() || paths.iter().any(|path| path == &entry.path))
                })
                .map(|entry| entry.path.clone())
                .collect()
        } else {
            Vec::new()
        };
        let tracked_paths: Vec<String> = paths
            .iter()
            .filter(|path| !untracked.iter().any(|untracked| untracked == *path))
            .cloned()
            .collect();
        let run_tracked = paths.is_empty() || !tracked_paths.is_empty();
        let (mut bytes, mut truncated) = if run_tracked {
            let output = self
                .git
                .run(
                    Some(&repo.root),
                    GitCommand::Diff {
                        target,
                        paths: tracked_paths,
                    },
                    None,
                    control,
                )?
                .ensure_success()?;
            (output.stdout, output.truncated)
        } else {
            (Vec::new(), false)
        };
        truncated |= bytes.len() > DIFF_LIMIT;
        for path in untracked {
            if !bytes.is_empty() && !bytes.ends_with(b"\n") {
                bytes.push(b'\n');
            }
            let patch = self.untracked_diff(repo, &path, control)?;
            truncated |= patch.truncated;
            bytes.extend_from_slice(&patch.bytes);
        }
        Ok(DiffMaterial { bytes, truncated })
    }

    fn untracked_diff(
        &self,
        repo: &RepoContext,
        path: &str,
        control: Option<&RunControl>,
    ) -> WorkspaceResult<DiffMaterial> {
        validate_path(path)?;
        let absolute = repo.root.join(path);
        let metadata = fs::symlink_metadata(&absolute)
            .map_err(|error| WorkspaceError::new(ErrorCode::Io, error.to_string()))?;
        if metadata.file_type().is_symlink() {
            return Ok(DiffMaterial {
                bytes: untracked_placeholder(
                    path,
                    "120000",
                    "Binary files /dev/null and {path} differ",
                ),
                truncated: false,
            });
        }
        if !metadata.is_file() {
            return Err(WorkspaceError::new(
                ErrorCode::UnsupportedRepository,
                "Diffs are unavailable for untracked entries that are not regular files",
            ));
        }
        let canonical = absolute
            .canonicalize()
            .map_err(|error| WorkspaceError::new(ErrorCode::Io, error.to_string()))?;
        if !canonical.starts_with(&repo.root) {
            return Err(WorkspaceError::new(
                ErrorCode::InvalidRequest,
                "Files outside the repository cannot be diffed",
            ));
        }
        let mode = if metadata.permissions().mode() & 0o111 == 0 {
            "100644"
        } else {
            "100755"
        };
        if metadata.len() > DIFF_LIMIT as u64 {
            return Ok(DiffMaterial {
                bytes: untracked_placeholder(
                    path,
                    mode,
                    "untracked file content omitted because it exceeds the diff limit",
                ),
                truncated: true,
            });
        }
        let output = self.git.run(
            Some(&repo.root),
            GitCommand::UntrackedDiff {
                path: path.to_owned(),
            },
            None,
            control,
        )?;
        if output.cancelled || !matches!(output.status, Some(0 | 1)) {
            return Err(output
                .ensure_success()
                .expect_err("no-index diff must fail for a non-diff error"));
        }
        Ok(DiffMaterial {
            truncated: output.truncated || output.stdout.len() > DIFF_LIMIT,
            bytes: output.stdout,
        })
    }

    fn conflict_session(
        &self,
        repo: &RepoContext,
        session_id: &str,
    ) -> WorkspaceResult<ConflictSession> {
        repo.conflicts
            .lock()
            .expect("conflicts lock")
            .get(session_id)
            .cloned()
            .ok_or_else(|| {
                WorkspaceError::new(
                    ErrorCode::ConflictStateChanged,
                    "The conflict session is stale. Reload the conflict",
                )
            })
    }

    fn reject_lfs_line_selection(
        &self,
        repo: &RepoContext,
        path: &str,
        control: &RunControl,
    ) -> WorkspaceResult<()> {
        let output = self
            .git
            .run(
                Some(&repo.root),
                GitCommand::CheckLfsAttribute { path: path.into() },
                None,
                Some(control),
            )?
            .ensure_success()?;
        let fields = output.stdout.split(|byte| *byte == 0).collect::<Vec<_>>();
        if fields.len() >= 3 && fields[1] == b"filter" && fields[2] == b"lfs" {
            return Err(WorkspaceError::new(
                ErrorCode::InvalidRequest,
                "Git LFS対象ファイルは行単位でステージまたはステージ解除できません。ファイル全体を選択してください。",
            )
            .detail("path", path)
            .detail("filter", "lfs"));
        }
        Ok(())
    }

    fn continue_operation(
        &self,
        repo: &RepoContext,
        before: &RepoSnapshot,
        control: &RunControl,
    ) -> WorkspaceResult<(LocalizedMessage, GitOutput)> {
        if let Some(output) = git_flow::recover(
            &self.git,
            &repo.root,
            &repo.git_dir,
            GitFlowCommand::Continue,
            Some(control),
        )? {
            return Ok((LocalizedMessage::new("backendGitFlowCompleted"), output));
        }
        match &before.operation {
            OperationState::Rebase => Ok((
                LocalizedMessage::new("backendRebaseContinued"),
                self.run_checked(
                    repo,
                    GitCommand::RebaseSequencer {
                        action: SequencerAction::Continue,
                    },
                    None,
                    control,
                )?,
            )),
            OperationState::CherryPick { source_oid } => {
                self.ensure_structured_continue_journal(
                    repo,
                    StructuredOperation::CherryPick,
                    source_oid.as_deref(),
                )?;
                self.ensure_no_unmerged(repo, control)?;
                let output = self.run_checked(
                    repo,
                    GitCommand::CherryPickSequencer {
                        action: SequencerAction::Quit,
                    },
                    None,
                    control,
                )?;
                self.persist_operation_effect(repo, control)?;
                Ok((
                    LocalizedMessage::new("backendCherryPickReadyToCommit"),
                    output,
                ))
            }
            OperationState::Revert { source_oid } => {
                self.ensure_structured_continue_journal(
                    repo,
                    StructuredOperation::Revert,
                    source_oid.as_deref(),
                )?;
                self.ensure_no_unmerged(repo, control)?;
                let output = self.run_checked(
                    repo,
                    GitCommand::RevertSequencer {
                        action: SequencerAction::Quit,
                    },
                    None,
                    control,
                )?;
                self.persist_operation_effect(repo, control)?;
                Ok((LocalizedMessage::new("backendRevertReadyToCommit"), output))
            }
            OperationState::Merge { .. } => Err(WorkspaceError::new(
                ErrorCode::InvalidRequest,
                "Complete the merge from the structured commit form",
            )),
            _ => Err(WorkspaceError::new(
                ErrorCode::InvalidRequest,
                "No operation can be continued",
            )),
        }
    }

    fn ensure_structured_continue_journal(
        &self,
        repo: &RepoContext,
        operation: StructuredOperation,
        source_oid: Option<&str>,
    ) -> WorkspaceResult<()> {
        let journal = self.journal.load(&repo.id)?;
        let current_head = self.head_oid(repo)?;
        let marker_oid = match operation {
            StructuredOperation::CherryPick => read_marker(&repo.git_dir.join("CHERRY_PICK_HEAD"))?,
            StructuredOperation::Revert => read_marker(&repo.git_dir.join("REVERT_HEAD"))?,
        };
        let matches_stella_operation = journal.as_ref().is_some_and(|journal| {
            journal.worktree_id == repo.id
                && journal.operation == operation
                && source_oid == Some(journal.source_oid.as_str())
                && marker_oid
                    .as_deref()
                    .is_none_or(|marker_oid| marker_oid == journal.source_oid)
                && journal.pre_head_oid == current_head
                && journal.effective_phase() == JournalPhase::Applied
                && journal.effect_digest.is_some()
                && journal.state_fingerprint.is_some()
        });
        if !matches_stella_operation {
            return Err(WorkspaceError::new(
                ErrorCode::OperationInProgress,
                "The operation does not match the recorded journal. Continue with Git outside the app",
            ));
        }
        Ok(())
    }

    fn persist_operation_effect(
        &self,
        repo: &RepoContext,
        control: &RunControl,
    ) -> WorkspaceResult<()> {
        let mut journal = self.journal.load(&repo.id)?.ok_or_else(|| {
            WorkspaceError::new(ErrorCode::Internal, "Operation journal not found")
        })?;
        let status = self
            .git
            .run(Some(&repo.root), GitCommand::Status, None, Some(control))?
            .ensure_success()?;
        let parsed = parse_status(&status.stdout)?;
        journal.effect_digest =
            Some(self.repository_state_digest(repo, &parsed, None, Some(control))?);
        journal.state_fingerprint = Some(self.repository_generation_fingerprint(
            repo,
            &parsed,
            &status.stdout,
            Some(control),
        )?);
        journal.phase = Some(JournalPhase::Applied);
        self.journal.save(&journal)
    }

    fn ensure_pending_journal_effect(
        &self,
        repo: &RepoContext,
        snapshot: &RepoSnapshot,
        control: &RunControl,
    ) -> WorkspaceResult<()> {
        let OperationState::PendingStructuredCommit {
            operation,
            source_oid,
            pre_head_oid,
        } = &snapshot.operation
        else {
            return Ok(());
        };
        let journal = self.journal.load(&repo.id)?.ok_or_else(|| {
            WorkspaceError::new(
                ErrorCode::OperationInProgress,
                "The operation journal changed. Reload and try again",
            )
        })?;
        let current_head = self.head_oid(repo)?;
        let effect_digest = self.repository_state_digest(repo, snapshot, None, Some(control))?;
        if journal.operation != *operation
            || journal.source_oid != *source_oid
            || journal.pre_head_oid != *pre_head_oid
            || journal.effective_phase() != JournalPhase::Applied
            || current_head != *pre_head_oid
            || journal.effect_digest.as_deref() != Some(effect_digest.as_str())
        {
            return Err(WorkspaceError::new(
                ErrorCode::OperationInProgress,
                "The operation result changed from the journal record. Review it again",
            ));
        }
        Ok(())
    }

    fn recover_failed_pending_commit(
        &self,
        repo: &RepoContext,
        snapshot: &RepoSnapshot,
        control: &RunControl,
    ) -> WorkspaceResult<()> {
        let OperationState::PendingStructuredCommit {
            operation,
            source_oid,
            pre_head_oid,
        } = &snapshot.operation
        else {
            return Ok(());
        };
        let mut journal = self.journal.load(&repo.id)?.ok_or_else(|| {
            WorkspaceError::new(
                ErrorCode::OperationInProgress,
                "Operation journal not found after the commit failed",
            )
        })?;
        if journal.operation != *operation
            || journal.source_oid != *source_oid
            || journal.pre_head_oid != *pre_head_oid
            || journal.effective_phase() != JournalPhase::Applied
        {
            return Err(WorkspaceError::new(
                ErrorCode::OperationInProgress,
                "The operation journal changed after the commit failed",
            ));
        }
        if self.head_oid(repo)? != *pre_head_oid {
            return Ok(());
        }

        let status = self
            .git
            .run(Some(&repo.root), GitCommand::Status, None, Some(control))?
            .ensure_success()?;
        let parsed = parse_status(&status.stdout)?;
        let current_effect = self.repository_state_digest(repo, &parsed, None, Some(control))?;
        journal.state_fingerprint = Some(self.repository_generation_fingerprint(
            repo,
            &parsed,
            &status.stdout,
            Some(control),
        )?);
        if journal.effect_digest.as_deref() != Some(current_effect.as_str()) {
            journal.phase = Some(JournalPhase::AbortRecovery);
            journal.effect_digest = Some(current_effect);
        }
        self.journal.save(&journal)
    }

    fn repo_has_unmerged(&self, repo: &RepoContext) -> WorkspaceResult<bool> {
        let output = self
            .git
            .run(
                Some(&repo.root),
                GitCommand::Unmerged { path: None },
                None,
                None,
            )?
            .ensure_success()?;
        Ok(!output.stdout.is_empty())
    }

    fn skip_operation(
        &self,
        repo: &RepoContext,
        before: &RepoSnapshot,
        control: &RunControl,
    ) -> WorkspaceResult<(LocalizedMessage, GitOutput)> {
        let output = match before.operation {
            OperationState::Rebase => self.run_checked(
                repo,
                GitCommand::RebaseSequencer {
                    action: SequencerAction::Skip,
                },
                None,
                control,
            )?,
            OperationState::CherryPick { .. } => self.run_checked(
                repo,
                GitCommand::CherryPickSequencer {
                    action: SequencerAction::Skip,
                },
                None,
                control,
            )?,
            OperationState::Revert { .. } => self.run_checked(
                repo,
                GitCommand::RevertSequencer {
                    action: SequencerAction::Skip,
                },
                None,
                control,
            )?,
            _ => {
                return Err(WorkspaceError::new(
                    ErrorCode::InvalidRequest,
                    "No operation can be skipped",
                ));
            }
        };
        self.journal.clear(&repo.id)?;
        Ok((LocalizedMessage::new("backendCommitSkipped"), output))
    }

    fn abort_operation(
        &self,
        repo: &RepoContext,
        before: &RepoSnapshot,
        control: &RunControl,
    ) -> WorkspaceResult<(LocalizedMessage, GitOutput)> {
        if let Some(output) = git_flow::recover(
            &self.git,
            &repo.root,
            &repo.git_dir,
            GitFlowCommand::Abort,
            Some(control),
        )? {
            self.journal.clear(&repo.id)?;
            repo.conflicts.lock().expect("conflicts lock").clear();
            return Ok((LocalizedMessage::new("backendGitFlowCompleted"), output));
        }
        let output = match &before.operation {
            OperationState::Merge { .. } => self.run_checked(
                repo,
                GitCommand::MergeSequencer {
                    action: SequencerAction::Abort,
                },
                None,
                control,
            )?,
            OperationState::Rebase => self.run_checked(
                repo,
                GitCommand::RebaseSequencer {
                    action: SequencerAction::Abort,
                },
                None,
                control,
            )?,
            OperationState::CherryPick { .. } => self.run_checked(
                repo,
                GitCommand::CherryPickSequencer {
                    action: SequencerAction::Abort,
                },
                None,
                control,
            )?,
            OperationState::Revert { .. } => self.run_checked(
                repo,
                GitCommand::RevertSequencer {
                    action: SequencerAction::Abort,
                },
                None,
                control,
            )?,
            OperationState::PendingStructuredCommit { pre_head_oid, .. }
            | OperationState::StructuredAbortRecovery { pre_head_oid, .. } => self.run_checked(
                repo,
                GitCommand::Reset {
                    commit: pre_head_oid.clone(),
                    mode: ResetMode::Hard,
                },
                None,
                control,
            )?,
            _ => {
                return Err(WorkspaceError::new(
                    ErrorCode::InvalidRequest,
                    "No operation can be aborted",
                ));
            }
        };
        self.journal.clear(&repo.id)?;
        repo.conflicts.lock().expect("conflicts lock").clear();
        Ok((LocalizedMessage::new("backendOperationAborted"), output))
    }

    fn ensure_no_unmerged(&self, repo: &RepoContext, control: &RunControl) -> WorkspaceResult<()> {
        let output = self.run_checked(repo, GitCommand::Unmerged { path: None }, None, control)?;
        if !output.stdout.is_empty() {
            return Err(WorkspaceError::new(
                ErrorCode::GitFailed,
                "Unresolved conflicts remain",
            ));
        }
        Ok(())
    }

    fn consume_preview(
        &self,
        repo: &RepoContext,
        snapshot: &RepoSnapshot,
        request: &ExecuteRequest,
        generation: RepoGeneration,
        control: &RunControl,
    ) -> WorkspaceResult<Option<TargetBinding>> {
        if !request.action.requires_preview_binding() {
            return Ok(None);
        }
        let token = request.confirmation_token.as_ref().ok_or_else(|| {
            WorkspaceError::new(
                ErrorCode::PreviewRequired,
                "A confirmation preview is required",
            )
        })?;
        let now = SystemTime::now();
        let record = {
            let mut previews = self.previews.lock().expect("previews lock");
            prune_expired_preview_records(&mut previews, now);
            previews.remove(token)
        }
        .ok_or_else(|| {
            WorkspaceError::new(
                ErrorCode::PreviewExpired,
                "The confirmation token has expired",
            )
        })?;
        if record.repo_id != repo.id
            || record.generation != generation
            || record.action_hash != action_hash(&request.action)?
        {
            return Err(WorkspaceError::new(
                ErrorCode::PreviewMismatch,
                "The target changed after the preview",
            ));
        }
        let current_binding =
            self.target_binding(repo, snapshot, &request.action, Some(control))?;
        if record.target_binding != current_binding {
            return Err(WorkspaceError::new(
                ErrorCode::PreviewMismatch,
                "The target ref or impact changed after the preview",
            ));
        }
        Ok(record.target_binding)
    }

    fn send_event(
        &self,
        repo: &RepoContext,
        operation_id: Option<&str>,
        generation: RepoGeneration,
        phase: EventPhase,
        summary: LocalizedMessage,
    ) -> EventSeq {
        self.send_event_with_details(
            repo,
            operation_id,
            generation,
            phase,
            summary,
            Default::default(),
        )
    }

    fn send_event_with_details(
        &self,
        repo: &RepoContext,
        operation_id: Option<&str>,
        generation: RepoGeneration,
        phase: EventPhase,
        summary: LocalizedMessage,
        details: std::collections::BTreeMap<String, String>,
    ) -> EventSeq {
        let sequence = repo.event_seq.fetch_add(1, Ordering::SeqCst) + 1;
        let event = WorkspaceEvent {
            repo_id: repo.id.clone(),
            event_seq: sequence,
            repo_generation: generation,
            operation_id: operation_id.map(str::to_owned),
            phase,
            summary,
            details,
        };
        if let Some(channel) = repo.channel.lock().expect("channel lock").as_ref() {
            let _ = channel.send(event.clone());
        }
        sequence
    }

    fn cancel(&self, request: CancelRequest) -> CancelOutcome {
        let running = self.running.lock().expect("running lock");
        let accepted = if let Some(control) = running.get(&request.operation_id) {
            control.cancel();
            true
        } else {
            false
        };
        CancelOutcome { accepted }
    }

    fn delete_repository(&self, path: String) -> WorkspaceResult<()> {
        let root = self.repository_root_for_deletion(&path)?;
        trash::delete(&root).map_err(|error| WorkspaceError::new(ErrorCode::Io, error.to_string()))
    }

    fn repository_root_for_deletion(&self, path: &str) -> WorkspaceResult<PathBuf> {
        let requested = PathBuf::from(path.trim());
        if path.trim().is_empty() || !requested.is_absolute() {
            return Err(WorkspaceError::new(
                ErrorCode::InvalidRequest,
                "An absolute repository path is required",
            ));
        }
        let root = canonicalize_repository_path(&requested)?;
        if root.parent().is_none() {
            return Err(WorkspaceError::new(
                ErrorCode::InvalidRequest,
                "The filesystem root cannot be deleted",
            ));
        }
        if std::env::var_os("HOME")
            .and_then(|home| PathBuf::from(home).canonicalize().ok())
            .is_some_and(|home| home == root)
        {
            return Err(WorkspaceError::new(
                ErrorCode::InvalidRequest,
                "The home directory cannot be deleted",
            ));
        }
        let git_root = command_path(&self.git, &root, GitCommand::TopLevel)?;
        if git_root != root {
            return Err(WorkspaceError::new(
                ErrorCode::InvalidRequest,
                "Only the repository root can be deleted",
            ));
        }
        if let Some(repo) = self
            .repos
            .read()
            .expect("repos read lock")
            .values()
            .find(|repo| repo.root == root)
            .cloned()
        {
            let snapshot = self.snapshot(&repo)?;
            if !matches!(snapshot.operation, OperationState::None) {
                return Err(WorkspaceError::new(
                    ErrorCode::OperationInProgress,
                    "Complete or abort the operation before deleting the repository",
                ));
            }
        }
        Ok(root)
    }

    fn detach(&self, request: DetachRequest) -> WorkspaceResult<()> {
        if request.repo_id.trim().is_empty() {
            return Err(WorkspaceError::new(
                ErrorCode::InvalidRequest,
                "repoId is required",
            ));
        }
        let repo = self.repo(&request.repo_id)?;
        match self.snapshot(&repo) {
            Ok(snapshot) if !matches!(snapshot.operation, OperationState::None) => {
                return Err(WorkspaceError::new(
                    ErrorCode::OperationInProgress,
                    "Complete or abort the operation before closing the repository",
                ));
            }
            Ok(_) => {}
            // 利用不能な場所は状態を読み直せないため、復旧入口へ移すための切断を許可する。
            Err(error) => {
                let availability = self
                    .repository_availability(repo.root.display().to_string())
                    .availability;
                if availability == RepositoryAvailability::Available {
                    return Err(error);
                }
            }
        }
        self.repos
            .write()
            .expect("repos write lock")
            .remove(&request.repo_id);
        Ok(())
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn workspace_attach(
    workspace: tauri::State<'_, Arc<Workspace>>,
    request: OpenRequest,
    on_event: Channel<WorkspaceEvent>,
) -> WorkspaceResult<WorkspaceSession> {
    let workspace = workspace.inner().clone();
    tauri::async_runtime::spawn_blocking(move || workspace.attach(request, Some(on_event)))
        .await
        .map_err(join_error)?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn workspace_query(
    workspace: tauri::State<'_, Arc<Workspace>>,
    request: QueryRequest,
) -> WorkspaceResult<QueryOutcome> {
    let workspace = workspace.inner().clone();
    let registration = workspace.prepare_query(&request)?;
    tauri::async_runtime::spawn_blocking(move || workspace.query_prepared(request, registration))
        .await
        .map_err(join_error)?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn workspace_image_bytes(
    workspace: tauri::State<'_, Arc<Workspace>>,
    request: ImageBytesRequest,
) -> WorkspaceResult<tauri::ipc::Response> {
    let workspace = workspace.inner().clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || workspace.image_bytes(request))
        .await
        .map_err(join_error)??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn workspace_preview(
    workspace: tauri::State<'_, Arc<Workspace>>,
    request: PreviewRequest,
) -> WorkspaceResult<PreviewOutcome> {
    let workspace = workspace.inner().clone();
    tauri::async_runtime::spawn_blocking(move || workspace.preview(request))
        .await
        .map_err(join_error)?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn workspace_execute(
    workspace: tauri::State<'_, Arc<Workspace>>,
    request: ExecuteRequest,
) -> WorkspaceResult<ActionOutcome> {
    let workspace = workspace.inner().clone();
    tauri::async_runtime::spawn_blocking(move || workspace.execute(request))
        .await
        .map_err(join_error)?
}

#[tauri::command(rename_all = "camelCase")]
pub fn workspace_cancel(
    workspace: tauri::State<'_, Arc<Workspace>>,
    request: CancelRequest,
) -> CancelOutcome {
    workspace.cancel(request)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn workspace_detach(
    workspace: tauri::State<'_, Arc<Workspace>>,
    request: DetachRequest,
) -> WorkspaceResult<()> {
    let workspace = workspace.inner().clone();
    tauri::async_runtime::spawn_blocking(move || workspace.detach(request))
        .await
        .map_err(join_error)?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn workspace_delete_repository(
    workspace: tauri::State<'_, Arc<Workspace>>,
    path: String,
) -> WorkspaceResult<()> {
    let workspace = workspace.inner().clone();
    tauri::async_runtime::spawn_blocking(move || workspace.delete_repository(path))
        .await
        .map_err(join_error)?
}

fn join_error(error: impl std::fmt::Display) -> WorkspaceError {
    WorkspaceError::new(ErrorCode::Internal, format!("Backend task failed: {error}"))
}

fn command_path(git: &GitExecutor, cwd: &Path, command: GitCommand) -> WorkspaceResult<PathBuf> {
    let output = git.run(Some(cwd), command, None, None)?.ensure_success()?;
    canonicalize_git_path(&output)
}

fn canonicalize_git_path(output: &GitOutput) -> WorkspaceResult<PathBuf> {
    let path = PathBuf::from(output.stdout_text().trim());
    path.canonicalize().map_err(|error| {
        WorkspaceError::new(
            ErrorCode::RepoNotFound,
            format!("Failed to resolve the Git path: {error}"),
        )
    })
}

fn canonicalize_repository_path(path: &Path) -> WorkspaceResult<PathBuf> {
    path.canonicalize().map_err(open_path_error)
}

fn open_path_error(error: std::io::Error) -> WorkspaceError {
    WorkspaceError::new(
        ErrorCode::RepoNotFound,
        format!("Failed to open the repository path: {error}"),
    )
}

fn is_not_a_git_repository(output: &GitOutput) -> bool {
    !output.success() && output.stderr_text().contains("not a git repository")
}

fn repo_id(root: &Path, git_dir: &Path) -> String {
    hash(format!("{}\0{}", root.display(), git_dir.display()).as_bytes())[..24].to_owned()
}

fn clone_temporary_repo_id(destination: &Path) -> String {
    let absolute = if destination.is_absolute() {
        destination.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_default()
            .join(destination)
    };
    format!(
        "clone-{}",
        &hash(absolute.as_os_str().as_encoded_bytes())[..24]
    )
}

fn cancelled_error() -> WorkspaceError {
    WorkspaceError::new(ErrorCode::Cancelled, "Git operation was cancelled")
}

fn hash(bytes: &[u8]) -> String {
    hex_bytes(&Sha256::digest(bytes))
}

fn worktree_entry_fingerprint(root: &Path, relative: &str) -> WorkspaceResult<Vec<u8>> {
    let path = checked_repo_path(root, relative)?;
    let mut fingerprint = Sha256::new();
    match fs::symlink_metadata(&path) {
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
                        .map_err(|error| WorkspaceError::new(ErrorCode::Io, error.to_string()))?
                        .as_os_str()
                        .as_encoded_bytes(),
                );
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fingerprint.update(b"missing\0");
        }
        Err(error) => return Err(WorkspaceError::new(ErrorCode::Io, error.to_string())),
    }
    Ok(fingerprint.finalize().to_vec())
}

fn worktree_impact_digest(
    root: &Path,
    relative: &str,
    control: Option<&RunControl>,
) -> WorkspaceResult<Vec<u8>> {
    validate_path(relative)?;
    let components = relative.split('/').collect::<Vec<_>>();
    let mut ancestor = PathBuf::new();
    for component in components.iter().take(components.len().saturating_sub(1)) {
        ancestor.push(component);
        match fs::symlink_metadata(root.join(&ancestor)) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.file_type().is_dir() => {
                let ancestor = ancestor.to_str().ok_or_else(|| {
                    WorkspaceError::new(
                        ErrorCode::UnsupportedRepository,
                        "Non-UTF-8 paths cannot be previewed",
                    )
                })?;
                let mut digest = Sha256::new();
                digest.update(b"obstructed\0");
                digest.update(ancestor.as_bytes());
                digest.update(worktree_entry_digest(root, ancestor, control)?);
                return Ok(digest.finalize().to_vec());
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => return Err(WorkspaceError::new(ErrorCode::Io, error.to_string())),
        }
    }
    worktree_entry_digest(root, relative, control)
}

fn worktree_entry_digest(
    root: &Path,
    relative: &str,
    control: Option<&RunControl>,
) -> WorkspaceResult<Vec<u8>> {
    if control.is_some_and(RunControl::is_cancelled) {
        return Err(cancelled_error());
    }
    let path = checked_repo_path(root, relative)?;
    let mut digest = Sha256::new();
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            digest.update(b"symlink\0");
            digest.update(
                fs::read_link(path)
                    .map_err(|error| WorkspaceError::new(ErrorCode::Io, error.to_string()))?
                    .as_os_str()
                    .as_encoded_bytes(),
            );
        }
        Ok(metadata) if metadata.is_file() => {
            digest.update(b"file\0");
            digest.update(metadata.len().to_le_bytes());
            let mut file = File::open(path)
                .map_err(|error| WorkspaceError::new(ErrorCode::Io, error.to_string()))?;
            let mut buffer = [0_u8; 64 * 1024];
            loop {
                if control.is_some_and(RunControl::is_cancelled) {
                    return Err(cancelled_error());
                }
                let count = file
                    .read(&mut buffer)
                    .map_err(|error| WorkspaceError::new(ErrorCode::Io, error.to_string()))?;
                if count == 0 {
                    break;
                }
                digest.update(&buffer[..count]);
            }
        }
        Ok(_) => digest.update(b"directory\0"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => digest.update(b"missing\0"),
        Err(error) => return Err(WorkspaceError::new(ErrorCode::Io, error.to_string())),
    }
    Ok(digest.finalize().to_vec())
}

fn checked_repo_path(root: &Path, relative: &str) -> WorkspaceResult<PathBuf> {
    validate_path(relative)?;
    let root = root
        .canonicalize()
        .map_err(|error| WorkspaceError::new(ErrorCode::Io, error.to_string()))?;
    let components: Vec<_> = Path::new(relative).components().collect();
    let mut cursor = root.clone();
    for (index, component) in components.iter().enumerate() {
        let std::path::Component::Normal(component) = component else {
            return Err(WorkspaceError::new(
                ErrorCode::InvalidRequest,
                "Invalid repository-relative path",
            ));
        };
        cursor.push(component);
        match fs::symlink_metadata(&cursor) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                if index + 1 != components.len() {
                    return Err(WorkspaceError::new(
                        ErrorCode::InvalidRequest,
                        "Paths below a symlink that points outside the repository cannot be modified",
                    ));
                }
            }
            Ok(metadata) if index + 1 != components.len() && !metadata.is_dir() => {
                return Err(WorkspaceError::new(
                    ErrorCode::InvalidRequest,
                    "Invalid repository-relative path",
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => return Err(WorkspaceError::new(ErrorCode::Io, error.to_string())),
        }
    }
    if cursor.exists()
        && !cursor
            .symlink_metadata()
            .is_ok_and(|metadata| metadata.file_type().is_symlink())
    {
        let canonical = cursor
            .canonicalize()
            .map_err(|error| WorkspaceError::new(ErrorCode::Io, error.to_string()))?;
        if !canonical.starts_with(&root) {
            return Err(WorkspaceError::new(
                ErrorCode::InvalidRequest,
                "Paths outside the repository cannot be modified",
            ));
        }
    }
    Ok(root.join(relative))
}

fn hex_bytes(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn untracked_placeholder(path: &str, mode: &str, message: &str) -> Vec<u8> {
    let left = quote_patch_path("a", path);
    let right = quote_patch_path("b", path);
    let message = message.replace("{path}", &right);
    format!("diff --git {left} {right}\nnew file mode {mode}\n{message}\n").into_bytes()
}

fn quote_patch_path(prefix: &str, path: &str) -> String {
    quote_patch_value(&format!("{prefix}/{path}"))
}

fn quote_patch_value(value: &str) -> String {
    if value
        .bytes()
        .all(|byte| byte.is_ascii_graphic() && byte != b'"' && byte != b'\\')
    {
        return value.to_owned();
    }
    let mut quoted = String::from("\"");
    for byte in value.bytes() {
        match byte {
            b'\\' => quoted.push_str("\\\\"),
            b'"' => quoted.push_str("\\\""),
            b'\n' => quoted.push_str("\\n"),
            b'\r' => quoted.push_str("\\r"),
            b'\t' => quoted.push_str("\\t"),
            0x20..=0x7e => quoted.push(char::from(byte)),
            _ => quoted.push_str(&format!("\\{byte:03o}")),
        }
    }
    quoted.push('"');
    quoted
}

fn ensure_image_target_in_patch(
    patch: &[u8],
    path: &str,
    previous_path: Option<&str>,
) -> WorkspaceResult<()> {
    let previous_or_current = previous_path.unwrap_or(path);
    let left = [
        quote_patch_path("a", previous_or_current),
        format!("a/{previous_or_current}"),
    ];
    let right = [quote_patch_path("b", path), format!("b/{path}")];
    let svg = path.to_ascii_lowercase().ends_with(".svg")
        || previous_path.is_some_and(|value| value.to_ascii_lowercase().ends_with(".svg"));
    let mut in_target = false;
    let mut binary = false;
    let mut pure_rename = false;
    let mut rename_from = false;
    let mut rename_to = false;

    let target_matches = |binary, pure_rename, rename_from, rename_to| {
        let rename_matches = previous_path.is_none() || (rename_from && rename_to);
        rename_matches && (binary || svg || (previous_path.is_some() && pure_rename))
    };

    for line in String::from_utf8_lossy(patch).lines() {
        if line.starts_with("diff --git ") {
            if in_target && target_matches(binary, pure_rename, rename_from, rename_to) {
                return Ok(());
            }
            in_target = left.iter().any(|left| {
                right
                    .iter()
                    .any(|right| line == format!("diff --git {left} {right}"))
            });
            binary = false;
            pure_rename = false;
            rename_from = false;
            rename_to = false;
            continue;
        }
        if !in_target {
            continue;
        }
        binary |= line == "GIT binary patch"
            || (line.starts_with("Binary files ") && line.ends_with(" differ"));
        pure_rename |= line == "similarity index 100%";
        rename_from |= previous_path.is_some_and(|value| {
            line == format!("rename from {}", quote_patch_value(value))
                || line == format!("rename from {value}")
        });
        rename_to |= previous_path.is_some_and(|_| {
            line == format!("rename to {}", quote_patch_value(path))
                || line == format!("rename to {path}")
        });
    }

    if in_target && target_matches(binary, pure_rename, rename_from, rename_to) {
        Ok(())
    } else {
        Err(image_target_mismatch_error())
    }
}

fn snapshot_head_oid(snapshot: &RepoSnapshot) -> Option<String> {
    match &snapshot.head {
        HeadState::Branch { oid, .. } => oid.clone(),
        HeadState::Detached { oid } => Some(oid.clone()),
        HeadState::Unborn { .. } => None,
    }
}

fn parse_nul_paths(bytes: &[u8]) -> WorkspaceResult<Vec<String>> {
    bytes
        .split(|byte| *byte == 0)
        .filter(|path| !path.is_empty())
        .map(|path| {
            std::str::from_utf8(path).map(str::to_owned).map_err(|_| {
                WorkspaceError::new(
                    ErrorCode::UnsupportedRepository,
                    "Non-UTF-8 paths cannot be previewed",
                )
            })
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedIndexEntry {
    mode: String,
    oid: String,
    stage: u8,
    path: String,
}

fn parse_index_entries(bytes: &[u8]) -> WorkspaceResult<Vec<ParsedIndexEntry>> {
    bytes
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
        .map(|record| {
            let record = std::str::from_utf8(record).map_err(|_| {
                WorkspaceError::new(
                    ErrorCode::UnsupportedRepository,
                    "Non-UTF-8 paths cannot be previewed",
                )
            })?;
            let (metadata, path) = record.split_once('\t').ok_or_else(|| {
                WorkspaceError::new(
                    ErrorCode::UnsupportedRepository,
                    "Failed to parse the index entry safely",
                )
            })?;
            let mut fields = metadata.split_whitespace();
            let mode = fields.next().ok_or_else(|| {
                WorkspaceError::new(
                    ErrorCode::UnsupportedRepository,
                    "Failed to parse the index mode safely",
                )
            })?;
            let oid = fields.next().ok_or_else(|| {
                WorkspaceError::new(
                    ErrorCode::UnsupportedRepository,
                    "Failed to parse the index OID safely",
                )
            })?;
            let stage = fields
                .next()
                .and_then(|value| value.parse::<u8>().ok())
                .filter(|stage| *stage <= 3)
                .ok_or_else(|| {
                    WorkspaceError::new(
                        ErrorCode::UnsupportedRepository,
                        "Failed to parse the index stage safely",
                    )
                })?;
            if fields.next().is_some() || path.is_empty() {
                return Err(WorkspaceError::new(
                    ErrorCode::UnsupportedRepository,
                    "Failed to parse the index entry safely",
                ));
            }
            Ok(ParsedIndexEntry {
                mode: mode.to_owned(),
                oid: oid.to_owned(),
                stage,
                path: path.to_owned(),
            })
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedTreeEntry {
    mode: String,
    kind: String,
    oid: String,
    path: String,
}

fn parse_tree_entries(bytes: &[u8]) -> WorkspaceResult<Vec<ParsedTreeEntry>> {
    bytes
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
        .map(|record| {
            let record = std::str::from_utf8(record).map_err(|_| {
                WorkspaceError::new(
                    ErrorCode::UnsupportedRepository,
                    "Non-UTF-8 paths cannot be previewed",
                )
            })?;
            let (metadata, path) = record.split_once('\t').ok_or_else(|| {
                WorkspaceError::new(
                    ErrorCode::UnsupportedRepository,
                    "Failed to parse the tree entry safely",
                )
            })?;
            let mut fields = metadata.split_whitespace();
            let mode = fields.next().ok_or_else(|| {
                WorkspaceError::new(
                    ErrorCode::UnsupportedRepository,
                    "Failed to parse the tree mode safely",
                )
            })?;
            let kind = fields.next().ok_or_else(|| {
                WorkspaceError::new(
                    ErrorCode::UnsupportedRepository,
                    "Failed to parse the tree object type safely",
                )
            })?;
            let oid = fields.next().ok_or_else(|| {
                WorkspaceError::new(
                    ErrorCode::UnsupportedRepository,
                    "Failed to parse the tree OID safely",
                )
            })?;
            if fields.next().is_some() || path.is_empty() {
                return Err(WorkspaceError::new(
                    ErrorCode::UnsupportedRepository,
                    "Failed to parse the tree entry safely",
                ));
            }
            Ok(ParsedTreeEntry {
                mode: mode.to_owned(),
                kind: kind.to_owned(),
                oid: oid.to_owned(),
                path: path.to_owned(),
            })
        })
        .collect()
}

fn paths_overlap_components(left: &str, right: &str) -> bool {
    left == right
        || left
            .strip_prefix(right)
            .is_some_and(|suffix| suffix.starts_with('/'))
        || right
            .strip_prefix(left)
            .is_some_and(|suffix| suffix.starts_with('/'))
}

fn path_ancestors(path: &str) -> Vec<String> {
    let components = path.split('/').collect::<Vec<_>>();
    (1..components.len())
        .map(|length| components[..length].join("/"))
        .collect()
}

struct WorktreeLeaf {
    path: String,
    file_type: std::fs::FileType,
}

fn worktree_directory_leaves(
    repo_root: &Path,
    relative_root: &Path,
    control: Option<&RunControl>,
) -> WorkspaceResult<Vec<WorktreeLeaf>> {
    let mut pending = vec![relative_root.to_path_buf()];
    let mut leaves = Vec::new();
    while let Some(directory) = pending.pop() {
        if control.is_some_and(RunControl::is_cancelled) {
            return Err(cancelled_error());
        }
        let entries = fs::read_dir(repo_root.join(&directory))
            .map_err(|error| WorkspaceError::new(ErrorCode::Io, error.to_string()))?;
        for entry in entries {
            if control.is_some_and(RunControl::is_cancelled) {
                return Err(cancelled_error());
            }
            let entry =
                entry.map_err(|error| WorkspaceError::new(ErrorCode::Io, error.to_string()))?;
            let mut relative = directory.clone();
            relative.push(entry.file_name());
            let path = relative.to_str().ok_or_else(|| {
                WorkspaceError::new(
                    ErrorCode::UnsupportedRepository,
                    "Non-UTF-8 paths cannot be previewed",
                )
            })?;
            validate_path(path)?;
            let metadata = fs::symlink_metadata(repo_root.join(&relative))
                .map_err(|error| WorkspaceError::new(ErrorCode::Io, error.to_string()))?;
            if metadata.file_type().is_dir() {
                pending.push(relative);
            } else {
                leaves.push(WorktreeLeaf {
                    path: path.to_owned(),
                    file_type: metadata.file_type(),
                });
            }
        }
    }
    Ok(leaves)
}

#[allow(clippy::too_many_arguments)]
fn bind_directory_contents(
    repo_root: &Path,
    relative_root: &Path,
    target_path: &str,
    target_mode: &str,
    tracked_modes: &BTreeMap<String, BTreeSet<String>>,
    visible_untracked: &BTreeSet<String>,
    affected_paths: &mut Vec<String>,
    control: Option<&RunControl>,
) -> WorkspaceResult<()> {
    let relative_root = relative_root.to_str().ok_or_else(|| {
        WorkspaceError::new(
            ErrorCode::UnsupportedRepository,
            "Non-UTF-8 paths cannot be previewed",
        )
    })?;
    for path in tracked_modes.keys().filter(|path| {
        path.strip_prefix(relative_root)
            .is_some_and(|suffix| suffix.starts_with('/'))
    }) {
        affected_paths.push(path.clone());
    }
    for leaf in worktree_directory_leaves(repo_root, Path::new(relative_root), control)? {
        if let Some(modes) = tracked_modes.get(&leaf.path) {
            if !worktree_file_type_matches_index(&leaf.file_type, modes) {
                return Err(worktree_write_obstruction(
                    target_path,
                    &leaf.path,
                    target_mode,
                ));
            }
            affected_paths.push(leaf.path);
        } else if visible_untracked.contains(&leaf.path)
            && (leaf.file_type.is_file() || leaf.file_type.is_symlink())
        {
            affected_paths.push(leaf.path);
        } else {
            return Err(worktree_write_obstruction(
                target_path,
                &leaf.path,
                target_mode,
            ));
        }
    }
    Ok(())
}

fn worktree_type_matches_index(metadata: &fs::Metadata, modes: &BTreeSet<String>) -> bool {
    worktree_file_type_matches_index(&metadata.file_type(), modes)
}

fn worktree_file_type_matches_index(
    file_type: &std::fs::FileType,
    modes: &BTreeSet<String>,
) -> bool {
    modes.iter().any(|mode| match mode.as_str() {
        "120000" => file_type.is_symlink(),
        "160000" => false,
        value if value.starts_with("100") => file_type.is_file(),
        _ => false,
    })
}

fn worktree_write_obstruction(
    target: &str,
    obstruction: &str,
    target_mode: &str,
) -> WorkspaceError {
    WorkspaceError::new(
        ErrorCode::InvalidRequest,
        "An untracked or unlisted path would block Git from writing files",
    )
    .detail("targetPath", target)
    .detail("obstructionPath", obstruction)
    .detail("targetMode", target_mode)
}

fn parse_status(bytes: &[u8]) -> WorkspaceResult<RepoSnapshot> {
    let records: Vec<&[u8]> = bytes.split(|byte| *byte == 0).collect();
    let mut oid = None;
    let mut branch = None;
    let mut upstream = None;
    let mut ahead = 0;
    let mut behind = 0;
    let mut entries = Vec::new();
    let mut index = 0;
    while index < records.len() {
        let mut record = std::str::from_utf8(records[index]).map_err(|_| {
            WorkspaceError::new(
                ErrorCode::UnsupportedRepository,
                "Non-UTF-8 paths are not supported",
            )
        })?;
        while record.starts_with("# ") {
            let (line, remaining) = record
                .split_once('\n')
                .map_or((record, ""), |(line, remaining)| (line, remaining));
            if let Some(value) = line.strip_prefix("# branch.oid ") {
                if value != "(initial)" {
                    oid = Some(value.to_owned());
                }
            } else if let Some(value) = line.strip_prefix("# branch.head ") {
                branch = Some(value.to_owned());
            } else if let Some(value) = line.strip_prefix("# branch.upstream ") {
                upstream = Some(value.to_owned());
            } else if let Some(value) = line.strip_prefix("# branch.ab ") {
                let mut fields = value.split_whitespace();
                ahead = fields
                    .next()
                    .and_then(|value| value.strip_prefix('+'))
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(0);
                behind = fields
                    .next()
                    .and_then(|value| value.strip_prefix('-'))
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(0);
            }
            record = remaining;
        }
        if record.starts_with("1 ") {
            if let Some(entry) = parse_ordinary_status(record) {
                entries.push(entry);
            }
        } else if record.starts_with("2 ") {
            let original = records
                .get(index + 1)
                .map(|value| std::str::from_utf8(value))
                .transpose()
                .map_err(|_| {
                    WorkspaceError::new(
                        ErrorCode::UnsupportedRepository,
                        "Non-UTF-8 paths are not supported",
                    )
                })?
                .map(str::to_owned);
            if let Some(entry) = parse_rename_status(record, original) {
                entries.push(entry);
                index += 1;
            }
        } else if record.starts_with("u ") {
            if let Some(entry) = parse_unmerged_status(record) {
                entries.push(entry);
            }
        } else if let Some(path) = record.strip_prefix("? ") {
            entries.push(StatusEntry {
                path: path.to_owned(),
                original_path: None,
                index_status: "?".into(),
                worktree_status: "?".into(),
                conflict: false,
                untracked: true,
                submodule: "N...".into(),
            });
        }
        index += 1;
    }

    let head = match (branch.as_deref(), oid) {
        (Some("(detached)"), Some(oid)) => HeadState::Detached { oid },
        (Some(name), Some(oid)) => HeadState::Branch {
            name: name.to_owned(),
            oid: Some(oid),
        },
        (Some(name), None) => HeadState::Unborn {
            name: name.to_owned(),
        },
        (_, Some(oid)) => HeadState::Detached { oid },
        _ => HeadState::Unborn {
            name: "main".into(),
        },
    };
    Ok(RepoSnapshot {
        repo_id: String::new(),
        root: String::new(),
        head,
        upstream,
        ahead,
        behind,
        additions: None,
        deletions: None,
        entries,
        operation: OperationState::None,
        git_flow_operation: None,
        repo_generation: 0,
        event_seq: 0,
    })
}

fn parse_ordinary_status(line: &str) -> Option<StatusEntry> {
    let fields: Vec<&str> = line.splitn(9, ' ').collect();
    if fields.len() != 9 {
        return None;
    }
    Some(status_entry(fields[8], None, fields[1], fields[2], false))
}

fn parse_rename_status(line: &str, original_path: Option<String>) -> Option<StatusEntry> {
    let fields: Vec<&str> = line.splitn(10, ' ').collect();
    if fields.len() != 10 {
        return None;
    }
    Some(status_entry(
        fields[9],
        original_path,
        fields[1],
        fields[2],
        false,
    ))
}

fn parse_unmerged_status(line: &str) -> Option<StatusEntry> {
    let fields: Vec<&str> = line.splitn(11, ' ').collect();
    if fields.len() != 11 {
        return None;
    }
    Some(status_entry(fields[10], None, fields[1], fields[2], true))
}

fn status_entry(
    path: &str,
    original_path: Option<String>,
    xy: &str,
    submodule: &str,
    conflict: bool,
) -> StatusEntry {
    let mut chars = xy.chars();
    StatusEntry {
        path: path.to_owned(),
        original_path,
        index_status: chars.next().unwrap_or('.').to_string(),
        worktree_status: chars.next().unwrap_or('.').to_string(),
        conflict,
        untracked: false,
        submodule: submodule.to_owned(),
    }
}

#[derive(Clone, Copy, Default)]
struct Numstat {
    additions: u64,
    deletions: u64,
}

fn parse_numstat(bytes: &[u8]) -> WorkspaceResult<Numstat> {
    let mut stats = Numstat::default();
    for record in bytes
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
    {
        let record = std::str::from_utf8(record).map_err(|_| {
            WorkspaceError::new(
                ErrorCode::UnsupportedRepository,
                "Non-UTF-8 paths are not supported",
            )
        })?;
        let mut fields = record.splitn(3, '\t');
        let additions = fields.next().and_then(|value| value.parse::<u64>().ok());
        let deletions = fields.next().and_then(|value| value.parse::<u64>().ok());
        let path = fields.next();
        let (Some(additions), Some(deletions), Some(_path)) = (additions, deletions, path) else {
            continue;
        };
        stats.additions += additions;
        stats.deletions += deletions;
    }
    Ok(stats)
}

fn parse_history(text: &str) -> Vec<CommitSummary> {
    text.split('\u{1e}')
        .filter_map(|record| {
            let fields: Vec<&str> = record.trim_matches(['\r', '\n']).split('\u{1f}').collect();
            if fields.len() != 6 || fields[0].is_empty() {
                return None;
            }
            Some(CommitSummary {
                oid: fields[0].to_owned(),
                parents: fields[1].split_whitespace().map(str::to_owned).collect(),
                refs: fields[2]
                    .split(',')
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_owned)
                    .collect(),
                author: fields[3].to_owned(),
                authored_at: fields[4].to_owned(),
                subject: fields[5].to_owned(),
            })
        })
        .collect()
}

fn history_commit_matches_search(commit: &CommitSummary, search: &str) -> bool {
    [&commit.oid, &commit.author, &commit.subject]
        .into_iter()
        .chain(commit.refs.iter())
        .any(|value| value.to_lowercase().contains(search))
}

fn validate_commit_activity_boundaries(boundaries: &[i64]) -> WorkspaceResult<()> {
    if boundaries.len() < 2 || boundaries.len() > MAX_COMMIT_ACTIVITY_BUCKETS + 1 {
        return Err(WorkspaceError::new(
            ErrorCode::InvalidRequest,
            format!(
                "Commit activity requires between 1 and {MAX_COMMIT_ACTIVITY_BUCKETS} daily buckets"
            ),
        ));
    }
    if boundaries.windows(2).any(|pair| pair[0] >= pair[1]) {
        return Err(WorkspaceError::new(
            ErrorCode::InvalidRequest,
            "Commit activity bucket boundaries must be strictly increasing",
        ));
    }
    Ok(())
}

fn aggregate_commit_activity(
    text: &str,
    boundaries: &[i64],
    scan_limit: u32,
) -> WorkspaceResult<CommitActivityResult> {
    let mut buckets = boundaries
        .windows(2)
        .map(|pair| CommitActivityBucket {
            start_unix_seconds: pair[0],
            end_unix_seconds: pair[1],
            commit_count: 0,
            contributor_count: 0,
            branch_count: 0,
        })
        .collect::<Vec<_>>();
    let mut contributors = BTreeSet::new();
    let mut bucket_contributors = vec![BTreeSet::new(); buckets.len()];
    let mut relevant_records = 0_u64;

    for record in text.split('\u{1e}') {
        let record = record.trim_matches(['\r', '\n']);
        if record.is_empty() {
            continue;
        }
        let fields = record.split('\u{1f}').collect::<Vec<_>>();
        if fields.len() != 3 {
            return Err(WorkspaceError::new(
                ErrorCode::GitFailed,
                "Failed to parse commit activity metadata",
            ));
        }
        let committed_at = fields[0].parse::<i64>().map_err(|_| {
            WorkspaceError::new(
                ErrorCode::GitFailed,
                "Failed to parse a commit activity timestamp",
            )
        })?;
        let Some(bucket_index) = bucket_index(boundaries, committed_at) else {
            continue;
        };
        relevant_records += 1;
        if relevant_records > u64::from(scan_limit) {
            continue;
        }
        buckets[bucket_index].commit_count += 1;
        if let Some(contributor) = normalized_contributor(fields[1], fields[2]) {
            bucket_contributors[bucket_index].insert(contributor.clone());
            contributors.insert(contributor);
        }
    }

    for (bucket, bucket_contributors) in buckets.iter_mut().zip(bucket_contributors) {
        bucket.contributor_count = bucket_contributors.len() as u64;
    }

    let commits = relevant_records.min(u64::from(scan_limit));
    let active_days = buckets
        .iter()
        .filter(|bucket| bucket.commit_count > 0)
        .count() as u64;
    let coverage = if relevant_records > u64::from(scan_limit) {
        CommitActivityCoverage::Truncated { scan_limit }
    } else {
        CommitActivityCoverage::Complete
    };
    Ok(CommitActivityResult {
        repo_generation: 0,
        history_revision: String::new(),
        time_basis: CommitActivityTimeBasis::Committed,
        totals: CommitActivityTotals {
            commits,
            active_days,
            contributors: contributors.len() as u64,
            branches: 0,
        },
        buckets,
        coverage,
    })
}

fn bucket_index(boundaries: &[i64], timestamp: i64) -> Option<usize> {
    let index = boundaries.partition_point(|boundary| *boundary <= timestamp);
    if index == 0 || index == boundaries.len() {
        return None;
    }
    Some(index - 1)
}

fn normalized_contributor(email: &str, name: &str) -> Option<String> {
    let email = email.trim();
    let identity = if email.is_empty() { name.trim() } else { email };
    (!identity.is_empty()).then(|| identity.to_lowercase())
}

fn commit_activity_cache_get(
    cache: &mut VecDeque<CommitActivityCacheEntry>,
    key: &CommitActivityCacheKey,
) -> Option<CommitActivityResult> {
    let position = cache.iter().position(|entry| &entry.key == key)?;
    let entry = cache.remove(position)?;
    let result = entry.result.clone();
    cache.push_back(entry);
    Some(result)
}

fn commit_activity_cache_insert(
    cache: &mut VecDeque<CommitActivityCacheEntry>,
    entry: CommitActivityCacheEntry,
) {
    if let Some(position) = cache
        .iter()
        .position(|candidate| candidate.key == entry.key)
    {
        cache.remove(position);
    }
    cache.push_back(entry);
    while cache.len() > MAX_COMMIT_ACTIVITY_CACHE_ENTRIES {
        cache.pop_front();
    }
}

fn parse_branches(bytes: &[u8]) -> Vec<BranchSummary> {
    String::from_utf8_lossy(bytes)
        .lines()
        .filter_map(|line| {
            let fields: Vec<&str> = line.split('\0').collect();
            if fields.len() != 6 {
                return None;
            }
            Some(BranchSummary {
                full_name: fields[0].to_owned(),
                short_name: fields[1].to_owned(),
                oid: fields[2].to_owned(),
                current: fields[3] == "*",
                remote: fields[0].starts_with("refs/remotes/"),
                upstream: (!fields[4].is_empty()).then(|| fields[4].to_owned()),
            })
        })
        .collect()
}

fn read_marker(path: &Path) -> WorkspaceResult<Option<String>> {
    match fs::read_to_string(path) {
        Ok(value) => Ok(Some(value.trim().to_owned())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(WorkspaceError::new(ErrorCode::Io, error.to_string())),
    }
}

fn validate_action(action: &Action) -> WorkspaceResult<()> {
    validate_paths(&action_paths(action))?;
    match action {
        Action::Stage {
            selection: Some(selection),
            ..
        }
        | Action::Unstage {
            selection: Some(selection),
            ..
        }
        | Action::Discard {
            selection: Some(selection),
            ..
        } => {
            validate_path(selection.path())?;
            let invalid = selection.diff_revision().is_empty()
                || matches!(
                    selection,
                    PatchSelection::Lines {
                        start_line,
                        end_line,
                        ..
                    } if *start_line == 0 || end_line < start_line
                );
            if invalid {
                return Err(WorkspaceError::new(
                    ErrorCode::InvalidRequest,
                    "Invalid partial selection",
                ));
            }
        }
        _ => {}
    }
    if matches!(
        action,
        Action::Discard {
            target: DiscardTarget::Untracked,
            selection: Some(_),
            ..
        }
    ) {
        return Err(WorkspaceError::new(
            ErrorCode::InvalidRequest,
            "Untracked files cannot be discarded by line",
        ));
    }
    match action {
        Action::SaveFile {
            expected_content_hash,
            ..
        } if expected_content_hash.is_empty() => {
            return Err(WorkspaceError::new(
                ErrorCode::InvalidRequest,
                "The expected content hash is required",
            ));
        }
        Action::RenameFile { path, new_path } => {
            if path == new_path || Path::new(path).parent() != Path::new(new_path).parent() {
                return Err(WorkspaceError::new(
                    ErrorCode::InvalidRequest,
                    "A file rename must change only the file name",
                ));
            }
        }
        Action::Fetch { remote } | Action::Pull { remote, .. } | Action::Push { remote, .. } => {
            validate_remote(remote)?
        }
        Action::SetRemoteUrl {
            remote,
            expected_url,
            new_url,
            ..
        } => {
            validate_remote(remote)?;
            validate_remote_url(expected_url)?;
            validate_remote_url(new_url)?;
            if expected_url == new_url {
                return Err(WorkspaceError::new(
                    ErrorCode::InvalidRequest,
                    "The new remote URL must be different",
                ));
            }
        }
        Action::AddRemote { remote, url } => {
            validate_remote(remote)?;
            validate_remote_url(url)?;
        }
        _ => {}
    }
    match action {
        Action::Pull { remote_branch, .. } => validate_branch_name(remote_branch)?,
        Action::Push {
            local_branch,
            remote_branch,
            ..
        } => {
            validate_branch_name(local_branch)?;
            validate_branch_name(remote_branch)?;
        }
        Action::CreateBranch {
            name, start_point, ..
        } => {
            validate_branch_name(name)?;
            validate_revision(start_point)?;
        }
        Action::DeleteBranch { name } => validate_branch_name(name)?,
        Action::CreateTag { name, target } => {
            validate_tag_name(name)?;
            validate_revision(target)?;
        }
        Action::GitFlow { request } => git_flow::validate(request)?,
        Action::Checkout { branch } => validate_branch_name(branch)?,
        Action::Merge { source, .. } => validate_revision(source)?,
        Action::Rebase { onto } => validate_revision(onto)?,
        Action::CherryPick { commit, .. }
        | Action::Revert { commit, .. }
        | Action::Reset { commit, .. } => validate_revision(commit)?,
        _ => {}
    }
    if matches!(
        action,
        Action::CherryPick {
            mainline: Some(0),
            ..
        } | Action::Revert {
            mainline: Some(0),
            ..
        }
    ) {
        return Err(WorkspaceError::new(
            ErrorCode::InvalidRequest,
            "The mainline parent must be at least 1",
        ));
    }
    Ok(())
}

fn validate_action_targets(snapshot: &RepoSnapshot, action: &Action) -> WorkspaceResult<()> {
    if let Action::DeleteBranch { name } = action {
        if matches!(
            &snapshot.head,
            HeadState::Branch { name: current, .. } | HeadState::Unborn { name: current }
                if current == name
        ) {
            return Err(WorkspaceError::new(
                ErrorCode::InvalidRequest,
                "The current branch cannot be deleted",
            ));
        }
        return Ok(());
    }
    if let Action::SaveFile { path, .. } = action {
        let entry = snapshot
            .entries
            .iter()
            .find(|entry| entry.path == *path)
            .ok_or_else(|| {
                WorkspaceError::new(
                    ErrorCode::InvalidRequest,
                    "Only working tree files can be edited",
                )
                .localized_message(LocalizedMessage::new("fileEditUnavailable"))
                .detail("path", path.clone())
            })?;
        if entry.conflict || entry.submodule != "N..." {
            return Err(WorkspaceError::new(
                ErrorCode::InvalidRequest,
                "The selected entry cannot be edited",
            )
            .localized_message(LocalizedMessage::new("fileEditUnsupported"))
            .detail("path", path.clone()));
        }
        return Ok(());
    }
    if let Action::RenameFile { path, .. } = action {
        let entry = snapshot
            .entries
            .iter()
            .find(|entry| entry.path == *path)
            .ok_or_else(|| {
                WorkspaceError::new(
                    ErrorCode::InvalidRequest,
                    "Only working tree files can be renamed",
                )
                .detail("path", path.clone())
            })?;
        if entry.conflict || entry.submodule != "N..." {
            return Err(WorkspaceError::new(
                ErrorCode::InvalidRequest,
                "The selected entry cannot be renamed",
            )
            .detail("path", path.clone()));
        }
        return Ok(());
    }
    if let Action::FileAction { paths, operation } = action {
        if paths.is_empty() {
            return Err(WorkspaceError::new(
                ErrorCode::InvalidRequest,
                "At least one file action target is required",
            ));
        }
        if *operation != FileOperation::MoveToTrash && paths.len() != 1 {
            return Err(WorkspaceError::new(
                ErrorCode::InvalidRequest,
                "This file action requires exactly one target",
            ));
        }
        for path in paths {
            let entry = snapshot
                .entries
                .iter()
                .find(|entry| entry.path == *path)
                .ok_or_else(|| {
                    WorkspaceError::new(
                        ErrorCode::InvalidRequest,
                        format!("The current snapshot has no file action target: {path}"),
                    )
                })?;
            if entry.conflict && *operation != FileOperation::RevealInFinder {
                return Err(WorkspaceError::new(
                    ErrorCode::InvalidRequest,
                    "Conflicted files must be opened or deleted through the conflict workflow",
                ));
            }
        }
        return Ok(());
    }
    let (paths, selection, predicate): ActionTargets<'_> = match action {
        Action::Stage { paths, selection } => (paths, selection.as_ref(), |entry| {
            entry.untracked || entry.conflict || entry.worktree_status != "."
        }),
        Action::Unstage { paths, selection } => (paths, selection.as_ref(), |entry| {
            entry.conflict || entry.index_status != "."
        }),
        Action::Discard {
            paths,
            target: DiscardTarget::Unstaged,
            selection,
        } => (paths, selection.as_ref(), |entry| {
            !entry.untracked && entry.worktree_status != "."
        }),
        Action::Discard {
            paths,
            target: DiscardTarget::Untracked,
            selection,
        } => (paths, selection.as_ref(), |entry| entry.untracked),
        _ => return Ok(()),
    };
    if selection.is_some() && !paths.is_empty() {
        return Err(WorkspaceError::new(
            ErrorCode::InvalidRequest,
            "Partial selection and paths cannot be specified together",
        ));
    }
    let targets: Vec<&str> = selection.map_or_else(
        || paths.iter().map(String::as_str).collect(),
        |selection| vec![selection.path()],
    );
    if targets.is_empty() {
        return Err(WorkspaceError::new(
            ErrorCode::InvalidRequest,
            "At least one target path is required",
        ));
    }
    for path in targets {
        if !snapshot
            .entries
            .iter()
            .any(|entry| entry.path == path && predicate(entry))
        {
            return Err(WorkspaceError::new(
                ErrorCode::InvalidRequest,
                format!("The current snapshot has no actionable path: {path}"),
            ));
        }
    }
    Ok(())
}

fn validate_paths(paths: &[String]) -> WorkspaceResult<()> {
    for path in paths {
        validate_path(path)?;
    }
    Ok(())
}

fn parse_commit_diff_files(bytes: &[u8]) -> WorkspaceResult<Vec<CommitDiffFile>> {
    let fields = bytes.split(|byte| *byte == 0).collect::<Vec<_>>();
    if !fields.last().is_some_and(|field| field.is_empty()) {
        return Err(WorkspaceError::new(
            ErrorCode::GitFailed,
            "Failed to parse changed files for commit",
        ));
    }
    let mut files = Vec::new();
    let mut index = 0;
    while index + 1 < fields.len() {
        let status = std::str::from_utf8(fields[index]).map_err(|_| {
            WorkspaceError::new(ErrorCode::GitFailed, "Changed file status is not UTF-8")
        })?;
        index += 1;
        let path = |value: &[u8]| -> WorkspaceResult<String> {
            let path = std::str::from_utf8(value)
                .map_err(|_| {
                    WorkspaceError::new(ErrorCode::GitFailed, "Changed file path is not UTF-8")
                })?
                .to_owned();
            validate_path(&path).map_err(|_| {
                WorkspaceError::new(ErrorCode::GitFailed, "Changed file path is invalid")
            })?;
            Ok(path)
        };
        let (status, previous_path, path) = match status {
            "A" => (CommitDiffFileStatus::Added, None, path(fields[index])?),
            "M" | "T" => (CommitDiffFileStatus::Modified, None, path(fields[index])?),
            "D" => (CommitDiffFileStatus::Deleted, None, path(fields[index])?),
            value
                if value.starts_with('R')
                    && !value[1..].is_empty()
                    && value[1..]
                        .parse::<u8>()
                        .is_ok_and(|score| (1..=100).contains(&score)) =>
            {
                if index + 2 >= fields.len() {
                    return Err(WorkspaceError::new(
                        ErrorCode::GitFailed,
                        "Changed file rename is incomplete",
                    ));
                }
                let previous_path = path(fields[index])?;
                index += 1;
                (
                    CommitDiffFileStatus::Renamed,
                    Some(previous_path),
                    path(fields[index])?,
                )
            }
            _ => {
                return Err(WorkspaceError::new(
                    ErrorCode::GitFailed,
                    "Changed file status is unsupported",
                ));
            }
        };
        index += 1;
        files.push(CommitDiffFile {
            path,
            previous_path,
            status,
        });
    }
    Ok(files)
}

fn validate_path(path: &str) -> WorkspaceResult<()> {
    let value = Path::new(path);
    if path.is_empty()
        || value.is_absolute()
        || value
            .components()
            .any(|part| !matches!(part, std::path::Component::Normal(_)))
        || path
            .split('/')
            .any(|component| component.is_empty() || matches!(component, "." | ".."))
        || path.contains('\0')
    {
        return Err(WorkspaceError::new(
            ErrorCode::InvalidRequest,
            "Invalid repository-relative path",
        )
        .detail("path", path));
    }
    Ok(())
}

fn validate_remote(remote: &str) -> WorkspaceResult<()> {
    if remote.is_empty()
        || remote.starts_with('-')
        || remote
            .chars()
            .any(|ch| ch.is_control() || ch.is_whitespace())
    {
        return Err(WorkspaceError::new(
            ErrorCode::InvalidRequest,
            "Invalid remote name or URL",
        ));
    }
    Ok(())
}

fn validate_remote_url(url: &str) -> WorkspaceResult<()> {
    if url.trim().is_empty()
        || url.starts_with('-')
        || url.chars().any(|ch| ch == '\0' || ch.is_control())
    {
        return Err(WorkspaceError::new(
            ErrorCode::InvalidRequest,
            "Invalid remote URL",
        ));
    }
    Ok(())
}

fn validate_revision(revision: &str) -> WorkspaceResult<()> {
    if revision.is_empty() || revision.starts_with('-') || revision.chars().any(char::is_control) {
        return Err(WorkspaceError::new(
            ErrorCode::InvalidRequest,
            "Invalid revision",
        ));
    }
    Ok(())
}

fn validate_branch_name(name: &str) -> WorkspaceResult<()> {
    let forbidden = [' ', '~', '^', ':', '?', '*', '[', '\\'];
    if name.is_empty()
        || name.starts_with(['-', '/', '.'])
        || name.ends_with(['/', '.'])
        || name.ends_with(".lock")
        || name.contains("..")
        || name.contains("//")
        || name.contains("@{")
        || name
            .chars()
            .any(|ch| ch.is_control() || forbidden.contains(&ch))
    {
        return Err(WorkspaceError::new(
            ErrorCode::InvalidRequest,
            "Invalid branch name",
        ));
    }
    Ok(())
}

fn validate_tag_name(name: &str) -> WorkspaceResult<()> {
    let forbidden = [' ', '~', '^', ':', '?', '*', '[', '\\'];
    if name.is_empty()
        || name == "@"
        || name.starts_with(['-', '/', '.'])
        || name.starts_with("refs/")
        || name.ends_with(['/', '.'])
        || name.contains("..")
        || name.contains("//")
        || name.contains("@{")
        || name.split('/').any(|component| {
            component.is_empty() || component.starts_with('.') || component.ends_with(".lock")
        })
        || name
            .chars()
            .any(|ch| ch.is_control() || forbidden.contains(&ch))
    {
        return Err(WorkspaceError::new(
            ErrorCode::InvalidRequest,
            "Invalid tag name",
        ));
    }
    Ok(())
}

fn ensure_generation(expected: RepoGeneration, actual: RepoGeneration) -> WorkspaceResult<()> {
    if expected != actual {
        return Err(WorkspaceError::new(
            ErrorCode::StaleGeneration,
            "The repository state changed. Reload and try again",
        )
        .detail("expected", expected.to_string())
        .detail("actual", actual.to_string()));
    }
    Ok(())
}

fn stale_image_error() -> WorkspaceError {
    WorkspaceError::new(
        ErrorCode::StaleGeneration,
        "The displayed diff changed before the image was read",
    )
}

fn image_target_mismatch_error() -> WorkspaceError {
    WorkspaceError::new(
        ErrorCode::InvalidRequest,
        "The requested image does not belong to the displayed diff",
    )
}

fn image_side_missing() -> WorkspaceError {
    WorkspaceError::new(
        ErrorCode::InvalidRequest,
        "The requested side of the image diff does not exist",
    )
}

fn image_file_type_error(path: &str) -> WorkspaceError {
    WorkspaceError::new(
        ErrorCode::InvalidRequest,
        "Symlinks and submodules cannot be previewed as images",
    )
    .detail("path", path)
}

fn image_too_large_error(path: &str) -> WorkspaceError {
    WorkspaceError::new(
        ErrorCode::InvalidRequest,
        "The image exceeds the preview size limit",
    )
    .detail("path", path)
}

fn ensure_action_allowed(
    repo: &RepoContext,
    snapshot: &RepoSnapshot,
    action: &Action,
) -> WorkspaceResult<()> {
    let git_flow_recovery = git_flow::pending_operation(&repo.git_dir).is_some()
        && matches!(
            action,
            Action::Continue
                | Action::Abort
                | Action::GitFlow {
                    request: GitFlowRequest {
                        command: GitFlowCommand::Continue | GitFlowCommand::Abort,
                        ..
                    }
                }
        );
    if !git_flow_recovery && !action_allowed_during(&snapshot.operation, action) {
        return Err(WorkspaceError::new(
            ErrorCode::OperationInProgress,
            "Complete or abort the operation in progress",
        ));
    }
    Ok(())
}

fn action_allowed_during(operation: &OperationState, action: &Action) -> bool {
    if matches!(
        action,
        Action::FileAction {
            operation: FileOperation::RevealInFinder,
            ..
        }
    ) {
        return true;
    }
    let conflict = matches!(
        action,
        Action::ConflictSave { .. }
            | Action::ConflictChoice { .. }
            | Action::ConflictMarkResolved { .. }
            | Action::ConflictMaterialize { .. }
            | Action::ConflictOpenExternal { .. }
    );
    match operation {
        OperationState::None => true,
        OperationState::Merge { .. } => {
            conflict || matches!(action, Action::Commit { .. } | Action::Abort)
        }
        OperationState::Rebase
        | OperationState::CherryPick { .. }
        | OperationState::Revert { .. } => {
            conflict || matches!(action, Action::Continue | Action::Skip | Action::Abort)
        }
        OperationState::PendingStructuredCommit { .. } => {
            matches!(action, Action::Commit { .. } | Action::Abort)
        }
        OperationState::StructuredAbortRecovery { .. } => matches!(action, Action::Abort),
        OperationState::Unknown { .. } => false,
    }
}

fn require_clean(snapshot: &RepoSnapshot) -> WorkspaceResult<()> {
    if !snapshot.entries.is_empty() {
        return Err(WorkspaceError::new(
            ErrorCode::InvalidRequest,
            "This operation requires a clean worktree and index",
        ));
    }
    Ok(())
}

fn action_paths(action: &Action) -> Vec<String> {
    match action {
        Action::Stage {
            paths, selection, ..
        }
        | Action::Unstage {
            paths, selection, ..
        }
        | Action::Discard {
            paths, selection, ..
        } => {
            let mut output = paths.clone();
            if let Some(selection) = selection {
                output.push(selection.path().to_owned());
            }
            output
        }
        Action::FileAction { paths, .. } => paths.clone(),
        Action::SaveFile { path, .. } => vec![path.clone()],
        Action::RenameFile { path, new_path } => vec![path.clone(), new_path.clone()],
        Action::GitFlow { request } if request.shared => vec![".gitflow".into()],
        _ => Vec::new(),
    }
}

fn action_commits(action: &Action) -> Vec<String> {
    match action {
        Action::CreateBranch { start_point, .. } => vec![start_point.clone()],
        Action::CreateTag { target, .. } => vec![target.clone()],
        Action::Merge { source, .. } => vec![source.clone()],
        Action::Rebase { onto } => vec![onto.clone()],
        Action::CherryPick { commit, .. }
        | Action::Revert { commit, .. }
        | Action::Reset { commit, .. } => vec![commit.clone()],
        _ => Vec::new(),
    }
}

fn remote_effect(
    git: &GitExecutor,
    root: &Path,
    action: &Action,
) -> WorkspaceResult<Option<LocalizedMessage>> {
    let effect = match action {
        Action::Fetch { remote } => {
            Some(LocalizedMessage::new("previewFetchRemote").arg("remote", remote.clone()))
        }
        Action::Pull { remote, .. } => {
            Some(LocalizedMessage::new("previewPullRemote").arg("remote", remote.clone()))
        }
        Action::Push {
            remote,
            local_branch,
            remote_branch,
            ..
        } => Some(
            LocalizedMessage::new("previewPushRemote")
                .arg("remote", remote.clone())
                .arg("localBranch", local_branch.clone())
                .arg("remoteBranch", remote_branch.clone()),
        ),
        Action::SetRemoteUrl {
            remote, url_kind, ..
        } => Some(
            LocalizedMessage::new("previewSetRemoteUrl")
                .arg("remote", remote.clone())
                .arg("kind", format!("{url_kind:?}")),
        ),
        Action::AddRemote { remote, .. } => {
            Some(LocalizedMessage::new("previewAddRemote").arg("remote", remote.clone()))
        }
        Action::GitFlow { request }
            if request.command == GitFlowCommand::Delete && request.remote =>
        {
            let branch = git_flow::topic_branch_name(git, root, request, None)?
                .or_else(|| request.name.clone())
                .unwrap_or_else(|| "current branch".into());
            Some(LocalizedMessage::new("previewGitFlowRemoteDelete").arg("branch", branch))
        }
        Action::GitFlow { request } if request.remote_effect() => Some(
            LocalizedMessage::new("previewGitFlowRemote")
                .arg("command", format!("{:?}", request.command))
                .arg(
                    "branch",
                    request.name.clone().unwrap_or_else(|| "HEAD".into()),
                ),
        ),
        _ => None,
    };
    Ok(effect)
}

fn preview_summary(action: &Action, target_binding: Option<&TargetBinding>) -> LocalizedMessage {
    match action {
        Action::Discard { target, paths, .. } => LocalizedMessage::new("previewDiscardPaths")
            .number_arg("count", paths.len())
            .arg("target", format!("{target:?}")),
        Action::Reset { commit, mode } => LocalizedMessage::new("previewReset")
            .arg("mode", format!("{mode:?}"))
            .arg("commit", commit.clone()),
        Action::DeleteBranch { name }
            if target_binding.is_some_and(|binding| !binding.lost_commit_oids.is_empty()) =>
        {
            LocalizedMessage::new("previewDeleteUnmergedBranch").arg("branch", name.clone())
        }
        Action::DeleteBranch { name } => {
            LocalizedMessage::new("previewDeleteBranch").arg("branch", name.clone())
        }
        Action::Rebase { onto } => LocalizedMessage::new("previewRebase").arg("onto", onto.clone()),
        Action::Abort => LocalizedMessage::new("previewAbort"),
        Action::ConflictMaterialize { choice, .. } => {
            LocalizedMessage::new("previewApplyConflictSide").arg("choice", format!("{choice:?}"))
        }
        Action::FileAction {
            paths,
            operation: FileOperation::MoveToTrash,
        } => LocalizedMessage::new("previewDeleteFiles").number_arg("count", paths.len()),
        _ => action_display_message(action),
    }
}

fn action_display_message(action: &Action) -> LocalizedMessage {
    LocalizedMessage::new(match action {
        Action::Stage { .. } => "actionStageFiles",
        Action::Unstage { .. } => "actionUnstageFiles",
        Action::Discard { .. } => "actionDiscardChanges",
        Action::Commit { .. } => "actionCommit",
        Action::Fetch { .. } => "actionFetch",
        Action::Pull { .. } => "actionPull",
        Action::Push { .. } => "actionPush",
        Action::SetRemoteUrl { .. } => "actionSetRemoteUrl",
        Action::AddRemote { .. } => "actionAddRemote",
        Action::CreateBranch { .. } => "actionCreateBranch",
        Action::DeleteBranch { .. } => "actionDeleteBranch",
        Action::CreateTag { .. } => "actionCreateTag",
        Action::GitFlow { .. } => "actionGitFlow",
        Action::Checkout { .. } => "actionCheckoutBranch",
        Action::Merge { .. } => "actionMergeBranch",
        Action::Rebase { .. } => "actionRebaseBranch",
        Action::CherryPick { .. } => "actionCherryPickCommit",
        Action::Revert { .. } => "actionRevertCommit",
        Action::Reset { .. } => "actionResetToCommit",
        Action::Continue => "actionContinueOperation",
        Action::Skip => "actionSkipOperation",
        Action::Abort => "actionAbortOperation",
        Action::ConflictSave { .. } => "actionSaveConflictResult",
        Action::ConflictChoice { .. } => "actionResolveConflictBlock",
        Action::ConflictMarkResolved { .. } => "actionMarkConflictResolved",
        Action::ConflictMaterialize { .. } => "actionApplyConflictSide",
        Action::ConflictOpenExternal { .. } => "actionOpenConflictExternally",
        Action::SaveFile { .. } => "actionSaveFile",
        Action::RenameFile { .. } => "actionRenameFile",
        Action::FileAction { operation, .. } => match operation {
            FileOperation::MoveToTrash => "actionMoveFileToTrash",
            FileOperation::RevealInFinder => "actionShowInFinder",
            FileOperation::OpenInDefaultApp => "actionOpenInDefaultApp",
        },
    })
}

fn action_hash(action: &Action) -> WorkspaceResult<String> {
    let bytes = serde_json::to_vec(action)
        .map_err(|error| WorkspaceError::new(ErrorCode::Internal, error.to_string()))?;
    Ok(hash(&bytes))
}

fn discard_untracked(
    repo: &RepoContext,
    snapshot: &RepoSnapshot,
    paths: &[String],
) -> WorkspaceResult<()> {
    for path in paths {
        let is_untracked = snapshot
            .entries
            .iter()
            .any(|entry| entry.path == *path && entry.untracked);
        if !is_untracked {
            return Err(WorkspaceError::new(
                ErrorCode::InvalidRequest,
                format!("Not an untracked file: {path}"),
            ));
        }
        validate_path(path)?;
        let absolute = repo.root.join(path);
        if absolute.is_dir() && !absolute.is_symlink() {
            return Err(WorkspaceError::new(
                ErrorCode::InvalidRequest,
                "Expand directories and move each leaf entry to Trash",
            ));
        }
        trash::delete(&absolute)
            .map_err(|error| WorkspaceError::new(ErrorCode::Io, error.to_string()))?;
    }
    Ok(())
}

fn ensure_trashable_file(path: &Path) -> WorkspaceResult<()> {
    let metadata = file_action_metadata(path)?;
    if metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        return Ok(());
    }
    Err(WorkspaceError::new(
        ErrorCode::InvalidRequest,
        "Only regular files and symbolic links can be moved to Trash",
    ))
}

fn ensure_renameable_file(path: &Path) -> WorkspaceResult<()> {
    let metadata = file_action_metadata(path)?;
    if metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        return Ok(());
    }
    Err(WorkspaceError::new(
        ErrorCode::InvalidRequest,
        "Only regular files and symbolic links can be renamed",
    ))
}

fn ensure_openable_file(path: &Path) -> WorkspaceResult<()> {
    let metadata = file_action_metadata(path)?;
    if metadata.file_type().is_symlink() {
        return Err(WorkspaceError::new(
            ErrorCode::InvalidRequest,
            "Symbolic links can only be shown in Finder",
        ));
    }
    if metadata.file_type().is_file() {
        return Ok(());
    }
    Err(WorkspaceError::new(
        ErrorCode::InvalidRequest,
        "Only regular files can be opened in the default app",
    ))
}

fn file_action_metadata(path: &Path) -> WorkspaceResult<fs::Metadata> {
    fs::symlink_metadata(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            WorkspaceError::new(
                ErrorCode::InvalidRequest,
                "The selected file no longer exists",
            )
        } else {
            WorkspaceError::new(ErrorCode::Io, error.to_string())
        }
    })
}

fn nearest_existing_path(root: &Path, requested: &Path) -> WorkspaceResult<PathBuf> {
    let canonical_root = root
        .canonicalize()
        .map_err(|error| WorkspaceError::new(ErrorCode::Io, error.to_string()))?;
    if !requested.starts_with(&canonical_root) {
        return Err(WorkspaceError::new(
            ErrorCode::InvalidRequest,
            "Paths outside the repository cannot be shown in Finder",
        ));
    }
    let mut candidate = requested.to_path_buf();
    loop {
        match fs::symlink_metadata(&candidate) {
            Ok(_) => return Ok(candidate),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if candidate == canonical_root || !candidate.pop() {
                    return Ok(canonical_root);
                }
            }
            Err(error) => return Err(WorkspaceError::new(ErrorCode::Io, error.to_string())),
        }
    }
}

fn finder_reveal_arguments(root: &Path, requested: &Path) -> WorkspaceResult<Vec<OsString>> {
    match fs::symlink_metadata(requested) {
        Ok(_) => macos_open_arguments(FileOperation::RevealInFinder, requested),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let parent = nearest_existing_path(root, requested)?;
            macos_open_arguments(FileOperation::OpenInDefaultApp, &parent)
        }
        Err(error) => Err(WorkspaceError::new(ErrorCode::Io, error.to_string())),
    }
}

fn macos_open_arguments(operation: FileOperation, path: &Path) -> WorkspaceResult<Vec<OsString>> {
    match operation {
        FileOperation::RevealInFinder => Ok(vec![OsString::from("-R"), path.as_os_str().into()]),
        FileOperation::OpenInDefaultApp => Ok(vec![path.as_os_str().into()]),
        FileOperation::MoveToTrash => Err(WorkspaceError::new(
            ErrorCode::Internal,
            "MoveToTrash is not a macOS open operation",
        )),
    }
}

fn launch_macos_open(arguments: &[OsString]) -> WorkspaceResult<()> {
    let output = ProcessCommand::new("/usr/bin/open")
        .args(arguments)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| WorkspaceError::new(ErrorCode::Io, error.to_string()))?;
    if output.status.success() {
        return Ok(());
    }
    Err(
        WorkspaceError::new(ErrorCode::Io, "macOS could not open the selected file").detail(
            "stderr",
            String::from_utf8_lossy(&output.stderr).into_owned(),
        ),
    )
}

fn synthetic_output(label: &str) -> GitOutput {
    GitOutput {
        argv: vec![format!("app:{label}")],
        status: Some(0),
        stdout: Vec::new(),
        stderr: Vec::new(),
        truncated: false,
        cancelled: false,
        hook_executed: false,
    }
}

fn command_activity_details(activity: &CommandActivity) -> BTreeMap<String, String> {
    BTreeMap::from([
        (
            "argv".into(),
            serde_json::to_string(&activity.argv).unwrap_or_else(|_| "[]".into()),
        ),
        (
            "exitCode".into(),
            activity
                .exit_code
                .map_or_else(|| "signal".into(), |value| value.to_string()),
        ),
        ("stdout".into(), activity.stdout.clone()),
        ("stderr".into(), activity.stderr.clone()),
        ("cancelled".into(), activity.cancelled.to_string()),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::journal::test_journal_store;
    use std::os::unix::fs::PermissionsExt;
    use std::process::Command;
    use tauri::ipc::InvokeResponseBody;
    use tempfile::TempDir;

    #[test]
    fn synthetic_activity_uses_a_non_brand_command_name() {
        assert_eq!(
            synthetic_output("conflict-save").argv,
            ["app:conflict-save"]
        );
    }

    #[test]
    fn commit_activity_aggregates_daily_commits_and_normalized_contributors() {
        let result = aggregate_commit_activity(
            "100\u{1f}Dev@Example.com\u{1f}Dev\u{1e}\n150\u{1f}dev@example.com\u{1f}Other Name\u{1e}\n250\u{1f}\u{1f}Fallback Name\u{1e}\n300\u{1f}outside@example.com\u{1f}Outside\u{1e}",
            &[100, 200, 300],
            10,
        )
        .unwrap();

        assert_eq!(result.time_basis, CommitActivityTimeBasis::Committed);
        assert_eq!(result.totals.commits, 3);
        assert_eq!(result.totals.active_days, 2);
        assert_eq!(result.totals.contributors, 2);
        assert_eq!(result.buckets[0].commit_count, 2);
        assert_eq!(result.buckets[1].commit_count, 1);
        assert_eq!(result.buckets[0].contributor_count, 1);
        assert_eq!(result.buckets[1].contributor_count, 1);
        assert_eq!(result.coverage, CommitActivityCoverage::Complete);
    }

    #[test]
    fn commit_activity_reports_partial_totals_at_the_scan_sentinel() {
        let result = aggregate_commit_activity(
            "100\u{1f}one@example.com\u{1f}One\u{1e}\n110\u{1f}two@example.com\u{1f}Two\u{1e}\n210\u{1f}three@example.com\u{1f}Three\u{1e}",
            &[100, 200, 300],
            2,
        )
        .unwrap();

        assert_eq!(result.totals.commits, 2);
        assert_eq!(result.totals.active_days, 1);
        assert_eq!(result.totals.contributors, 2);
        assert_eq!(result.buckets[0].commit_count, 2);
        assert_eq!(result.buckets[1].commit_count, 0);
        assert_eq!(
            result.coverage,
            CommitActivityCoverage::Truncated { scan_limit: 2 }
        );
    }

    #[test]
    fn commit_activity_rejects_missing_duplicate_and_excessive_boundaries() {
        assert_eq!(
            validate_commit_activity_boundaries(&[100])
                .unwrap_err()
                .code,
            ErrorCode::InvalidRequest
        );
        assert_eq!(
            validate_commit_activity_boundaries(&[100, 100])
                .unwrap_err()
                .code,
            ErrorCode::InvalidRequest
        );
        assert_eq!(
            validate_commit_activity_boundaries(
                &(0..=(MAX_COMMIT_ACTIVITY_BUCKETS + 1))
                    .map(|value| value as i64)
                    .collect::<Vec<_>>()
            )
            .unwrap_err()
            .code,
            ErrorCode::InvalidRequest
        );
    }

    #[test]
    fn commit_activity_cache_is_a_bounded_lru() {
        let mut cache = VecDeque::new();
        let entry = |index: usize| CommitActivityCacheEntry {
            key: CommitActivityCacheKey {
                history_revision: format!("head-{index}"),
                bucket_boundaries_unix_seconds: vec![0, 86_400],
            },
            result: CommitActivityResult {
                repo_generation: index as u64,
                history_revision: format!("head-{index}"),
                time_basis: CommitActivityTimeBasis::Committed,
                totals: CommitActivityTotals {
                    commits: index as u64,
                    active_days: 0,
                    contributors: 0,
                    branches: 0,
                },
                buckets: Vec::new(),
                coverage: CommitActivityCoverage::Complete,
            },
        };
        for index in 0..=MAX_COMMIT_ACTIVITY_CACHE_ENTRIES {
            commit_activity_cache_insert(&mut cache, entry(index));
        }
        assert_eq!(cache.len(), MAX_COMMIT_ACTIVITY_CACHE_ENTRIES);
        assert!(commit_activity_cache_get(&mut cache, &entry(0).key).is_none());
        assert!(commit_activity_cache_get(&mut cache, &entry(1).key).is_some());
        commit_activity_cache_insert(&mut cache, entry(MAX_COMMIT_ACTIVITY_CACHE_ENTRIES + 1));
        assert!(commit_activity_cache_get(&mut cache, &entry(2).key).is_none());
        assert!(commit_activity_cache_get(&mut cache, &entry(1).key).is_some());
    }

    #[test]
    fn porcelain_v2_status_is_parsed_without_path_quoting() {
        let snapshot = parse_status(
            b"# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n1 M. N... 100644 100644 100644 a b file with space.txt\0? new.txt\0",
        )
        .unwrap();
        assert_eq!(snapshot.ahead, 2);
        assert_eq!(snapshot.behind, 1);
        assert_eq!(snapshot.entries[0].path, "file with space.txt");
        assert!(snapshot.entries[1].untracked);
    }

    #[test]
    fn porcelain_v2_keeps_a_newline_inside_one_nul_delimited_path() {
        let snapshot = parse_status(
            b"# branch.oid abc\n# branch.head main\n? first line\n? looks-like-entry\0",
        )
        .unwrap();
        assert_eq!(snapshot.entries.len(), 1);
        assert_eq!(snapshot.entries[0].path, "first line\n? looks-like-entry");
    }

    #[test]
    fn numstat_sums_text_files_and_ignores_binary_files() {
        let stats =
            parse_numstat(b"8\t2\tsrc/app.ts\x005\t3\tsrc/other.ts\0-\t-\tassets/image.png\0")
                .unwrap();

        assert_eq!((stats.additions, stats.deletions), (13, 5));
    }

    #[test]
    fn snapshot_includes_staged_and_unstaged_line_counts() {
        let fixture = GitFixture::new();
        fixture.write("app.txt", "base\n");
        fixture.git(&["add", "--", "app.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        fixture.write("app.txt", "base\nstaged\n");
        fixture.git(&["add", "--", "app.txt"]);
        fixture.write("app.txt", "base\nstaged\nunstaged\n");

        let attached = fixture
            .workspace()
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();

        assert_eq!(
            (attached.snapshot.additions, attached.snapshot.deletions),
            (Some(2), Some(0))
        );
    }

    #[test]
    fn overwrite_collision_uses_path_component_boundaries() {
        assert!(paths_overlap_components("node", "node"));
        assert!(paths_overlap_components("node/secret.txt", "node"));
        assert!(paths_overlap_components("node", "node/child.txt"));
        assert!(!paths_overlap_components("node-other", "node"));
        assert!(!paths_overlap_components("node", "node-other/child.txt"));
    }

    #[test]
    fn preview_binding_changes_when_action_changes() {
        let first = Action::Reset {
            commit: "abc".into(),
            mode: ResetMode::Mixed,
        };
        let second = Action::Reset {
            commit: "abc".into(),
            mode: ResetMode::Hard,
        };
        assert_ne!(action_hash(&first).unwrap(), action_hash(&second).unwrap());
    }

    #[test]
    fn cancelled_and_expired_preview_records_stay_bounded() {
        let now = SystemTime::now();
        let mut records = HashMap::new();
        records.insert(
            "expired".into(),
            PreviewRecord {
                repo_id: "repo".into(),
                generation: 1,
                action_hash: "expired".into(),
                target_binding: None,
                expires_at: now - Duration::from_secs(1),
            },
        );
        for index in 0..(MAX_PREVIEW_RECORDS + 32) {
            prune_expired_preview_records(&mut records, now);
            reserve_preview_capacity(&mut records);
            records.insert(
                format!("preview-{index}"),
                PreviewRecord {
                    repo_id: "repo".into(),
                    generation: 1,
                    action_hash: index.to_string(),
                    target_binding: None,
                    expires_at: now + Duration::from_secs(1 + index as u64),
                },
            );
        }
        assert_eq!(records.len(), MAX_PREVIEW_RECORDS);
        assert!(!records.contains_key("expired"));
        assert!(records.contains_key(&format!("preview-{}", MAX_PREVIEW_RECORDS + 31)));
    }

    #[test]
    fn revision_target_actions_all_require_preview_binding() {
        let actions = [
            Action::Reset {
                commit: "target".into(),
                mode: ResetMode::Soft,
            },
            Action::Merge {
                source: "target".into(),
                commit_immediately: false,
            },
            Action::Rebase {
                onto: "target".into(),
            },
            Action::CherryPick {
                commit: "target".into(),
                mainline: None,
            },
            Action::Revert {
                commit: "target".into(),
                mainline: None,
            },
            Action::CreateBranch {
                name: "topic".into(),
                start_point: "target".into(),
                checkout: false,
            },
            Action::CreateTag {
                name: "v1.0.0".into(),
                target: "target".into(),
            },
        ];
        assert!(actions.iter().all(Action::requires_preview_binding));
    }

    #[test]
    fn tag_names_use_short_safe_ref_names() {
        for name in ["v1.0.0", "release/2026-08"] {
            assert!(validate_tag_name(name).is_ok(), "{name}");
        }
        for name in [
            "",
            "-option",
            "refs/tags/v1.0.0",
            "release/.hidden",
            "release/v1.lock",
            "bad..tag",
            "@",
            "bad tag",
        ] {
            assert!(validate_tag_name(name).is_err(), "{name}");
        }
    }

    #[test]
    fn operation_mutation_matrix_blocks_generic_commit_during_rebase() {
        let stage = Action::Stage {
            paths: vec!["f.txt".into()],
            selection: None,
        };
        let commit = conventional_commit_action("state matrix");
        let conflict = Action::ConflictOpenExternal {
            session_id: "session".into(),
            conflict_generation: "generation".into(),
            editor: ExternalEditor {
                kind: ExternalEditorKind::SystemDefault,
            },
        };

        assert!(!action_allowed_during(&OperationState::Rebase, &stage));
        assert!(action_allowed_during(&OperationState::Rebase, &conflict));
        assert!(action_allowed_during(
            &OperationState::Rebase,
            &Action::Continue
        ));
        assert!(!action_allowed_during(&OperationState::Rebase, &commit));

        let merge = OperationState::Merge { incoming_oid: None };
        assert!(action_allowed_during(&merge, &commit));
        assert!(action_allowed_during(&merge, &Action::Abort));
        assert!(!action_allowed_during(&merge, &stage));
        assert!(!action_allowed_during(&merge, &Action::Continue));

        for sequencer in [
            OperationState::CherryPick { source_oid: None },
            OperationState::Revert { source_oid: None },
        ] {
            assert!(!action_allowed_during(&sequencer, &stage));
            assert!(action_allowed_during(&sequencer, &conflict));
            assert!(action_allowed_during(&sequencer, &Action::Continue));
            assert!(action_allowed_during(&sequencer, &Action::Skip));
            assert!(action_allowed_during(&sequencer, &Action::Abort));
            assert!(!action_allowed_during(&sequencer, &commit));
        }

        let pending = OperationState::PendingStructuredCommit {
            operation: StructuredOperation::CherryPick,
            source_oid: "source".into(),
            pre_head_oid: "head".into(),
        };
        assert!(!action_allowed_during(&pending, &stage));
        assert!(action_allowed_during(&pending, &commit));
        assert!(action_allowed_during(&pending, &Action::Abort));
        assert!(!action_allowed_during(&pending, &conflict));

        let recovery = OperationState::StructuredAbortRecovery {
            operation: StructuredOperation::Revert,
            source_oid: "source".into(),
            pre_head_oid: "head".into(),
        };
        assert!(!action_allowed_during(&recovery, &stage));
        assert!(!action_allowed_during(&recovery, &commit));
        assert!(!action_allowed_during(&recovery, &conflict));
        assert!(action_allowed_during(&recovery, &Action::Abort));

        let unknown = OperationState::Unknown {
            marker: "unknown".into(),
        };
        assert!(!action_allowed_during(&unknown, &stage));
        assert!(!action_allowed_during(&unknown, &Action::Abort));

        for operation in [
            OperationState::Merge { incoming_oid: None },
            OperationState::Rebase,
            OperationState::CherryPick { source_oid: None },
            OperationState::Revert { source_oid: None },
            unknown,
        ] {
            assert!(action_allowed_during(
                &operation,
                &Action::FileAction {
                    paths: vec!["f.txt".into()],
                    operation: FileOperation::RevealInFinder,
                }
            ));
            for file_operation in [FileOperation::MoveToTrash, FileOperation::OpenInDefaultApp] {
                assert!(!action_allowed_during(
                    &operation,
                    &Action::FileAction {
                        paths: vec!["f.txt".into()],
                        operation: file_operation,
                    }
                ));
            }
        }
    }

    #[test]
    fn revision_and_path_option_injection_is_rejected() {
        assert!(validate_revision("--hard").is_err());
        assert!(validate_path("../outside").is_err());
        assert!(validate_path(".").is_err());
        assert!(validate_path("dir/./file").is_err());
        assert!(validate_branch_name("-bad").is_err());
        assert!(
            validate_action(&Action::RenameFile {
                path: "src/old.ts".into(),
                new_path: "docs/new.ts".into(),
            })
            .is_err()
        );
    }

    #[test]
    fn commit_diff_file_parser_keeps_git_order_and_rename_paths() {
        let files = parse_commit_diff_files(
            b"A\0added.txt\0R100\0old name.txt\0new name.txt\0D\0gone.txt\0",
        )
        .unwrap();
        assert_eq!(files.len(), 3);
        assert_eq!(files[0].status, CommitDiffFileStatus::Added);
        assert_eq!(files[1].previous_path.as_deref(), Some("old name.txt"));
        assert_eq!(files[1].path, "new name.txt");
        assert_eq!(files[2].status, CommitDiffFileStatus::Deleted);
        assert_eq!(
            parse_commit_diff_files(b"T\0mode.txt\0").unwrap()[0].status,
            CommitDiffFileStatus::Modified
        );
        assert!(parse_commit_diff_files(b"A\0../outside\0").is_err());
        assert!(parse_commit_diff_files(b"C100\0old\0new\0").is_err());
        assert!(parse_commit_diff_files(b"R\0old\0new\0").is_err());
        assert!(parse_commit_diff_files(b"R0\0old\0new\0").is_err());
        assert!(parse_commit_diff_files(b"R101\0old\0new\0").is_err());
        assert!(parse_commit_diff_files(b"R100\0old\0").is_err());
        assert!(parse_commit_diff_files(b"A\0missing-nul").is_err());
        assert!(parse_commit_diff_files(b"A\0\xff\0").is_err());
    }

    #[test]
    fn file_action_targets_must_be_visible_in_the_current_snapshot() {
        let snapshot = parse_status(b"? visible.txt\0").unwrap();
        let forged = Action::FileAction {
            paths: vec![".git/config".into()],
            operation: FileOperation::OpenInDefaultApp,
        };
        assert_eq!(
            validate_action_targets(&snapshot, &forged)
                .unwrap_err()
                .code,
            ErrorCode::InvalidRequest
        );

        for operation in [
            FileOperation::MoveToTrash,
            FileOperation::RevealInFinder,
            FileOperation::OpenInDefaultApp,
        ] {
            validate_action_targets(
                &snapshot,
                &Action::FileAction {
                    paths: vec!["visible.txt".into()],
                    operation,
                },
            )
            .unwrap();
        }
    }

    #[test]
    fn only_delete_accepts_multiple_file_action_targets() {
        let snapshot = parse_status(b"? first.txt\0? second.txt\0").unwrap();
        validate_action_targets(
            &snapshot,
            &Action::FileAction {
                paths: vec!["first.txt".into(), "second.txt".into()],
                operation: FileOperation::MoveToTrash,
            },
        )
        .unwrap();

        for operation in [
            FileOperation::RevealInFinder,
            FileOperation::OpenInDefaultApp,
        ] {
            assert_eq!(
                validate_action_targets(
                    &snapshot,
                    &Action::FileAction {
                        paths: vec!["first.txt".into(), "second.txt".into()],
                        operation,
                    },
                )
                .unwrap_err()
                .code,
                ErrorCode::InvalidRequest
            );
        }
    }

    #[test]
    fn forged_git_metadata_file_action_is_rejected_before_preview() {
        let fixture = GitFixture::new();
        fixture.write("visible.txt", "visible\n");
        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let error = workspace
            .preview(PreviewRequest {
                repo_id: attached.repo_id,
                expected_generation: attached.snapshot.repo_generation,
                action: Action::FileAction {
                    paths: vec![".git/config".into()],
                    operation: FileOperation::MoveToTrash,
                },
            })
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidRequest);
        assert!(fixture.repo.join(".git/config").exists());
    }

    #[test]
    fn conflicted_files_only_allow_the_generic_finder_reveal() {
        let mut snapshot = parse_status(b"? conflict.txt\0").unwrap();
        snapshot.entries[0].conflict = true;
        for operation in [FileOperation::MoveToTrash, FileOperation::OpenInDefaultApp] {
            assert_eq!(
                validate_action_targets(
                    &snapshot,
                    &Action::FileAction {
                        paths: vec!["conflict.txt".into()],
                        operation,
                    },
                )
                .unwrap_err()
                .code,
                ErrorCode::InvalidRequest
            );
        }
        validate_action_targets(
            &snapshot,
            &Action::FileAction {
                paths: vec!["conflict.txt".into()],
                operation: FileOperation::RevealInFinder,
            },
        )
        .unwrap();
    }

    #[test]
    fn file_action_path_rules_do_not_follow_symlinks_outside_the_repo() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(root.path().join("file.txt"), "inside").unwrap();
        fs::write(outside.path().join("secret.txt"), "outside").unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("secret.txt"),
            root.path().join("leaf-link"),
        )
        .unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join("escape")).unwrap();

        let file = checked_repo_path(root.path(), "file.txt").unwrap();
        ensure_trashable_file(&file).unwrap();
        ensure_openable_file(&file).unwrap();

        let leaf_link = checked_repo_path(root.path(), "leaf-link").unwrap();
        ensure_trashable_file(&leaf_link).unwrap();
        assert_eq!(
            ensure_openable_file(&leaf_link).unwrap_err().code,
            ErrorCode::InvalidRequest
        );
        assert_eq!(
            checked_repo_path(root.path(), "escape/secret.txt")
                .unwrap_err()
                .code,
            ErrorCode::InvalidRequest
        );
        assert_eq!(
            fs::read_to_string(outside.path().join("secret.txt")).unwrap(),
            "outside"
        );
    }

    #[test]
    fn file_action_rejects_directories_and_finder_falls_back_to_existing_parent() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("directory")).unwrap();
        assert_eq!(
            ensure_trashable_file(&root.path().join("directory"))
                .unwrap_err()
                .code,
            ErrorCode::InvalidRequest
        );
        assert_eq!(
            ensure_openable_file(&root.path().join("directory"))
                .unwrap_err()
                .code,
            ErrorCode::InvalidRequest
        );

        let missing = checked_repo_path(root.path(), "directory/deleted.txt").unwrap();
        assert_eq!(
            nearest_existing_path(root.path(), &missing).unwrap(),
            root.path().canonicalize().unwrap().join("directory")
        );
    }

    #[test]
    fn macos_open_uses_fixed_typed_arguments_for_special_filenames() {
        let path = Path::new("/tmp/-R file\nwith newline.txt");
        assert_eq!(
            macos_open_arguments(FileOperation::RevealInFinder, path).unwrap(),
            [OsString::from("-R"), path.as_os_str().to_owned()]
        );
        assert_eq!(
            macos_open_arguments(FileOperation::OpenInDefaultApp, path).unwrap(),
            [path.as_os_str().to_owned()]
        );
        assert_eq!(
            macos_open_arguments(FileOperation::MoveToTrash, path)
                .unwrap_err()
                .code,
            ErrorCode::Internal
        );
    }

    #[test]
    fn finder_reveal_selects_existing_targets_but_opens_a_missing_targets_parent() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("directory");
        fs::create_dir(&directory).unwrap();
        fs::write(directory.join("existing.txt"), "existing").unwrap();
        std::os::unix::fs::symlink(directory.join("existing.txt"), directory.join("leaf-link"))
            .unwrap();
        let existing = checked_repo_path(root.path(), "directory/existing.txt").unwrap();
        let leaf_link = checked_repo_path(root.path(), "directory/leaf-link").unwrap();
        let missing = checked_repo_path(root.path(), "directory/deleted.txt").unwrap();
        let canonical_directory = root.path().canonicalize().unwrap().join("directory");

        assert_eq!(
            finder_reveal_arguments(root.path(), &existing).unwrap(),
            [OsString::from("-R"), existing.as_os_str().to_owned()]
        );
        assert_eq!(
            finder_reveal_arguments(root.path(), &leaf_link).unwrap(),
            [OsString::from("-R"), leaf_link.as_os_str().to_owned()]
        );
        assert_eq!(
            finder_reveal_arguments(root.path(), &missing).unwrap(),
            [canonical_directory.as_os_str().to_owned()]
        );
    }

    #[test]
    fn attaching_the_same_repo_replaces_its_event_channel() {
        let fixture = GitFixture::new();
        fixture.write("f.txt", "base\n");
        fixture.git(&["add", "--", "f.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        fixture.write("f.txt", "changed\n");
        let workspace = fixture.workspace();
        let first_events = Arc::new(Mutex::new(Vec::new()));
        let second_events = Arc::new(Mutex::new(Vec::new()));
        workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                Some(capture_events(first_events.clone())),
            )
            .unwrap();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                Some(capture_events(second_events.clone())),
            )
            .unwrap();

        workspace
            .execute(ExecuteRequest {
                operation_id: "replacement-channel".into(),
                repo_id: attached.repo_id,
                expected_generation: attached.snapshot.repo_generation,
                action: Action::Stage {
                    paths: vec!["f.txt".into()],
                    selection: None,
                },
                confirmation_token: None,
            })
            .unwrap();

        assert!(first_events.lock().unwrap().is_empty());
        let second_events = second_events.lock().unwrap();
        assert_eq!(second_events.len(), 2);
        assert_eq!(second_events[0].phase, EventPhase::Started);
        assert_eq!(second_events[1].phase, EventPhase::Completed);
    }

    #[test]
    fn open_initializes_a_directory_without_a_repository() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("new-repository");
        fs::create_dir(&repo).unwrap();
        fs::write(repo.join("README.md"), "new\n").unwrap();
        let workspace = Workspace::new(
            GitExecutor::at(PathBuf::from("/usr/bin/git")),
            test_journal_store(&temp.path().join("journal")).unwrap(),
        );

        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: repo.display().to_string(),
                },
                None,
            )
            .unwrap();

        assert!(repo.join(".git").is_dir());
        assert_eq!(
            attached.snapshot.root,
            repo.canonicalize().unwrap().display().to_string()
        );
        assert!(matches!(
            attached.snapshot.head,
            HeadState::Unborn { ref name } if name == "main"
        ));
        assert_eq!(attached.snapshot.entries[0].path, "README.md");
    }

    #[test]
    fn open_existing_rejects_a_non_git_directory_without_initializing_it() {
        let temp = tempfile::tempdir().unwrap();
        let directory = temp.path().join("not-a-repository");
        fs::create_dir(&directory).unwrap();
        let workspace = Workspace::new(
            GitExecutor::at(PathBuf::from("/usr/bin/git")),
            test_journal_store(&temp.path().join("journal")).unwrap(),
        );

        let error = workspace
            .attach(
                OpenRequest::OpenExisting {
                    path: directory.display().to_string(),
                },
                None,
            )
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::GitFailed);
        assert!(!directory.join(".git").exists());
    }

    #[test]
    fn open_existing_rejects_a_missing_path_without_creating_it() {
        let temp = tempfile::tempdir().unwrap();
        let missing = temp.path().join("missing-repository");
        let workspace = Workspace::new(
            GitExecutor::at(PathBuf::from("/usr/bin/git")),
            test_journal_store(&temp.path().join("journal")).unwrap(),
        );

        let error = workspace
            .attach(
                OpenRequest::OpenExisting {
                    path: missing.display().to_string(),
                },
                None,
            )
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::RepoNotFound);
        assert!(!missing.exists());
    }

    #[test]
    fn repository_availability_distinguishes_missing_non_git_and_available_paths() {
        let temp = tempfile::tempdir().unwrap();
        let plain = temp.path().join("plain");
        let missing = temp.path().join("missing");
        fs::create_dir(&plain).unwrap();
        let fixture = GitFixture::new();
        let workspace = fixture.workspace();

        assert_eq!(
            workspace
                .repository_availability(missing.display().to_string())
                .availability,
            RepositoryAvailability::Missing
        );
        assert_eq!(
            workspace
                .repository_availability(plain.display().to_string())
                .availability,
            RepositoryAvailability::NotRepository
        );
        assert_eq!(
            workspace
                .repository_availability(fixture.repo_string())
                .availability,
            RepositoryAvailability::Available
        );
    }

    #[test]
    fn repository_availability_reports_an_unreadable_repository_as_inaccessible() {
        let fixture = GitFixture::new();
        let workspace = fixture.workspace();
        let original_permissions = fs::metadata(&fixture.repo).unwrap().permissions();
        let mut inaccessible_permissions = original_permissions.clone();
        inaccessible_permissions.set_mode(0o000);
        fs::set_permissions(&fixture.repo, inaccessible_permissions).unwrap();

        let availability = workspace
            .repository_availability(fixture.repo_string())
            .availability;

        fs::set_permissions(&fixture.repo, original_permissions).unwrap();
        assert_eq!(availability, RepositoryAvailability::Inaccessible);
    }

    #[test]
    fn repository_deletion_accepts_only_the_exact_repository_root() {
        let fixture = GitFixture::new();
        let workspace = fixture.workspace();
        let nested = fixture.repo.join("nested");
        fs::create_dir(&nested).unwrap();

        assert_eq!(
            workspace
                .repository_root_for_deletion(&fixture.repo_string())
                .unwrap(),
            fixture.repo.canonicalize().unwrap()
        );
        assert_eq!(
            workspace
                .repository_root_for_deletion(&nested.display().to_string())
                .unwrap_err()
                .code,
            ErrorCode::InvalidRequest
        );
        assert_eq!(
            workspace
                .repository_root_for_deletion("/")
                .unwrap_err()
                .code,
            ErrorCode::InvalidRequest
        );
        if let Some(home) = std::env::var_os("HOME") {
            assert_eq!(
                workspace
                    .repository_root_for_deletion(&PathBuf::from(home).display().to_string())
                    .unwrap_err()
                    .code,
                ErrorCode::InvalidRequest
            );
        }
    }

    #[test]
    fn detach_allows_a_repository_that_is_no_longer_a_git_repository() {
        let fixture = GitFixture::new();
        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::OpenExisting {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        fs::rename(fixture.repo.join(".git"), fixture.repo.join(".git-moved")).unwrap();

        workspace
            .detach(DetachRequest {
                repo_id: attached.repo_id.clone(),
            })
            .unwrap();

        match workspace.repo(&attached.repo_id) {
            Ok(_) => panic!("detached repository remained registered"),
            Err(error) => assert_eq!(error.code, ErrorCode::RepoNotFound),
        }
    }

    #[test]
    fn remote_urls_round_trip_and_execute_rechecks_the_previewed_url() {
        let fixture = GitFixture::new();
        fixture.git(&["remote", "add", "origin", "https://example.test/old.git"]);
        fixture.git(&[
            "remote",
            "set-url",
            "--add",
            "origin",
            "https://mirror.example.test/old.git",
        ]);
        fixture.git(&[
            "remote",
            "set-url",
            "--add",
            "--push",
            "origin",
            "ssh://example.test/push.git",
        ]);
        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::OpenExisting {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let definitions = match workspace
            .query(QueryRequest {
                repo_id: attached.repo_id.clone(),
                query: Query::Remotes,
            })
            .unwrap()
        {
            QueryOutcome::Remotes(result) => result.remotes,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        assert_eq!(definitions[0].fetch_urls.len(), 2);
        assert_eq!(definitions[0].push_urls, ["ssh://example.test/push.git"]);

        let action = Action::SetRemoteUrl {
            remote: "origin".into(),
            url_kind: RemoteUrlKind::Fetch,
            expected_url: "https://example.test/old.git".into(),
            new_url: "https://example.test/new.git".into(),
        };
        let token = preview_token(
            &workspace,
            &attached.repo_id,
            attached.snapshot.repo_generation,
            action.clone(),
        );
        let outcome = workspace
            .execute(ExecuteRequest {
                operation_id: "change-remote-url".into(),
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action,
                confirmation_token: Some(token),
            })
            .unwrap();
        assert!(
            fixture
                .git_output(&["remote", "get-url", "--all", "origin"])
                .contains("https://example.test/new.git")
        );

        let stale_action = Action::SetRemoteUrl {
            remote: "origin".into(),
            url_kind: RemoteUrlKind::Fetch,
            expected_url: "https://example.test/new.git".into(),
            new_url: "https://example.test/final.git".into(),
        };
        let stale_token = preview_token(
            &workspace,
            &attached.repo_id,
            outcome.snapshot.repo_generation,
            stale_action.clone(),
        );
        fixture.git(&[
            "remote",
            "set-url",
            "origin",
            "https://example.test/external.git",
            "https://example.test/new.git",
        ]);
        let error = workspace
            .execute(ExecuteRequest {
                operation_id: "stale-remote-url".into(),
                repo_id: attached.repo_id,
                expected_generation: outcome.snapshot.repo_generation,
                action: stale_action,
                confirmation_token: Some(stale_token),
            })
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::PreviewMismatch);
    }

    #[test]
    fn add_remote_rechecks_absence_and_reads_back_the_url() {
        let fixture = GitFixture::new();
        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::OpenExisting {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let action = Action::AddRemote {
            remote: "origin".into(),
            url: "https://example.test/repository.git".into(),
        };
        let token = preview_token(
            &workspace,
            &attached.repo_id,
            attached.snapshot.repo_generation,
            action.clone(),
        );
        let outcome = workspace
            .execute(ExecuteRequest {
                operation_id: "add-remote".into(),
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action,
                confirmation_token: Some(token),
            })
            .unwrap();
        assert_eq!(
            fixture.git_output(&["remote", "get-url", "origin"]),
            "https://example.test/repository.git"
        );

        let stale_action = Action::AddRemote {
            remote: "backup".into(),
            url: "https://example.test/backup.git".into(),
        };
        let stale_token = preview_token(
            &workspace,
            &attached.repo_id,
            outcome.snapshot.repo_generation,
            stale_action.clone(),
        );
        fixture.git(&[
            "remote",
            "add",
            "backup",
            "https://example.test/external.git",
        ]);
        let error = workspace
            .execute(ExecuteRequest {
                operation_id: "stale-add-remote".into(),
                repo_id: attached.repo_id.clone(),
                expected_generation: outcome.snapshot.repo_generation,
                action: stale_action,
                confirmation_token: Some(stale_token),
            })
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::PreviewMismatch);

        let invalid = workspace
            .preview(PreviewRequest {
                repo_id: attached.repo_id,
                expected_generation: outcome.snapshot.repo_generation,
                action: Action::AddRemote {
                    remote: "invalid".into(),
                    url: "-unsafe".into(),
                },
            })
            .unwrap_err();
        assert_eq!(invalid.code, ErrorCode::InvalidRequest);
    }

    #[test]
    fn open_subdirectory_uses_the_existing_repository_root() {
        let fixture = GitFixture::new();
        let nested = fixture.repo.join("nested");
        fs::create_dir(&nested).unwrap();
        let workspace = fixture.workspace();

        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: nested.display().to_string(),
                },
                None,
            )
            .unwrap();

        assert_eq!(
            attached.snapshot.root,
            fixture.repo.canonicalize().unwrap().display().to_string()
        );
        assert!(!nested.join(".git").exists());
    }

    #[test]
    fn init_stage_and_unstage_work_without_a_head_commit() {
        let fixture = GitFixture::new();
        fixture.write("new.txt", "new\n");
        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let staged = workspace
            .execute(ExecuteRequest {
                operation_id: "unborn-stage".into(),
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action: Action::Stage {
                    paths: vec!["new.txt".into()],
                    selection: None,
                },
                confirmation_token: None,
            })
            .unwrap();
        workspace
            .execute(ExecuteRequest {
                operation_id: "unborn-unstage".into(),
                repo_id: attached.repo_id,
                expected_generation: staged.repo_generation,
                action: Action::Unstage {
                    paths: vec!["new.txt".into()],
                    selection: None,
                },
                confirmation_token: None,
            })
            .unwrap();
        assert!(
            fixture
                .git_output(&["diff", "--cached", "--name-only"])
                .is_empty()
        );
    }

    #[test]
    fn stage_and_unstage_treat_pathspec_magic_as_literal_file_names() {
        let fixture = GitFixture::new();
        fixture.write("*", "wildcard\n");
        fixture.write(":(glob)*", "colon magic\n");
        fixture.write("other.txt", "must remain untracked\n");
        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();

        let staged = workspace
            .execute(ExecuteRequest {
                operation_id: "literal-stage".into(),
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action: Action::Stage {
                    paths: vec!["*".into(), ":(glob)*".into()],
                    selection: None,
                },
                confirmation_token: None,
            })
            .unwrap();
        assert_eq!(
            fixture.git_output(&["diff", "--cached", "--name-only"]),
            "*\n:(glob)*"
        );

        workspace
            .execute(ExecuteRequest {
                operation_id: "literal-unborn-unstage".into(),
                repo_id: attached.repo_id,
                expected_generation: staged.repo_generation,
                action: Action::Unstage {
                    paths: vec!["*".into()],
                    selection: None,
                },
                confirmation_token: None,
            })
            .unwrap();
        assert_eq!(
            fixture.git_output(&["diff", "--cached", "--name-only"]),
            ":(glob)*"
        );
        assert!(
            fixture
                .git_output(&["status", "--short"])
                .contains("?? other.txt")
        );
    }

    #[test]
    fn tracked_unstage_and_discard_are_literal_for_pathspec_magic_names() {
        let fixture = GitFixture::new();
        for path in ["*", ":(glob)*", "other.txt"] {
            fixture.write(path, &format!("base {path}\n"));
        }
        fixture.git(&[
            "--literal-pathspecs",
            "add",
            "--",
            "*",
            ":(glob)*",
            "other.txt",
        ]);
        fixture.git(&["commit", "-m", "feat: base"]);
        for path in ["*", ":(glob)*", "other.txt"] {
            fixture.write(path, &format!("changed {path}\n"));
        }
        fixture.git(&[
            "--literal-pathspecs",
            "add",
            "--",
            "*",
            ":(glob)*",
            "other.txt",
        ]);

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let unstaged = workspace
            .execute(ExecuteRequest {
                operation_id: "literal-tracked-unstage".into(),
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action: Action::Unstage {
                    paths: vec!["*".into(), ":(glob)*".into()],
                    selection: None,
                },
                confirmation_token: None,
            })
            .unwrap();
        assert_eq!(
            fixture.git_output(&["diff", "--cached", "--name-only"]),
            "other.txt"
        );

        let action = Action::Discard {
            paths: vec!["*".into(), ":(glob)*".into()],
            target: DiscardTarget::Unstaged,
            selection: None,
        };
        let token = preview_token(
            &workspace,
            &attached.repo_id,
            unstaged.repo_generation,
            action.clone(),
        );
        workspace
            .execute(ExecuteRequest {
                operation_id: "literal-discard".into(),
                repo_id: attached.repo_id,
                expected_generation: unstaged.repo_generation,
                action,
                confirmation_token: Some(token),
            })
            .unwrap();
        assert_eq!(
            fs::read_to_string(fixture.repo.join("*")).unwrap(),
            "base *\n"
        );
        assert_eq!(
            fs::read_to_string(fixture.repo.join(":(glob)*")).unwrap(),
            "base :(glob)*\n"
        );
        assert_eq!(
            fs::read_to_string(fixture.repo.join("other.txt")).unwrap(),
            "changed other.txt\n"
        );
    }

    #[test]
    fn selected_addition_is_the_only_line_staged() {
        let fixture = GitFixture::new();
        fixture.write("f.txt", "one\nold\nthree\n");
        fixture.git(&["add", "--", "f.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        fixture.write("f.txt", "one\nnew-a\nnew-b\nthree\n");

        let workspace = fixture.workspace();
        let session = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let diff = match workspace
            .query(QueryRequest {
                repo_id: session.repo_id.clone(),
                query: Query::Diff {
                    target: DiffTarget::Unstaged,
                    paths: vec!["f.txt".into()],
                },
            })
            .unwrap()
        {
            QueryOutcome::Diff(diff) => diff,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        let outcome = workspace
            .execute(ExecuteRequest {
                operation_id: "stage-one-line".into(),
                repo_id: session.repo_id.clone(),
                expected_generation: session.snapshot.repo_generation,
                action: Action::Stage {
                    paths: Vec::new(),
                    selection: Some(PatchSelection::Lines {
                        path: "f.txt".into(),
                        diff_revision: diff.diff_revision,
                        side: SelectionSide::Additions,
                        start_line: 2,
                        end_line: 2,
                    }),
                },
                confirmation_token: None,
            })
            .unwrap();
        assert!(outcome.repo_generation > session.snapshot.repo_generation);

        let staged = fixture.git_output(&["diff", "--cached", "--", "f.txt"]);
        assert!(staged.contains("+new-a"));
        assert!(!staged.contains("+new-b"));
        assert!(!staged.contains("-old"));
    }

    #[test]
    fn selected_hunk_is_staged_and_unstaged_as_one_atomic_change() {
        let fixture = GitFixture::new();
        let base = "start\nold-a\nline-3\nline-4\nline-5\nline-6\nline-7\nline-8\nline-9\nline-10\nold-b\nend\n";
        let changed = "start\nnew-a\nline-3\nline-4\nline-5\nline-6\nline-7\nline-8\nline-9\nline-10\nnew-b\nend\n";
        fixture.write("f.txt", base);
        fixture.git(&["add", "--", "f.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        fixture.write("f.txt", changed);

        let workspace = fixture.workspace();
        let session = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let unstaged_diff = match workspace
            .query(QueryRequest {
                repo_id: session.repo_id.clone(),
                query: Query::Diff {
                    target: DiffTarget::Unstaged,
                    paths: vec!["f.txt".into()],
                },
            })
            .unwrap()
        {
            QueryOutcome::Diff(diff) => diff,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        let staged_outcome = workspace
            .execute(ExecuteRequest {
                operation_id: "stage-second-hunk".into(),
                repo_id: session.repo_id.clone(),
                expected_generation: session.snapshot.repo_generation,
                action: Action::Stage {
                    paths: Vec::new(),
                    selection: Some(PatchSelection::Hunk {
                        path: "f.txt".into(),
                        diff_revision: unstaged_diff.diff_revision,
                        hunk_index: 1,
                    }),
                },
                confirmation_token: None,
            })
            .unwrap();

        let staged = fixture.git_output(&["diff", "--cached", "--", "f.txt"]);
        assert!(staged.contains("-old-b"));
        assert!(staged.contains("+new-b"));
        assert!(!staged.contains("old-a"));
        assert!(!staged.contains("new-a"));

        let staged_diff = match workspace
            .query(QueryRequest {
                repo_id: session.repo_id.clone(),
                query: Query::Diff {
                    target: DiffTarget::Staged,
                    paths: vec!["f.txt".into()],
                },
            })
            .unwrap()
        {
            QueryOutcome::Diff(diff) => diff,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        let unstaged_outcome = workspace
            .execute(ExecuteRequest {
                operation_id: "unstage-only-hunk".into(),
                repo_id: session.repo_id.clone(),
                expected_generation: staged_outcome.repo_generation,
                action: Action::Unstage {
                    paths: Vec::new(),
                    selection: Some(PatchSelection::Hunk {
                        path: "f.txt".into(),
                        diff_revision: staged_diff.diff_revision,
                        hunk_index: 0,
                    }),
                },
                confirmation_token: None,
            })
            .unwrap();

        assert!(
            fixture
                .git_output(&["diff", "--cached", "--", "f.txt"])
                .is_empty()
        );
        let unstaged = fixture.git_output(&["diff", "--", "f.txt"]);
        assert!(unstaged.contains("-old-a"));
        assert!(unstaged.contains("+new-a"));
        assert!(unstaged.contains("-old-b"));
        assert!(unstaged.contains("+new-b"));

        let discard_diff = match workspace
            .query(QueryRequest {
                repo_id: session.repo_id.clone(),
                query: Query::Diff {
                    target: DiffTarget::Unstaged,
                    paths: vec!["f.txt".into()],
                },
            })
            .unwrap()
        {
            QueryOutcome::Diff(diff) => diff,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        let discard_action = Action::Discard {
            paths: Vec::new(),
            target: DiscardTarget::Unstaged,
            selection: Some(PatchSelection::Hunk {
                path: "f.txt".into(),
                diff_revision: discard_diff.diff_revision,
                hunk_index: 1,
            }),
        };
        let discard_preview = workspace
            .preview(PreviewRequest {
                repo_id: session.repo_id.clone(),
                expected_generation: unstaged_outcome.repo_generation,
                action: discard_action.clone(),
            })
            .unwrap();
        workspace
            .execute(ExecuteRequest {
                operation_id: "discard-second-hunk".into(),
                repo_id: session.repo_id,
                expected_generation: unstaged_outcome.repo_generation,
                action: discard_action,
                confirmation_token: discard_preview.confirmation_token,
            })
            .unwrap();

        let after_discard = fs::read_to_string(fixture.repo.join("f.txt")).unwrap();
        assert!(after_discard.contains("new-a"));
        assert!(after_discard.contains("old-b"));
        assert!(!after_discard.contains("new-b"));
    }

    #[test]
    fn untracked_diff_supports_partial_text_binary_and_size_limits() {
        let fixture = GitFixture::new();
        fixture.write("tracked.txt", "base\n");
        fixture.git(&["add", "--", "tracked.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        fixture.write("new.txt", "first\nsecond\n");
        fs::write(fixture.repo.join("binary.dat"), [0_u8, 1, 2, 3]).unwrap();
        fs::write(fixture.repo.join("large.txt"), vec![b'x'; DIFF_LIMIT + 1]).unwrap();

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let text_diff = diff_for_path(&workspace, &attached.repo_id, "new.txt");
        assert!(text_diff.patch.contains("new file mode 100644"));
        assert!(text_diff.patch.contains("--- /dev/null"));
        assert!(text_diff.patch.contains("+++ b/new.txt"));
        assert!(text_diff.patch.contains("+first"));
        assert!(!text_diff.truncated);

        workspace
            .execute(ExecuteRequest {
                operation_id: "stage-untracked-line".into(),
                repo_id: attached.repo_id.clone(),
                expected_generation: text_diff.repo_generation,
                action: Action::Stage {
                    paths: Vec::new(),
                    selection: Some(PatchSelection::Lines {
                        path: "new.txt".into(),
                        diff_revision: text_diff.diff_revision,
                        side: SelectionSide::Additions,
                        start_line: 2,
                        end_line: 2,
                    }),
                },
                confirmation_token: None,
            })
            .unwrap();
        assert_eq!(fixture.git_output(&["show", ":new.txt"]), "second");

        let binary = diff_for_path(&workspace, &attached.repo_id, "binary.dat");
        assert!(binary.patch.contains("GIT binary patch"));
        assert!(!binary.truncated);
        let large = diff_for_path(&workspace, &attached.repo_id, "large.txt");
        assert!(large.truncated);
        assert!(large.patch.contains("content omitted"));
    }

    #[test]
    fn hard_reset_preview_token_binds_repo_action_and_generation() {
        let first = GitFixture::new();
        first.write("f.txt", "first\n");
        first.git(&["add", "--", "f.txt"]);
        first.git(&["commit", "-m", "feat: first"]);
        let second = GitFixture::new();
        second.write("f.txt", "second\n");
        second.git(&["add", "--", "f.txt"]);
        second.git(&["commit", "-m", "feat: second"]);
        let workspace = first.workspace();
        let first_session = workspace
            .attach(
                OpenRequest::Open {
                    path: first.repo_string(),
                },
                None,
            )
            .unwrap();
        let second_session = workspace
            .attach(
                OpenRequest::Open {
                    path: second.repo_string(),
                },
                None,
            )
            .unwrap();
        let hard_head = Action::Reset {
            commit: "HEAD".into(),
            mode: ResetMode::Hard,
        };

        let repo_token = preview_token(
            &workspace,
            &first_session.repo_id,
            first_session.snapshot.repo_generation,
            hard_head.clone(),
        );
        let wrong_repo = workspace
            .execute(ExecuteRequest {
                operation_id: "wrong-reset-repo".into(),
                repo_id: second_session.repo_id,
                expected_generation: second_session.snapshot.repo_generation,
                action: hard_head.clone(),
                confirmation_token: Some(repo_token),
            })
            .unwrap_err();
        assert_eq!(wrong_repo.code, ErrorCode::PreviewMismatch);

        let action_token = preview_token(
            &workspace,
            &first_session.repo_id,
            first_session.snapshot.repo_generation,
            hard_head.clone(),
        );
        let wrong_action = workspace
            .execute(ExecuteRequest {
                operation_id: "wrong-reset-action".into(),
                repo_id: first_session.repo_id.clone(),
                expected_generation: first_session.snapshot.repo_generation,
                action: Action::Reset {
                    commit: "main".into(),
                    mode: ResetMode::Hard,
                },
                confirmation_token: Some(action_token),
            })
            .unwrap_err();
        assert_eq!(wrong_action.code, ErrorCode::PreviewMismatch);

        let generation_token = preview_token(
            &workspace,
            &first_session.repo_id,
            first_session.snapshot.repo_generation,
            hard_head.clone(),
        );
        first.write("dirty.txt", "changed after preview\n");
        let current = match workspace
            .query(QueryRequest {
                repo_id: first_session.repo_id.clone(),
                query: Query::Status,
            })
            .unwrap()
        {
            QueryOutcome::Status(snapshot) => snapshot,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        let wrong_generation = workspace
            .execute(ExecuteRequest {
                operation_id: "wrong-reset-generation".into(),
                repo_id: first_session.repo_id,
                expected_generation: current.repo_generation,
                action: hard_head,
                confirmation_token: Some(generation_token),
            })
            .unwrap_err();
        assert_eq!(wrong_generation.code, ErrorCode::PreviewMismatch);
    }

    #[test]
    fn content_changes_advance_generation_and_invalidate_a_discard_preview() {
        let fixture = GitFixture::new();
        fixture.write("f.txt", "base\n");
        fixture.git(&["add", "--", "f.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        fixture.write("f.txt", "first dirty value\n");
        let timestamp_reference = fixture.temp.path().join("original-timestamp");
        fs::write(&timestamp_reference, b"timestamp reference").unwrap();
        let touch = Command::new("/usr/bin/touch")
            .args([
                "-r",
                fixture.repo.join("f.txt").to_str().unwrap(),
                timestamp_reference.to_str().unwrap(),
            ])
            .output()
            .unwrap();
        assert!(touch.status.success());
        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let action = Action::Discard {
            paths: vec!["f.txt".into()],
            target: DiscardTarget::Unstaged,
            selection: None,
        };
        let preview = workspace
            .preview(PreviewRequest {
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action: action.clone(),
            })
            .unwrap();
        assert!(preview.impact_digest.is_some());
        assert_eq!(preview.affected_paths, ["f.txt"]);

        let changed = "other dirty value\n";
        assert_eq!(changed.len(), "first dirty value\n".len());
        fixture.write("f.txt", changed);
        let touch = Command::new("/usr/bin/touch")
            .args([
                "-r",
                timestamp_reference.to_str().unwrap(),
                fixture.repo.join("f.txt").to_str().unwrap(),
            ])
            .output()
            .unwrap();
        assert!(touch.status.success());
        let current = match workspace
            .query(QueryRequest {
                repo_id: attached.repo_id.clone(),
                query: Query::Status,
            })
            .unwrap()
        {
            QueryOutcome::Status(snapshot) => snapshot,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        assert!(current.repo_generation > attached.snapshot.repo_generation);
        let error = workspace
            .execute(ExecuteRequest {
                operation_id: "stale-discard-content".into(),
                repo_id: attached.repo_id,
                expected_generation: current.repo_generation,
                action,
                confirmation_token: preview.confirmation_token,
            })
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::PreviewMismatch);
        assert_eq!(
            fs::read_to_string(fixture.repo.join("f.txt")).unwrap(),
            changed
        );
        let retry = workspace
            .preview(PreviewRequest {
                repo_id: current.repo_id.clone(),
                expected_generation: current.repo_generation,
                action: Action::Discard {
                    paths: vec!["f.txt".into()],
                    target: DiscardTarget::Unstaged,
                    selection: None,
                },
            })
            .unwrap();
        assert_ne!(retry.impact_digest, preview.impact_digest);
        workspace
            .execute(ExecuteRequest {
                operation_id: "confirmed-discard-content".into(),
                repo_id: current.repo_id,
                expected_generation: current.repo_generation,
                action: Action::Discard {
                    paths: vec!["f.txt".into()],
                    target: DiscardTarget::Unstaged,
                    selection: None,
                },
                confirmation_token: retry.confirmation_token,
            })
            .unwrap();
        assert_eq!(
            fs::read_to_string(fixture.repo.join("f.txt")).unwrap(),
            "base\n"
        );
    }

    #[test]
    fn same_shape_external_index_update_advances_generation() {
        let fixture = GitFixture::new();
        fixture.write("f.txt", "base\n");
        fixture.git(&["add", "--", "f.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        fixture.write("f.txt", "worktree\n");

        let first_blob_path = fixture.temp.path().join("first-index-blob");
        fs::write(&first_blob_path, b"staged-a\n").unwrap();
        let first_oid =
            fixture.git_output(&["hash-object", "-w", first_blob_path.to_str().unwrap()]);
        let first_cache = format!("100644,{first_oid},f.txt");
        fixture.git(&["update-index", "--add", "--cacheinfo", &first_cache]);

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();

        let second_blob_path = fixture.temp.path().join("second-index-blob");
        fs::write(&second_blob_path, b"staged-b\n").unwrap();
        let second_oid =
            fixture.git_output(&["hash-object", "-w", second_blob_path.to_str().unwrap()]);
        let second_cache = format!("100644,{second_oid},f.txt");
        fixture.git(&["update-index", "--add", "--cacheinfo", &second_cache]);

        let current = match workspace
            .query(QueryRequest {
                repo_id: attached.repo_id.clone(),
                query: Query::Status,
            })
            .unwrap()
        {
            QueryOutcome::Status(snapshot) => snapshot,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        assert_eq!(current.entries, attached.snapshot.entries);
        assert!(current.repo_generation > attached.snapshot.repo_generation);
    }

    #[test]
    fn polling_a_huge_untracked_file_does_not_open_its_contents() {
        let fixture = GitFixture::new();
        let path = fixture.repo.join("huge-untracked.bin");
        let file = File::create(&path).unwrap();
        file.set_len(8 * 1024 * 1024 * 1024).unwrap();
        drop(file);
        fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).unwrap();

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        assert!(
            attached
                .snapshot
                .entries
                .iter()
                .any(|entry| { entry.path == "huge-untracked.bin" && entry.untracked })
        );
        let current = match workspace
            .query(QueryRequest {
                repo_id: attached.repo_id,
                query: Query::Status,
            })
            .unwrap()
        {
            QueryOutcome::Status(snapshot) => snapshot,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        assert_eq!(current.repo_generation, attached.snapshot.repo_generation);
    }

    #[test]
    fn exact_worktree_digest_honors_cancellation() {
        let fixture = GitFixture::new();
        fixture.write("large.txt", &"x".repeat(256 * 1024));
        let control = RunControl::new();
        control.cancel();
        let error = worktree_entry_digest(&fixture.repo, "large.txt", Some(&control)).unwrap_err();
        assert_eq!(error.code, ErrorCode::Cancelled);
    }

    #[test]
    fn move_to_trash_preview_is_bound_to_the_exact_file_content() {
        let fixture = GitFixture::new();
        fixture.write("target.txt", "first value\n");
        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let action = Action::FileAction {
            paths: vec!["target.txt".into()],
            operation: FileOperation::MoveToTrash,
        };
        let preview = workspace
            .preview(PreviewRequest {
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action: action.clone(),
            })
            .unwrap();
        assert!(preview.destructive);
        assert_eq!(preview.affected_paths, ["target.txt"]);
        assert!(preview.impact_digest.is_some());

        fixture.write("target.txt", "other value\n");
        let request = ExecuteRequest {
            operation_id: "stale-trash-content".into(),
            repo_id: attached.repo_id.clone(),
            expected_generation: attached.snapshot.repo_generation,
            action,
            confirmation_token: preview.confirmation_token,
        };
        let repo = workspace.repo(&attached.repo_id).unwrap();
        let error = workspace
            .consume_preview(
                &repo,
                &attached.snapshot,
                &request,
                attached.snapshot.repo_generation,
                &RunControl::new(),
            )
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::PreviewMismatch);
        assert_eq!(
            fs::read_to_string(fixture.repo.join("target.txt")).unwrap(),
            "other value\n"
        );
    }

    #[test]
    fn move_to_trash_preview_includes_every_selected_file() {
        let fixture = GitFixture::new();
        fixture.write("first.txt", "first\n");
        fixture.write("second.txt", "second\n");
        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let preview = workspace
            .preview(PreviewRequest {
                repo_id: attached.repo_id,
                expected_generation: attached.snapshot.repo_generation,
                action: Action::FileAction {
                    paths: vec!["first.txt".into(), "second.txt".into()],
                    operation: FileOperation::MoveToTrash,
                },
            })
            .unwrap();

        assert!(preview.destructive);
        assert_eq!(preview.affected_paths, ["first.txt", "second.txt"]);
        assert_eq!(
            preview.summary,
            LocalizedMessage::new("previewDeleteFiles").number_arg("count", 2)
        );
        assert!(preview.confirmation_token.is_some());
    }

    #[test]
    fn move_to_trash_preview_token_cannot_be_reused_for_another_path() {
        let fixture = GitFixture::new();
        fixture.write("first.txt", "first\n");
        fixture.write("second.txt", "second\n");
        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let preview = workspace
            .preview(PreviewRequest {
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action: Action::FileAction {
                    paths: vec!["first.txt".into()],
                    operation: FileOperation::MoveToTrash,
                },
            })
            .unwrap();
        let repo = workspace.repo(&attached.repo_id).unwrap();
        let error = workspace
            .consume_preview(
                &repo,
                &attached.snapshot,
                &ExecuteRequest {
                    operation_id: "cross-path-trash".into(),
                    repo_id: attached.repo_id.clone(),
                    expected_generation: attached.snapshot.repo_generation,
                    action: Action::FileAction {
                        paths: vec!["second.txt".into()],
                        operation: FileOperation::MoveToTrash,
                    },
                    confirmation_token: preview.confirmation_token,
                },
                attached.snapshot.repo_generation,
                &RunControl::new(),
            )
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::PreviewMismatch);
        assert!(fixture.repo.join("first.txt").exists());
        assert!(fixture.repo.join("second.txt").exists());
    }

    #[test]
    fn execute_preview_revalidation_propagates_cancellation() {
        let fixture = GitFixture::new();
        fixture.write("untracked.txt", "content\n");
        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let action = Action::Discard {
            paths: vec!["untracked.txt".into()],
            target: DiscardTarget::Untracked,
            selection: None,
        };
        let preview = workspace
            .preview(PreviewRequest {
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action: action.clone(),
            })
            .unwrap();
        let request = ExecuteRequest {
            operation_id: "cancel-preview-revalidation".into(),
            repo_id: attached.repo_id.clone(),
            expected_generation: attached.snapshot.repo_generation,
            action,
            confirmation_token: preview.confirmation_token,
        };
        let control = RunControl::new();
        control.cancel();
        let repo = workspace.repo(&attached.repo_id).unwrap();
        let error = workspace
            .consume_preview(
                &repo,
                &attached.snapshot,
                &request,
                attached.snapshot.repo_generation,
                &control,
            )
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::Cancelled);
    }

    #[test]
    fn fast_forward_pull_preserves_non_conflicting_uncommitted_changes() {
        let fixture = GitFixture::new();
        fixture.write("local.txt", "base\n");
        fixture.git(&["add", "--", "local.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        let bare = fixture.temp.path().join("dirty-pull.git");
        run_git(
            fixture.temp.path(),
            &["init", "--bare", "-b", "main", bare.to_str().unwrap()],
        );
        fixture.git(&["remote", "add", "origin", bare.to_str().unwrap()]);
        fixture.git(&["push", "-u", "origin", "main"]);
        let other = fixture.temp.path().join("dirty-pull-other");
        run_git(
            fixture.temp.path(),
            &["clone", bare.to_str().unwrap(), other.to_str().unwrap()],
        );
        run_git(&other, &["config", "user.name", "Remote Test"]);
        run_git(&other, &["config", "user.email", "remote@example.test"]);
        fs::write(other.join("remote.txt"), "remote\n").unwrap();
        run_git(&other, &["add", "--", "remote.txt"]);
        run_git(&other, &["commit", "-m", "feat: remote"]);
        run_git(&other, &["push", "origin", "main"]);
        let remote_head = run_git_output(&other, &["rev-parse", "HEAD"]);
        fixture.write("local.txt", "uncommitted\n");

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        assert!(!attached.snapshot.entries.is_empty());
        workspace
            .execute(ExecuteRequest {
                operation_id: "pull-with-uncommitted-change".into(),
                repo_id: attached.repo_id,
                expected_generation: attached.snapshot.repo_generation,
                action: Action::Pull {
                    remote: "origin".into(),
                    remote_branch: "main".into(),
                },
                confirmation_token: None,
            })
            .unwrap();

        assert_eq!(fixture.git_output(&["rev-parse", "HEAD"]), remote_head);
        assert_eq!(
            fs::read_to_string(fixture.repo.join("local.txt")).unwrap(),
            "uncommitted\n"
        );
    }

    #[test]
    fn fast_forward_pull_rejects_conflicting_uncommitted_changes_without_overwriting_them() {
        let fixture = GitFixture::new();
        fixture.write("shared.txt", "base\n");
        fixture.git(&["add", "--", "shared.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        let local_head = fixture.git_output(&["rev-parse", "HEAD"]);
        let bare = fixture.temp.path().join("conflicting-dirty-pull.git");
        run_git(
            fixture.temp.path(),
            &["init", "--bare", "-b", "main", bare.to_str().unwrap()],
        );
        fixture.git(&["remote", "add", "origin", bare.to_str().unwrap()]);
        fixture.git(&["push", "-u", "origin", "main"]);
        let other = fixture.temp.path().join("conflicting-dirty-pull-other");
        run_git(
            fixture.temp.path(),
            &["clone", bare.to_str().unwrap(), other.to_str().unwrap()],
        );
        run_git(&other, &["config", "user.name", "Remote Test"]);
        run_git(&other, &["config", "user.email", "remote@example.test"]);
        fs::write(other.join("shared.txt"), "remote\n").unwrap();
        run_git(&other, &["add", "--", "shared.txt"]);
        run_git(&other, &["commit", "-m", "feat: remote"]);
        run_git(&other, &["push", "origin", "main"]);
        fixture.write("shared.txt", "uncommitted\n");

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let error = workspace
            .execute(ExecuteRequest {
                operation_id: "reject-conflicting-uncommitted-pull".into(),
                repo_id: attached.repo_id,
                expected_generation: attached.snapshot.repo_generation,
                action: Action::Pull {
                    remote: "origin".into(),
                    remote_branch: "main".into(),
                },
                confirmation_token: None,
            })
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::GitFailed);
        assert_eq!(fixture.git_output(&["rev-parse", "HEAD"]), local_head);
        assert_eq!(
            fs::read_to_string(fixture.repo.join("shared.txt")).unwrap(),
            "uncommitted\n"
        );
    }

    #[test]
    fn real_remote_divergence_is_reported_and_pull_remains_fast_forward_only() {
        let fixture = GitFixture::new();
        fixture.write("f.txt", "base\n");
        fixture.git(&["add", "--", "f.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        let bare = fixture.temp.path().join("remote.git");
        run_git(
            fixture.temp.path(),
            &["init", "--bare", "-b", "main", bare.to_str().unwrap()],
        );
        fixture.git(&["remote", "add", "origin", bare.to_str().unwrap()]);
        fixture.git(&["push", "-u", "origin", "main"]);
        let other = fixture.temp.path().join("other");
        run_git(
            fixture.temp.path(),
            &["clone", bare.to_str().unwrap(), other.to_str().unwrap()],
        );
        run_git(&other, &["config", "user.name", "Remote Test"]);
        run_git(&other, &["config", "user.email", "remote@example.test"]);
        fs::write(other.join("remote.txt"), "remote\n").unwrap();
        run_git(&other, &["add", "--", "remote.txt"]);
        run_git(&other, &["commit", "-m", "feat: remote"]);
        run_git(&other, &["push", "origin", "main"]);
        fixture.write("local.txt", "local\n");
        fixture.git(&["add", "--", "local.txt"]);
        fixture.git(&["commit", "-m", "feat: local"]);
        let local_head = fixture.git_output(&["rev-parse", "HEAD"]);

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let fetched = workspace
            .execute(ExecuteRequest {
                operation_id: "fetch-diverged".into(),
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action: Action::Fetch {
                    remote: "origin".into(),
                },
                confirmation_token: None,
            })
            .unwrap();
        assert_eq!((fetched.snapshot.ahead, fetched.snapshot.behind), (1, 1));
        let error = workspace
            .execute(ExecuteRequest {
                operation_id: "pull-diverged".into(),
                repo_id: attached.repo_id,
                expected_generation: fetched.repo_generation,
                action: Action::Pull {
                    remote: "origin".into(),
                    remote_branch: "main".into(),
                },
                confirmation_token: None,
            })
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::PullDiverged);
        assert_eq!(fixture.git_output(&["rev-parse", "HEAD"]), local_head);
    }

    #[test]
    fn polling_during_fetch_does_not_make_the_fetch_generation_stale() {
        let fixture = GitFixture::new();
        fixture.write("f.txt", "base\n");
        fixture.git(&["add", "--", "f.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        let bare = fixture.temp.path().join("polling-fetch.git");
        run_git(
            fixture.temp.path(),
            &["init", "--bare", "-b", "main", bare.to_str().unwrap()],
        );
        fixture.git(&["remote", "add", "origin", bare.to_str().unwrap()]);
        fixture.git(&["push", "-u", "origin", "main"]);
        let peer = fixture.temp.path().join("polling-fetch-peer");
        run_git(
            fixture.temp.path(),
            &["clone", bare.to_str().unwrap(), peer.to_str().unwrap()],
        );
        run_git(&peer, &["config", "user.name", "Remote Test"]);
        run_git(&peer, &["config", "user.email", "remote@example.test"]);
        fs::write(peer.join("remote.txt"), "remote\n").unwrap();
        run_git(&peer, &["add", "--", "remote.txt"]);
        run_git(&peer, &["commit", "-m", "feat: remote"]);
        run_git(&peer, &["push", "origin", "main"]);

        let block_references = fixture.temp.path().join("block-references");
        let references_captured = fixture.temp.path().join("references-captured");
        let release_references = fixture.temp.path().join("release-references");
        let captured_references = fixture.temp.path().join("captured-references");
        let fetch_finished = fixture.temp.path().join("fetch-operation-finished");
        let wrapper = fixture.temp.path().join("interleaved-git");
        fs::write(
            &wrapper,
            format!(
                r#"#!/bin/sh
case "$*" in
  *"for-each-ref --format=%(refname)%00%(objectname) refs/heads refs/remotes refs/tags"*)
    if [ -f '{block_references}' ]; then
      /bin/rm '{block_references}'
      /usr/bin/git "$@" > '{captured_references}'
      status=$?
      : > '{references_captured}'
      while [ ! -f '{release_references}' ]; do /bin/sleep 0.01; done
      /bin/cat '{captured_references}'
      exit "$status"
    fi
    ;;
esac
exec /usr/bin/git "$@"
"#,
                block_references = block_references.display(),
                captured_references = captured_references.display(),
                references_captured = references_captured.display(),
                release_references = release_references.display(),
            ),
        )
        .unwrap();
        let mut permissions = fs::metadata(&wrapper).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&wrapper, permissions).unwrap();

        let workspace = Arc::new(Workspace::new(
            GitExecutor::at(wrapper),
            test_journal_store(&fixture.temp.path().join("polling-fetch-journal")).unwrap(),
        ));
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        fs::write(&block_references, "").unwrap();
        let polling_workspace = Arc::clone(&workspace);
        let polling_repo_id = attached.repo_id.clone();
        let polling = std::thread::spawn(move || {
            polling_workspace.query(QueryRequest {
                repo_id: polling_repo_id,
                query: Query::Status,
            })
        });
        for _ in 0..200 {
            if references_captured.is_file() {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(
            references_captured.is_file(),
            "polling snapshot did not pause"
        );

        let fetch_workspace = Arc::clone(&workspace);
        let fetch_repo_id = attached.repo_id.clone();
        let fetch_generation = attached.snapshot.repo_generation;
        let fetch_finished_marker = fetch_finished.clone();
        let fetch = std::thread::spawn(move || {
            let result = fetch_workspace.execute(ExecuteRequest {
                operation_id: "fetch-while-polling".into(),
                repo_id: fetch_repo_id,
                expected_generation: fetch_generation,
                action: Action::Fetch {
                    remote: "origin".into(),
                },
                confirmation_token: None,
            });
            fs::write(fetch_finished_marker, "").unwrap();
            result
        });
        for _ in 0..200 {
            if fetch_finished.is_file() {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        let fetch_overlapped_polling = fetch_finished.is_file();
        fs::write(&release_references, "").unwrap();
        polling.join().unwrap().unwrap();
        let fetched = fetch.join().unwrap().unwrap();

        let pulled = workspace.execute(ExecuteRequest {
            operation_id: "pull-after-polling".into(),
            repo_id: attached.repo_id,
            expected_generation: fetched.repo_generation,
            action: Action::Pull {
                remote: "origin".into(),
                remote_branch: "main".into(),
            },
            confirmation_token: None,
        });
        assert!(
            pulled.is_ok(),
            "Fetch overlapped a polling snapshot ({fetch_overlapped_polling}) and left a stale generation: {:?}",
            pulled.as_ref().err()
        );
        assert!(!fetch_overlapped_polling);
    }

    #[test]
    fn fast_forward_pull_preserves_ignored_directory_file_obstruction() {
        let fixture = GitFixture::new();
        fixture.write(".gitignore", "obstacle/\n");
        fixture.git(&["add", "--", ".gitignore"]);
        fixture.git(&["commit", "-m", "feat: pull obstruction base"]);
        let local_head = fixture.git_output(&["rev-parse", "HEAD"]);
        let bare = fixture.temp.path().join("pull-obstruction.git");
        run_git(
            fixture.temp.path(),
            &["init", "--bare", "-b", "main", bare.to_str().unwrap()],
        );
        fixture.git(&["remote", "add", "origin", bare.to_str().unwrap()]);
        fixture.git(&["push", "-u", "origin", "main"]);
        let other = fixture.temp.path().join("pull-obstruction-other");
        run_git(
            fixture.temp.path(),
            &["clone", bare.to_str().unwrap(), other.to_str().unwrap()],
        );
        run_git(&other, &["config", "user.name", "Remote Test"]);
        run_git(&other, &["config", "user.email", "remote@example.test"]);
        fs::write(other.join("obstacle"), "remote tracked blob\n").unwrap();
        run_git(&other, &["add", "--", "obstacle"]);
        run_git(&other, &["commit", "-m", "feat: remote obstacle"]);
        run_git(&other, &["push", "origin", "main"]);
        fs::create_dir(fixture.repo.join("obstacle")).unwrap();
        fixture.write("obstacle/secret.txt", "keep pull secret\n");

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        assert!(attached.snapshot.entries.is_empty());
        let error = workspace
            .execute(ExecuteRequest {
                operation_id: "reject-ignored-ff-pull".into(),
                repo_id: attached.repo_id,
                expected_generation: attached.snapshot.repo_generation,
                action: Action::Pull {
                    remote: "origin".into(),
                    remote_branch: "main".into(),
                },
                confirmation_token: None,
            })
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::GitFailed);
        assert_eq!(fixture.git_output(&["rev-parse", "HEAD"]), local_head);
        assert!(fixture.repo.join("obstacle/secret.txt").exists());
    }

    #[test]
    fn clone_emits_lifecycle_events_with_a_stable_temporary_repo_id() {
        let source = GitFixture::new();
        source.write("f.txt", "source\n");
        source.git(&["add", "--", "f.txt"]);
        source.git(&["commit", "-m", "feat: source"]);
        let destination = source.temp.path().join("cloned");
        let events = Arc::new(Mutex::new(Vec::new()));
        let workspace = source.workspace();
        let session = workspace
            .attach(
                OpenRequest::Clone {
                    remote: source.repo_string(),
                    destination: destination.display().to_string(),
                    operation_id: "clone-success".into(),
                },
                Some(capture_events(Arc::clone(&events))),
            )
            .unwrap();
        assert_eq!(
            fs::read_to_string(destination.join("f.txt")).unwrap(),
            "source\n"
        );
        let events = events.lock().unwrap();
        assert_eq!(events.first().unwrap().phase, EventPhase::Started);
        assert_eq!(events.last().unwrap().phase, EventPhase::Completed);
        assert!(events[..events.len() - 1].iter().all(|event| {
            event.repo_id == clone_temporary_repo_id(&destination)
                && event.operation_id.as_deref() == Some("clone-success")
        }));
        assert_eq!(events.last().unwrap().repo_id, session.repo_id);
        assert_eq!(
            events.last().unwrap().operation_id.as_deref(),
            Some("clone-success")
        );
        assert_eq!(
            events.last().unwrap().details.get("attachedRepoId"),
            Some(&session.repo_id)
        );
        assert_eq!(
            events.last().unwrap().details.get("exitCode"),
            Some(&"0".into())
        );
        assert!(
            events.last().unwrap().details["argv"].contains("clone"),
            "completed clone event must retain the redacted command activity"
        );
        assert!(events.last().unwrap().details.contains_key("stdout"));
        assert!(events.last().unwrap().details.contains_key("stderr"));
        assert_eq!(session.snapshot.event_seq, events.last().unwrap().event_seq);
        assert!(
            events
                .windows(2)
                .all(|pair| pair[0].event_seq < pair[1].event_seq)
        );
    }

    #[test]
    fn clone_can_be_cancelled_through_the_shared_operation_registry() {
        let temp = tempfile::tempdir().unwrap();
        let marker = temp.path().join("clone-started");
        let executable = temp.path().join("slow-git");
        fs::write(
            &executable,
            format!(
                "#!/bin/sh\nif [ \"$1\" = --literal-pathspecs ]; then\n  shift\nfi\nif [ \"$1\" = clone ]; then\n  printf started > '{}'\n  sleep 30\n  exit 0\nfi\nexit 1\n",
                marker.display()
            ),
        )
        .unwrap();
        let mut permissions = fs::metadata(&executable).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&executable, permissions).unwrap();
        let workspace = Arc::new(Workspace::new(
            GitExecutor::at(executable),
            test_journal_store(&temp.path().join("journal")).unwrap(),
        ));
        let events = Arc::new(Mutex::new(Vec::new()));
        let channel = capture_events(Arc::clone(&events));
        let destination = temp.path().join("cancelled-clone");
        let running = Arc::clone(&workspace);
        let handle = std::thread::spawn(move || {
            running.attach(
                OpenRequest::Clone {
                    remote: "slow-remote".into(),
                    destination: destination.display().to_string(),
                    operation_id: "clone-cancel".into(),
                },
                Some(channel),
            )
        });
        for _ in 0..100 {
            if marker.is_file()
                && events
                    .lock()
                    .unwrap()
                    .iter()
                    .any(|event| event.phase == EventPhase::Progress)
            {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(marker.is_file(), "clone process did not start");
        assert!(
            workspace
                .cancel(CancelRequest {
                    operation_id: "clone-cancel".into(),
                })
                .accepted
        );
        let error = handle.join().unwrap().unwrap_err();
        assert_eq!(error.code, ErrorCode::Cancelled);
        assert!(
            !workspace
                .cancel(CancelRequest {
                    operation_id: "clone-cancel".into(),
                })
                .accepted
        );
        let events = events.lock().unwrap();
        assert!(
            events
                .iter()
                .any(|event| event.phase == EventPhase::Progress)
        );
        assert_eq!(events.last().unwrap().phase, EventPhase::Cancelled);
        assert!(events.iter().all(|event| {
            event.repo_id == clone_temporary_repo_id(temp.path().join("cancelled-clone").as_path())
                && event.operation_id.as_deref() == Some("clone-cancel")
        }));
    }

    #[test]
    fn polling_detects_a_non_head_ref_move_and_invalidates_its_preview() {
        let fixture = GitFixture::new();
        fixture.write("f.txt", "base\n");
        fixture.git(&["add", "--", "f.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        fixture.git(&["switch", "-c", "topic"]);
        fixture.write("f.txt", "topic\n");
        fixture.git(&["commit", "-am", "feat: topic"]);
        let original_target = fixture.git_output(&["rev-parse", "HEAD"]);
        let topic_tree = fixture.git_output(&["rev-parse", "HEAD^{tree}"]);
        fixture.git(&["switch", "main"]);

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let action = Action::Merge {
            source: "topic".into(),
            commit_immediately: false,
        };
        let preview = workspace
            .preview(PreviewRequest {
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action: action.clone(),
            })
            .unwrap();
        assert_eq!(preview.resolved_targets[0].oid, original_target);
        assert!(preview.impact_digest.is_some());
        assert!(preview.affected_paths.contains(&"f.txt".to_owned()));

        let moved_target = fixture.git_output(&[
            "commit-tree",
            &topic_tree,
            "-p",
            &original_target,
            "-m",
            "feat: move target",
        ]);
        fixture.git(&["branch", "-f", "topic", &moved_target]);
        let refreshed_generation = match workspace
            .query(QueryRequest {
                repo_id: attached.repo_id.clone(),
                query: Query::Status,
            })
            .unwrap()
        {
            QueryOutcome::Status(snapshot) => snapshot.repo_generation,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        assert!(refreshed_generation > attached.snapshot.repo_generation);

        let error = workspace
            .execute(ExecuteRequest {
                operation_id: "moved-target".into(),
                repo_id: attached.repo_id,
                expected_generation: refreshed_generation,
                action,
                confirmation_token: preview.confirmation_token,
            })
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::PreviewMismatch);
        assert_eq!(
            fixture.git_output(&["rev-parse", "HEAD"]),
            fixture.git_output(&["rev-parse", "main"])
        );
    }

    #[test]
    fn hard_reset_preview_reports_lost_commits_and_affected_paths() {
        let fixture = GitFixture::new();
        fixture.write("f.txt", "base\n");
        fixture.git(&["add", "--", "f.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        let base = fixture.git_output(&["rev-parse", "HEAD"]);
        fixture.write("f.txt", "second\n");
        fixture.git(&["commit", "-am", "feat: second"]);
        let head = fixture.git_output(&["rev-parse", "HEAD"]);

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let preview = workspace
            .preview(PreviewRequest {
                repo_id: attached.repo_id,
                expected_generation: attached.snapshot.repo_generation,
                action: Action::Reset {
                    commit: base.clone(),
                    mode: ResetMode::Hard,
                },
            })
            .unwrap();
        assert_eq!(preview.resolved_targets[0].oid, base);
        assert!(preview.lost_commit_oids.contains(&head));
        assert!(preview.affected_commits.contains(&head));
        assert!(preview.affected_paths.contains(&"f.txt".to_owned()));
        assert_eq!(preview.impact_digest.as_deref().map(str::len), Some(64));
        assert!(preview.confirmation_token.is_some());
    }

    #[test]
    fn hard_reset_binds_an_exact_untracked_overwrite_and_invalidates_after_edit() {
        let fixture = GitFixture::new();
        fixture.write("lost.txt", "target content\n");
        fixture.git(&["add", "--", "lost.txt"]);
        fixture.git(&["commit", "-m", "feat: add target file"]);
        let target = fixture.git_output(&["rev-parse", "HEAD"]);
        fixture.git(&["rm", "--", "lost.txt"]);
        fixture.git(&["commit", "-m", "feat: remove target file"]);
        fixture.write("lost.txt", "first secret\n");

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        assert!(
            attached
                .snapshot
                .entries
                .iter()
                .any(|entry| { entry.path == "lost.txt" && entry.untracked })
        );
        let action = Action::Reset {
            commit: target,
            mode: ResetMode::Hard,
        };
        let preview = workspace
            .preview(PreviewRequest {
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action: action.clone(),
            })
            .unwrap();
        assert!(preview.affected_paths.contains(&"lost.txt".to_owned()));

        let changed = "other secret\n";
        assert_eq!(changed.len(), "first secret\n".len());
        fixture.write("lost.txt", changed);
        let current = match workspace
            .query(QueryRequest {
                repo_id: attached.repo_id.clone(),
                query: Query::Status,
            })
            .unwrap()
        {
            QueryOutcome::Status(snapshot) => snapshot,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        assert!(current.repo_generation > attached.snapshot.repo_generation);
        let error = workspace
            .execute(ExecuteRequest {
                operation_id: "stale-hard-reset-untracked".into(),
                repo_id: attached.repo_id.clone(),
                expected_generation: current.repo_generation,
                action: action.clone(),
                confirmation_token: preview.confirmation_token,
            })
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::PreviewMismatch);
        assert_eq!(
            fs::read_to_string(fixture.repo.join("lost.txt")).unwrap(),
            changed
        );

        let retry = workspace
            .preview(PreviewRequest {
                repo_id: attached.repo_id.clone(),
                expected_generation: current.repo_generation,
                action: action.clone(),
            })
            .unwrap();
        assert_ne!(retry.impact_digest, preview.impact_digest);
        workspace
            .execute(ExecuteRequest {
                operation_id: "confirmed-hard-reset-untracked".into(),
                repo_id: attached.repo_id,
                expected_generation: current.repo_generation,
                action,
                confirmation_token: retry.confirmation_token,
            })
            .unwrap();
        assert_eq!(
            fs::read_to_string(fixture.repo.join("lost.txt")).unwrap(),
            "target content\n"
        );
    }

    #[test]
    fn hard_reset_binds_untracked_child_and_status_lists_the_leaf() {
        let fixture = GitFixture::new();
        fixture.write("obstacle", "target\n");
        fixture.git(&["add", "--", "obstacle"]);
        fixture.git(&["commit", "-m", "feat: add obstacle file"]);
        let target = fixture.git_output(&["rev-parse", "HEAD"]);
        fixture.git(&["rm", "--", "obstacle"]);
        fixture.git(&["commit", "-m", "feat: remove obstacle file"]);
        fs::create_dir(fixture.repo.join("obstacle")).unwrap();
        fixture.write("obstacle/secret.txt", "keep me\n");

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        assert!(
            attached
                .snapshot
                .entries
                .iter()
                .any(|entry| { entry.path == "obstacle/secret.txt" && entry.untracked })
        );
        assert!(
            !attached
                .snapshot
                .entries
                .iter()
                .any(|entry| entry.path == "obstacle/")
        );
        let action = Action::Reset {
            commit: target,
            mode: ResetMode::Hard,
        };
        let preview = workspace
            .preview(PreviewRequest {
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action: action.clone(),
            })
            .unwrap();
        assert!(
            preview
                .affected_paths
                .contains(&"obstacle/secret.txt".to_owned())
        );

        fixture.write("obstacle/secret.txt", "edit me\n");
        let current = match workspace
            .query(QueryRequest {
                repo_id: attached.repo_id.clone(),
                query: Query::Status,
            })
            .unwrap()
        {
            QueryOutcome::Status(snapshot) => snapshot,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        let stale = workspace
            .execute(ExecuteRequest {
                operation_id: "stale-hard-reset-child".into(),
                repo_id: attached.repo_id.clone(),
                expected_generation: current.repo_generation,
                action: action.clone(),
                confirmation_token: preview.confirmation_token,
            })
            .unwrap_err();
        assert_eq!(stale.code, ErrorCode::PreviewMismatch);
        assert_eq!(
            fs::read_to_string(fixture.repo.join("obstacle/secret.txt")).unwrap(),
            "edit me\n"
        );

        let retry = workspace
            .preview(PreviewRequest {
                repo_id: attached.repo_id.clone(),
                expected_generation: current.repo_generation,
                action: action.clone(),
            })
            .unwrap();
        workspace
            .execute(ExecuteRequest {
                operation_id: "confirmed-hard-reset-child".into(),
                repo_id: attached.repo_id,
                expected_generation: current.repo_generation,
                action,
                confirmation_token: retry.confirmation_token,
            })
            .unwrap();
        assert_eq!(
            fs::read_to_string(fixture.repo.join("obstacle")).unwrap(),
            "target\n"
        );
    }

    #[test]
    fn hard_reset_rejects_ignored_directory_file_obstruction_missing_from_status() {
        let fixture = GitFixture::new();
        fixture.write(".gitignore", "obstacle/\n");
        fixture.write("obstacle", "target\n");
        fixture.git(&["add", "--", ".gitignore", "obstacle"]);
        fixture.git(&["commit", "-m", "feat: add ignored obstacle target"]);
        let target = fixture.git_output(&["rev-parse", "HEAD"]);
        fixture.git(&["rm", "--", "obstacle"]);
        fixture.git(&["commit", "-m", "feat: remove ignored obstacle target"]);
        fs::create_dir(fixture.repo.join("obstacle")).unwrap();
        fixture.write("obstacle/secret.txt", "ignored secret\n");

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        assert!(attached.snapshot.entries.is_empty());
        let error = workspace
            .preview(PreviewRequest {
                repo_id: attached.repo_id,
                expected_generation: attached.snapshot.repo_generation,
                action: Action::Reset {
                    commit: target,
                    mode: ResetMode::Hard,
                },
            })
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidRequest);
        assert!(fixture.repo.join("obstacle/secret.txt").exists());
    }

    #[test]
    fn hard_reset_execute_rechecks_an_ignored_obstruction_created_after_preview() {
        let fixture = GitFixture::new();
        fixture.write(".gitignore", "obstacle/\n");
        fixture.write("obstacle", "target\n");
        fixture.git(&["add", "--", ".gitignore", "obstacle"]);
        fixture.git(&["commit", "-m", "feat: add execute guard target"]);
        let target = fixture.git_output(&["rev-parse", "HEAD"]);
        fixture.git(&["rm", "--", "obstacle"]);
        fixture.git(&["commit", "-m", "feat: remove execute guard target"]);

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let action = Action::Reset {
            commit: target,
            mode: ResetMode::Hard,
        };
        let preview = workspace
            .preview(PreviewRequest {
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action: action.clone(),
            })
            .unwrap();
        fs::create_dir(fixture.repo.join("obstacle")).unwrap();
        fixture.write("obstacle/secret.txt", "late ignored secret\n");
        let current = match workspace
            .query(QueryRequest {
                repo_id: attached.repo_id.clone(),
                query: Query::Status,
            })
            .unwrap()
        {
            QueryOutcome::Status(snapshot) => snapshot,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        assert_eq!(
            current.repo_generation, attached.snapshot.repo_generation,
            "ignored path is intentionally absent from the polling snapshot"
        );
        let error = workspace
            .execute(ExecuteRequest {
                operation_id: "execute-rechecks-ignored-obstruction".into(),
                repo_id: attached.repo_id,
                expected_generation: current.repo_generation,
                action,
                confirmation_token: preview.confirmation_token,
            })
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidRequest);
        assert!(fixture.repo.join("obstacle/secret.txt").exists());
    }

    #[test]
    fn hard_reset_allows_clean_tracked_file_directory_transitions() {
        let file_to_directory = GitFixture::new();
        file_to_directory.write("node", "tracked file\n");
        file_to_directory.git(&["add", "--", "node"]);
        file_to_directory.git(&["commit", "-m", "feat: tracked file shape"]);
        let file_oid = file_to_directory.git_output(&["rev-parse", "HEAD"]);
        file_to_directory.git(&["rm", "--", "node"]);
        fs::create_dir(file_to_directory.repo.join("node")).unwrap();
        file_to_directory.write("node/child.txt", "tracked child\n");
        file_to_directory.git(&["add", "--", "node/child.txt"]);
        file_to_directory.git(&["commit", "-m", "feat: tracked directory shape"]);
        let directory_oid = file_to_directory.git_output(&["rev-parse", "HEAD"]);
        file_to_directory.git(&["reset", "--hard", &file_oid]);

        let workspace = file_to_directory.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: file_to_directory.repo_string(),
                },
                None,
            )
            .unwrap();
        let action = Action::Reset {
            commit: directory_oid,
            mode: ResetMode::Hard,
        };
        let preview = workspace
            .preview(PreviewRequest {
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action: action.clone(),
            })
            .unwrap();
        assert!(preview.affected_paths.contains(&"node".to_owned()));
        assert!(
            preview
                .affected_paths
                .contains(&"node/child.txt".to_owned())
        );
        workspace
            .execute(ExecuteRequest {
                operation_id: "tracked-file-to-directory".into(),
                repo_id: attached.repo_id,
                expected_generation: attached.snapshot.repo_generation,
                action,
                confirmation_token: preview.confirmation_token,
            })
            .unwrap();
        assert_eq!(
            fs::read_to_string(file_to_directory.repo.join("node/child.txt")).unwrap(),
            "tracked child\n"
        );

        let directory_to_file = GitFixture::new();
        directory_to_file.write("node", "target file\n");
        directory_to_file.git(&["add", "--", "node"]);
        directory_to_file.git(&["commit", "-m", "feat: target file shape"]);
        let target_file_oid = directory_to_file.git_output(&["rev-parse", "HEAD"]);
        directory_to_file.git(&["rm", "--", "node"]);
        fs::create_dir(directory_to_file.repo.join("node")).unwrap();
        directory_to_file.write("node/tracked.txt", "current tracked child\n");
        directory_to_file.git(&["add", "--", "node/tracked.txt"]);
        directory_to_file.git(&["commit", "-m", "feat: current directory shape"]);

        let workspace = directory_to_file.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: directory_to_file.repo_string(),
                },
                None,
            )
            .unwrap();
        let action = Action::Reset {
            commit: target_file_oid,
            mode: ResetMode::Hard,
        };
        let preview = workspace
            .preview(PreviewRequest {
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action: action.clone(),
            })
            .unwrap();
        assert!(
            preview
                .affected_paths
                .contains(&"node/tracked.txt".to_owned())
        );
        workspace
            .execute(ExecuteRequest {
                operation_id: "tracked-directory-to-file".into(),
                repo_id: attached.repo_id,
                expected_generation: attached.snapshot.repo_generation,
                action,
                confirmation_token: preview.confirmation_token,
            })
            .unwrap();
        assert_eq!(
            fs::read_to_string(directory_to_file.repo.join("node")).unwrap(),
            "target file\n"
        );
    }

    #[test]
    fn hard_reset_rejects_ignored_leaf_inside_otherwise_tracked_directory() {
        let fixture = GitFixture::new();
        fixture.write(".gitignore", "node/secret.txt\n");
        fixture.write("node", "target file\n");
        fixture.git(&["add", "--", ".gitignore", "node"]);
        fixture.git(&["commit", "-m", "feat: target tracked file"]);
        let target = fixture.git_output(&["rev-parse", "HEAD"]);
        fixture.git(&["rm", "--", "node"]);
        fs::create_dir(fixture.repo.join("node")).unwrap();
        fixture.write("node/tracked.txt", "tracked child\n");
        fixture.git(&["add", "--", "node/tracked.txt"]);
        fixture.git(&["commit", "-m", "feat: current tracked directory"]);
        fixture.write("node/secret.txt", "ignored child\n");

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        assert!(attached.snapshot.entries.is_empty());
        let error = workspace
            .preview(PreviewRequest {
                repo_id: attached.repo_id,
                expected_generation: attached.snapshot.repo_generation,
                action: Action::Reset {
                    commit: target,
                    mode: ResetMode::Hard,
                },
            })
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidRequest);
        assert_eq!(
            error.details.get("obstructionPath").map(String::as_str),
            Some("node/secret.txt")
        );
        assert!(fixture.repo.join("node/secret.txt").exists());
    }

    #[test]
    fn hard_reset_rejects_ignored_leaf_after_tracked_file_becomes_a_directory() {
        let fixture = GitFixture::new();
        fixture.write(".gitignore", "node/secret.txt\n");
        fixture.write("node", "current tracked file\n");
        fixture.git(&["add", "--", ".gitignore", "node"]);
        fixture.git(&["commit", "-m", "feat: tracked file before transition"]);
        fixture.git(&["switch", "-c", "target"]);
        fixture.git(&["rm", "--", "node"]);
        fs::create_dir(fixture.repo.join("node")).unwrap();
        fixture.write("node/child.txt", "target tracked child\n");
        fixture.git(&["add", "--", "node/child.txt"]);
        fixture.git(&["commit", "-m", "feat: target tracked directory"]);
        fixture.git(&["switch", "main"]);
        fs::remove_file(fixture.repo.join("node")).unwrap();
        fs::create_dir(fixture.repo.join("node")).unwrap();
        fixture.write("node/secret.txt", "keep type-change secret\n");

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        assert!(
            attached
                .snapshot
                .entries
                .iter()
                .any(|entry| entry.path == "node" && !entry.untracked)
        );
        assert!(
            !attached
                .snapshot
                .entries
                .iter()
                .any(|entry| entry.path == "node/secret.txt")
        );
        let error = workspace
            .preview(PreviewRequest {
                repo_id: attached.repo_id,
                expected_generation: attached.snapshot.repo_generation,
                action: Action::Reset {
                    commit: "target".into(),
                    mode: ResetMode::Hard,
                },
            })
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidRequest);
        assert_eq!(
            error.details.get("obstructionPath").map(String::as_str),
            Some("node/secret.txt")
        );
        assert!(fixture.repo.join("node/secret.txt").exists());
    }

    #[test]
    fn whole_file_discard_binds_untracked_directory_file_obstruction() {
        let fixture = GitFixture::new();
        fixture.write("obstacle", "tracked\n");
        fixture.git(&["add", "--", "obstacle"]);
        fixture.git(&["commit", "-m", "feat: tracked obstacle"]);
        fs::remove_file(fixture.repo.join("obstacle")).unwrap();
        fs::create_dir(fixture.repo.join("obstacle")).unwrap();
        fixture.write("obstacle/secret.txt", "keep discard secret\n");

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        assert!(
            attached
                .snapshot
                .entries
                .iter()
                .any(|entry| { entry.path == "obstacle/secret.txt" && entry.untracked })
        );
        let action = Action::Discard {
            paths: vec!["obstacle".into()],
            target: DiscardTarget::Unstaged,
            selection: None,
        };
        let preview = workspace
            .preview(PreviewRequest {
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action: action.clone(),
            })
            .unwrap();
        assert!(
            preview
                .affected_paths
                .contains(&"obstacle/secret.txt".to_owned())
        );
        fixture.write("obstacle/secret.txt", "edit discard secret\n");
        let current = match workspace
            .query(QueryRequest {
                repo_id: attached.repo_id.clone(),
                query: Query::Status,
            })
            .unwrap()
        {
            QueryOutcome::Status(snapshot) => snapshot,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        let stale = workspace
            .execute(ExecuteRequest {
                operation_id: "stale-whole-discard-child".into(),
                repo_id: attached.repo_id.clone(),
                expected_generation: current.repo_generation,
                action: action.clone(),
                confirmation_token: preview.confirmation_token,
            })
            .unwrap_err();
        assert_eq!(stale.code, ErrorCode::PreviewMismatch);

        let retry = workspace
            .preview(PreviewRequest {
                repo_id: attached.repo_id.clone(),
                expected_generation: current.repo_generation,
                action: action.clone(),
            })
            .unwrap();
        workspace
            .execute(ExecuteRequest {
                operation_id: "confirmed-whole-discard-child".into(),
                repo_id: attached.repo_id,
                expected_generation: current.repo_generation,
                action,
                confirmation_token: retry.confirmation_token,
            })
            .unwrap();
        assert_eq!(
            fs::read_to_string(fixture.repo.join("obstacle")).unwrap(),
            "tracked\n"
        );
    }

    #[test]
    fn merge_rebase_and_cherry_pick_reject_ignored_directory_file_obstruction() {
        let fixture = GitFixture::new();
        fixture.write(".gitignore", "obstacle/\n");
        fixture.git(&["add", "--", ".gitignore"]);
        fixture.git(&["commit", "-m", "feat: ignore local obstacle"]);
        fixture.git(&["switch", "-c", "target"]);
        fixture.write("obstacle", "target blob\n");
        fixture.git(&["add", "--", "obstacle"]);
        fixture.git(&["commit", "-m", "feat: add target obstacle"]);
        let target_oid = fixture.git_output(&["rev-parse", "HEAD"]);
        fixture.git(&["switch", "main"]);
        fs::create_dir(fixture.repo.join("obstacle")).unwrap();
        fixture.write("obstacle/secret.txt", "keep operation secret\n");

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        assert!(attached.snapshot.entries.is_empty());
        for action in [
            Action::Merge {
                source: "target".into(),
                commit_immediately: false,
            },
            Action::Rebase {
                onto: "target".into(),
            },
            Action::CherryPick {
                commit: target_oid.clone(),
                mainline: None,
            },
        ] {
            let error = workspace
                .preview(PreviewRequest {
                    repo_id: attached.repo_id.clone(),
                    expected_generation: attached.snapshot.repo_generation,
                    action,
                })
                .unwrap_err();
            assert_eq!(error.code, ErrorCode::InvalidRequest);
            assert_eq!(
                error.details.get("targetPath").map(String::as_str),
                Some("obstacle")
            );
            assert!(fixture.repo.join("obstacle/secret.txt").exists());
        }
    }

    #[test]
    fn rebase_rejects_ignored_path_written_only_by_an_intermediate_replayed_commit() {
        let fixture = GitFixture::new();
        fixture.write(".gitignore", "obstacle/\n");
        fixture.write("base.txt", "base\n");
        fixture.git(&["add", "--", ".gitignore", "base.txt"]);
        fixture.git(&["commit", "-m", "feat: rebase replay base"]);
        fixture.git(&["switch", "-c", "topic"]);
        fixture.write("obstacle", "transient replay blob\n");
        fixture.git(&["add", "--", "obstacle"]);
        fixture.git(&["commit", "-m", "feat: transient replay add"]);
        fixture.git(&["rm", "--", "obstacle"]);
        fixture.git(&["commit", "-m", "feat: transient replay delete"]);
        fixture.write("topic.txt", "topic\n");
        fixture.git(&["add", "--", "topic.txt"]);
        fixture.git(&["commit", "-m", "feat: topic tail"]);
        fixture.git(&["switch", "main"]);
        fixture.git(&["switch", "-c", "onto"]);
        fixture.write("onto.txt", "onto\n");
        fixture.git(&["add", "--", "onto.txt"]);
        fixture.git(&["commit", "-m", "feat: onto change"]);
        fixture.git(&["switch", "topic"]);
        fs::create_dir(fixture.repo.join("obstacle")).unwrap();
        fixture.write("obstacle/secret.txt", "keep transient secret\n");

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        assert!(attached.snapshot.entries.is_empty());
        let error = workspace
            .preview(PreviewRequest {
                repo_id: attached.repo_id,
                expected_generation: attached.snapshot.repo_generation,
                action: Action::Rebase {
                    onto: "onto".into(),
                },
            })
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidRequest);
        assert_eq!(
            error.details.get("targetPath").map(String::as_str),
            Some("obstacle")
        );
        assert!(fixture.repo.join("obstacle/secret.txt").exists());
    }

    #[test]
    fn revert_rejects_ignored_directory_file_obstruction_from_parent_tree() {
        let fixture = GitFixture::new();
        fixture.write(".gitignore", "obstacle/\n");
        fixture.write("obstacle", "restore on revert\n");
        fixture.git(&["add", "--", ".gitignore", "obstacle"]);
        fixture.git(&["commit", "-m", "feat: add revert obstacle"]);
        fixture.git(&["rm", "--", "obstacle"]);
        fixture.git(&["commit", "-m", "feat: delete revert obstacle"]);
        let deletion = fixture.git_output(&["rev-parse", "HEAD"]);
        fs::create_dir(fixture.repo.join("obstacle")).unwrap();
        fixture.write("obstacle/secret.txt", "keep revert secret\n");

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let error = workspace
            .preview(PreviewRequest {
                repo_id: attached.repo_id,
                expected_generation: attached.snapshot.repo_generation,
                action: Action::Revert {
                    commit: deletion,
                    mainline: None,
                },
            })
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidRequest);
        assert!(fixture.repo.join("obstacle/secret.txt").exists());
    }

    #[test]
    fn switch_and_create_branch_keep_compatible_uncommitted_changes() {
        let fixture = GitFixture::new();
        fixture.write("tracked.txt", "base\n");
        fixture.git(&["add", "--", "tracked.txt"]);
        fixture.git(&["commit", "-m", "feat: 追跡対象ファイルを追加"]);
        fixture.git(&["branch", "target"]);
        fixture.write("tracked.txt", "staged\n");
        fixture.git(&["add", "--", "tracked.txt"]);
        fixture.write("tracked.txt", "unstaged\n");
        fixture.write("untracked.txt", "untracked\n");

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let switched = workspace
            .execute(ExecuteRequest {
                operation_id: "switch-with-changes".into(),
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action: Action::Checkout {
                    branch: "target".into(),
                },
                confirmation_token: None,
            })
            .unwrap();

        assert_eq!(fixture.git_output(&["branch", "--show-current"]), "target");
        assert_eq!(fixture.git_output(&["show", ":tracked.txt"]), "staged");
        assert_eq!(
            fs::read_to_string(fixture.repo.join("tracked.txt")).unwrap(),
            "unstaged\n"
        );
        assert_eq!(
            fs::read_to_string(fixture.repo.join("untracked.txt")).unwrap(),
            "untracked\n"
        );

        let start_point = fixture.git_output(&["rev-parse", "HEAD"]);
        let action = Action::CreateBranch {
            name: "created-with-changes".into(),
            start_point,
            checkout: true,
        };
        let token = preview_token(
            &workspace,
            &attached.repo_id,
            switched.snapshot.repo_generation,
            action.clone(),
        );
        workspace
            .execute(ExecuteRequest {
                operation_id: "create-with-changes".into(),
                repo_id: attached.repo_id,
                expected_generation: switched.snapshot.repo_generation,
                action,
                confirmation_token: Some(token),
            })
            .unwrap();

        assert_eq!(
            fixture.git_output(&["branch", "--show-current"]),
            "created-with-changes"
        );
        assert_eq!(fixture.git_output(&["show", ":tracked.txt"]), "staged");
        assert_eq!(
            fs::read_to_string(fixture.repo.join("tracked.txt")).unwrap(),
            "unstaged\n"
        );
        assert_eq!(
            fs::read_to_string(fixture.repo.join("untracked.txt")).unwrap(),
            "untracked\n"
        );
    }

    #[test]
    fn deletes_a_merged_non_current_branch_after_confirmation() {
        let fixture = GitFixture::new();
        fixture.write("tracked.txt", "base\n");
        fixture.git(&["add", "--", "tracked.txt"]);
        fixture.git(&["commit", "-m", "feat: 追跡対象ファイルを追加"]);
        fixture.git(&["branch", "delete-me"]);

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let action = Action::DeleteBranch {
            name: "delete-me".into(),
        };
        let preview = workspace
            .preview(PreviewRequest {
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action: action.clone(),
            })
            .unwrap();

        assert!(preview.destructive);
        workspace
            .execute(ExecuteRequest {
                operation_id: "delete-branch".into(),
                repo_id: attached.repo_id,
                expected_generation: attached.snapshot.repo_generation,
                action,
                confirmation_token: preview.confirmation_token,
            })
            .unwrap();

        assert!(
            fixture
                .git_output(&["branch", "--list", "delete-me"])
                .is_empty()
        );
    }

    #[test]
    fn deletes_an_unmerged_branch_after_showing_its_lost_commits() {
        let fixture = GitFixture::new();
        fixture.write("tracked.txt", "base\n");
        fixture.git(&["add", "--", "tracked.txt"]);
        fixture.git(&["commit", "-m", "feat: 追跡対象ファイルを追加"]);
        fixture.git(&["switch", "-c", "delete-unmerged"]);
        fixture.write("experiment.txt", "trial\n");
        fixture.git(&["add", "--", "experiment.txt"]);
        fixture.git(&["commit", "-m", "test: 検証結果を追加"]);
        let lost_commit = fixture.git_output(&["rev-parse", "HEAD"]);
        fixture.git(&["switch", "main"]);

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let action = Action::DeleteBranch {
            name: "delete-unmerged".into(),
        };
        let preview = workspace
            .preview(PreviewRequest {
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action: action.clone(),
            })
            .unwrap();

        assert_eq!(preview.summary.id, "previewDeleteUnmergedBranch");
        assert_eq!(preview.lost_commit_oids, vec![lost_commit]);
        workspace
            .execute(ExecuteRequest {
                operation_id: "delete-unmerged-branch".into(),
                repo_id: attached.repo_id,
                expected_generation: attached.snapshot.repo_generation,
                action,
                confirmation_token: preview.confirmation_token,
            })
            .unwrap();

        assert!(
            fixture
                .git_output(&["branch", "--list", "delete-unmerged"])
                .is_empty()
        );
    }

    #[test]
    fn deletes_a_branch_merged_into_head_when_its_upstream_is_behind() {
        let fixture = GitFixture::new();
        fixture.write("tracked.txt", "base\n");
        fixture.git(&["add", "--", "tracked.txt"]);
        fixture.git(&["commit", "-m", "feat: 追跡対象ファイルを追加"]);
        let bare = fixture.temp.path().join("remote.git");
        run_git(
            fixture.temp.path(),
            &["init", "--bare", "-b", "main", bare.to_str().unwrap()],
        );
        fixture.git(&["remote", "add", "origin", bare.to_str().unwrap()]);
        fixture.git(&["push", "--set-upstream", "origin", "main"]);
        fixture.git(&["switch", "-c", "delete-tracking"]);
        fixture.write("published.txt", "published\n");
        fixture.git(&["add", "--", "published.txt"]);
        fixture.git(&["commit", "-m", "feat: 公開済みの変更を追加"]);
        fixture.git(&["push", "--set-upstream", "origin", "delete-tracking"]);
        fixture.write("local.txt", "local\n");
        fixture.git(&["add", "--", "local.txt"]);
        fixture.git(&["commit", "-m", "feat: ローカルの変更を追加"]);
        fixture.git(&["switch", "main"]);
        fixture.git(&[
            "merge",
            "--no-ff",
            "delete-tracking",
            "-m",
            "merge: ローカルブランチを統合",
        ]);

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let action = Action::DeleteBranch {
            name: "delete-tracking".into(),
        };
        let preview = workspace
            .preview(PreviewRequest {
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action: action.clone(),
            })
            .unwrap();

        assert!(preview.lost_commit_oids.is_empty());
        workspace
            .execute(ExecuteRequest {
                operation_id: "delete-tracking-branch".into(),
                repo_id: attached.repo_id,
                expected_generation: attached.snapshot.repo_generation,
                action,
                confirmation_token: preview.confirmation_token,
            })
            .unwrap();

        assert!(
            fixture
                .git_output(&["branch", "--list", "delete-tracking"])
                .is_empty()
        );
    }

    #[test]
    fn rejects_deleting_the_current_branch_during_preview() {
        let fixture = GitFixture::new();
        fixture.write("tracked.txt", "base\n");
        fixture.git(&["add", "--", "tracked.txt"]);
        fixture.git(&["commit", "-m", "feat: 追跡対象ファイルを追加"]);

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let current = fixture.git_output(&["branch", "--show-current"]);
        let error = workspace
            .preview(PreviewRequest {
                repo_id: attached.repo_id,
                expected_generation: attached.snapshot.repo_generation,
                action: Action::DeleteBranch { name: current },
            })
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::InvalidRequest);
    }

    #[test]
    fn switch_rejects_conflicting_uncommitted_change_without_changing_branch() {
        let fixture = GitFixture::new();
        fixture.write("tracked.txt", "base\n");
        fixture.git(&["add", "--", "tracked.txt"]);
        fixture.git(&["commit", "-m", "feat: 追跡対象ファイルを追加"]);
        fixture.git(&["switch", "-c", "target"]);
        fixture.write("tracked.txt", "target\n");
        fixture.git(&["add", "--", "tracked.txt"]);
        fixture.git(&["commit", "-m", "feat: 追跡対象ファイルを変更"]);
        fixture.git(&["switch", "main"]);
        fixture.write("tracked.txt", "local change\n");

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let error = workspace
            .execute(ExecuteRequest {
                operation_id: "reject-conflicting-switch".into(),
                repo_id: attached.repo_id,
                expected_generation: attached.snapshot.repo_generation,
                action: Action::Checkout {
                    branch: "target".into(),
                },
                confirmation_token: None,
            })
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::GitFailed);
        assert_eq!(fixture.git_output(&["branch", "--show-current"]), "main");
        assert_eq!(
            fs::read_to_string(fixture.repo.join("tracked.txt")).unwrap(),
            "local change\n"
        );
    }

    #[test]
    fn switch_and_create_with_checkout_preserve_ignored_directory_file_obstruction() {
        let fixture = GitFixture::new();
        fixture.write(".gitignore", "obstacle/\n");
        fixture.git(&["add", "--", ".gitignore"]);
        fixture.git(&["commit", "-m", "feat: ignore switch obstacle"]);
        fixture.git(&["switch", "-c", "target"]);
        fixture.write("obstacle", "target blob\n");
        fixture.git(&["add", "--", "obstacle"]);
        fixture.git(&["commit", "-m", "feat: add switch obstacle"]);
        fixture.git(&["switch", "main"]);
        fs::create_dir(fixture.repo.join("obstacle")).unwrap();
        fixture.write("obstacle/secret.txt", "keep switch secret\n");

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let checkout_error = workspace
            .execute(ExecuteRequest {
                operation_id: "reject-ignored-checkout".into(),
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action: Action::Checkout {
                    branch: "target".into(),
                },
                confirmation_token: None,
            })
            .unwrap_err();
        assert_eq!(checkout_error.code, ErrorCode::GitFailed);
        assert_eq!(fixture.git_output(&["branch", "--show-current"]), "main");
        assert!(fixture.repo.join("obstacle/secret.txt").exists());

        let current = match workspace
            .query(QueryRequest {
                repo_id: attached.repo_id.clone(),
                query: Query::Status,
            })
            .unwrap()
        {
            QueryOutcome::Status(snapshot) => snapshot,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        let action = Action::CreateBranch {
            name: "created-target".into(),
            start_point: "target".into(),
            checkout: true,
        };
        let token = preview_token(
            &workspace,
            &attached.repo_id,
            current.repo_generation,
            action.clone(),
        );
        let create_error = workspace
            .execute(ExecuteRequest {
                operation_id: "reject-ignored-create-checkout".into(),
                repo_id: attached.repo_id,
                expected_generation: current.repo_generation,
                action,
                confirmation_token: Some(token),
            })
            .unwrap_err();
        assert_eq!(create_error.code, ErrorCode::GitFailed);
        assert_eq!(fixture.git_output(&["branch", "--show-current"]), "main");
        assert!(
            fixture
                .git_output(&["branch", "--list", "created-target"])
                .is_empty()
        );
        assert!(fixture.repo.join("obstacle/secret.txt").exists());
    }

    #[test]
    fn pending_structured_operation_becomes_unknown_before_an_ignored_hard_abort() {
        let fixture = GitFixture::new();
        fixture.write(".gitignore", "obstacle/\n");
        fixture.write("obstacle", "pre-operation blob\n");
        fixture.git(&["add", "--", ".gitignore", "obstacle"]);
        fixture.git(&["commit", "-m", "feat: pending abort base"]);
        fixture.git(&["switch", "-c", "topic"]);
        fixture.git(&["rm", "--", "obstacle"]);
        fixture.git(&["commit", "-m", "feat: delete pending obstacle"]);
        let source = fixture.git_output(&["rev-parse", "HEAD"]);
        fixture.git(&["switch", "main"]);

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let cherry_pick = Action::CherryPick {
            commit: source,
            mainline: None,
        };
        let token = preview_token(
            &workspace,
            &attached.repo_id,
            attached.snapshot.repo_generation,
            cherry_pick.clone(),
        );
        let pending = workspace
            .execute(ExecuteRequest {
                operation_id: "create-pending-abort-obstruction".into(),
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action: cherry_pick,
                confirmation_token: Some(token),
            })
            .unwrap();
        assert!(matches!(
            pending.snapshot.operation,
            OperationState::PendingStructuredCommit { .. }
        ));
        fs::create_dir(fixture.repo.join("obstacle")).unwrap();
        fixture.write("obstacle/secret.txt", "keep pending abort secret\n");
        let current = match workspace
            .query(QueryRequest {
                repo_id: attached.repo_id.clone(),
                query: Query::Status,
            })
            .unwrap()
        {
            QueryOutcome::Status(snapshot) => snapshot,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        assert!(matches!(current.operation, OperationState::Unknown { .. }));
        let error = workspace
            .preview(PreviewRequest {
                repo_id: attached.repo_id,
                expected_generation: current.repo_generation,
                action: Action::Abort,
            })
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::OperationInProgress);
        assert!(fixture.repo.join("obstacle/secret.txt").exists());
    }

    #[test]
    fn native_merge_abort_rejects_ignored_directory_file_obstruction() {
        let fixture = GitFixture::new();
        fixture.write(".gitignore", "abort-obstacle/\n");
        fixture.write("abort-obstacle", "pre-merge blob\n");
        fixture.write("conflict.txt", "base\n");
        fixture.git(&["add", "--", ".gitignore", "abort-obstacle", "conflict.txt"]);
        fixture.git(&["commit", "-m", "feat: merge abort base"]);
        fixture.git(&["switch", "-c", "topic"]);
        fixture.git(&["rm", "--", "abort-obstacle"]);
        fixture.write("conflict.txt", "topic\n");
        fixture.git(&["commit", "-am", "feat: topic conflict"]);
        fixture.git(&["switch", "main"]);
        fixture.write("conflict.txt", "main\n");
        fixture.git(&["commit", "-am", "feat: main conflict"]);
        fixture.git_fails(&["merge", "--no-ff", "--no-commit", "topic"]);
        assert!(!fixture.repo.join("abort-obstacle").exists());
        fs::create_dir(fixture.repo.join("abort-obstacle")).unwrap();
        fixture.write("abort-obstacle/secret.txt", "keep native abort secret\n");

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        assert!(matches!(
            attached.snapshot.operation,
            OperationState::Merge { .. }
        ));
        let error = workspace
            .preview(PreviewRequest {
                repo_id: attached.repo_id,
                expected_generation: attached.snapshot.repo_generation,
                action: Action::Abort,
            })
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidRequest);
        assert!(fixture.repo.join("abort-obstacle/secret.txt").exists());
    }

    #[test]
    fn completed_operation_clears_cached_conflict_sessions() {
        let fixture = GitFixture::new();
        fixture.write("conflict.txt", "base\n");
        fixture.git(&["add", "--", "conflict.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        fixture.git(&["switch", "-c", "topic"]);
        fixture.write("conflict.txt", "topic\n");
        fixture.git(&["commit", "-am", "feat: topic"]);
        fixture.git(&["switch", "main"]);
        fixture.write("conflict.txt", "main\n");
        fixture.git(&["commit", "-am", "feat: main"]);
        fixture.git_fails(&["merge", "--no-ff", "--no-commit", "topic"]);

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let _document = conflict_document(&workspace, &attached.repo_id, "conflict.txt");
        let repo = workspace.repo(&attached.repo_id).unwrap();
        assert_eq!(repo.conflicts.lock().unwrap().len(), 1);

        fixture.git(&["checkout", "--ours", "--", "conflict.txt"]);
        fixture.git(&["add", "--", "conflict.txt"]);
        fixture.git(&["commit", "-m", "feat: finish merge externally"]);
        let status = workspace
            .query(QueryRequest {
                repo_id: attached.repo_id,
                query: Query::Status,
            })
            .unwrap();
        assert!(matches!(
            status,
            QueryOutcome::Status(RepoSnapshot {
                operation: OperationState::None,
                ..
            })
        ));
        assert!(repo.conflicts.lock().unwrap().is_empty());
    }

    #[test]
    fn soft_and_mixed_reset_previews_include_staged_only_paths() {
        let fixture = GitFixture::new();
        fixture.write("base.txt", "base\n");
        fixture.git(&["add", "--", "base.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        fixture.write("staged.txt", "staged only\n");
        fixture.git(&["add", "--", "staged.txt"]);

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        for mode in [ResetMode::Soft, ResetMode::Mixed] {
            let preview = workspace
                .preview(PreviewRequest {
                    repo_id: attached.repo_id.clone(),
                    expected_generation: attached.snapshot.repo_generation,
                    action: Action::Reset {
                        commit: "HEAD".into(),
                        mode,
                    },
                })
                .unwrap();
            assert_eq!(preview.affected_paths, ["staged.txt"], "{mode:?}");
            assert!(preview.impact_digest.is_some());
        }
    }

    #[test]
    fn soft_mixed_and_hard_reset_apply_their_distinct_index_and_worktree_semantics() {
        for mode in [ResetMode::Soft, ResetMode::Mixed, ResetMode::Hard] {
            let fixture = GitFixture::new();
            fixture.write("f.txt", "base\n");
            fixture.git(&["add", "--", "f.txt"]);
            fixture.git(&["commit", "-m", "feat: base"]);
            let base = fixture.git_output(&["rev-parse", "HEAD"]);
            fixture.write("f.txt", "second\n");
            fixture.git(&["commit", "-am", "feat: second"]);
            let workspace = fixture.workspace();
            let attached = workspace
                .attach(
                    OpenRequest::Open {
                        path: fixture.repo_string(),
                    },
                    None,
                )
                .unwrap();
            let action = Action::Reset {
                commit: base.clone(),
                mode,
            };
            let token = preview_token(
                &workspace,
                &attached.repo_id,
                attached.snapshot.repo_generation,
                action.clone(),
            );
            workspace
                .execute(ExecuteRequest {
                    operation_id: format!("reset-{mode:?}"),
                    repo_id: attached.repo_id,
                    expected_generation: attached.snapshot.repo_generation,
                    action,
                    confirmation_token: Some(token),
                })
                .unwrap();
            assert_eq!(fixture.git_output(&["rev-parse", "HEAD"]), base);
            match mode {
                ResetMode::Soft => {
                    assert!(
                        fixture
                            .git_output(&["diff", "--cached"])
                            .contains("+second")
                    );
                    assert_eq!(
                        fs::read_to_string(fixture.repo.join("f.txt")).unwrap(),
                        "second\n"
                    );
                }
                ResetMode::Mixed => {
                    assert!(fixture.git_output(&["diff", "--cached"]).is_empty());
                    assert!(fixture.git_output(&["diff"]).contains("+second"));
                }
                ResetMode::Hard => {
                    assert!(fixture.git_output(&["status", "--porcelain"]).is_empty());
                    assert_eq!(
                        fs::read_to_string(fixture.repo.join("f.txt")).unwrap(),
                        "base\n"
                    );
                }
            }
        }
    }

    #[test]
    fn merge_action_forces_a_pending_merge_commit_even_when_ff_is_possible() {
        let fixture = GitFixture::new();
        fixture.write("f.txt", "base\n");
        fixture.git(&["add", "--", "f.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        fixture.git(&["switch", "-c", "topic"]);
        fixture.write("f.txt", "base\ntopic\n");
        fixture.git(&["commit", "-am", "feat: topic"]);
        fixture.git(&["switch", "main"]);
        let pre_head = fixture.git_output(&["rev-parse", "HEAD"]);

        let workspace = fixture.workspace();
        let session = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let action = Action::Merge {
            source: "topic".into(),
            commit_immediately: false,
        };
        let token = preview_token(
            &workspace,
            &session.repo_id,
            session.snapshot.repo_generation,
            action.clone(),
        );
        let outcome = workspace
            .execute(ExecuteRequest {
                operation_id: "merge-ff".into(),
                repo_id: session.repo_id,
                expected_generation: session.snapshot.repo_generation,
                action,
                confirmation_token: Some(token),
            })
            .unwrap();
        assert_eq!(fixture.git_output(&["rev-parse", "HEAD"]), pre_head);
        assert!(matches!(
            outcome.snapshot.operation,
            OperationState::Merge { .. }
        ));
    }

    #[test]
    fn merge_action_commits_immediately_when_requested() {
        let fixture = GitFixture::new();
        fixture.write("f.txt", "base\n");
        fixture.git(&["add", "--", "f.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        fixture.git(&["switch", "-c", "topic"]);
        fixture.write("f.txt", "base\ntopic\n");
        fixture.git(&["commit", "-am", "feat: topic"]);
        fixture.git(&["switch", "main"]);
        let pre_head = fixture.git_output(&["rev-parse", "HEAD"]);

        let workspace = fixture.workspace();
        let session = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let action = Action::Merge {
            source: "topic".into(),
            commit_immediately: true,
        };
        let token = preview_token(
            &workspace,
            &session.repo_id,
            session.snapshot.repo_generation,
            action.clone(),
        );
        let outcome = workspace
            .execute(ExecuteRequest {
                operation_id: "merge-commit-immediately".into(),
                repo_id: session.repo_id,
                expected_generation: session.snapshot.repo_generation,
                action,
                confirmation_token: Some(token),
            })
            .unwrap();

        assert_ne!(fixture.git_output(&["rev-parse", "HEAD"]), pre_head);
        assert_eq!(
            fixture
                .git_output(&["rev-list", "--parents", "-n", "1", "HEAD"])
                .split_whitespace()
                .count(),
            3
        );
        assert!(matches!(outcome.snapshot.operation, OperationState::None));
    }

    #[test]
    fn save_reissues_the_conflict_session_and_resolve_is_path_scoped() {
        let fixture = GitFixture::new();
        fixture.write("a.txt", "base-a\n");
        fixture.write("b.txt", "base-b\n");
        fixture.git(&["add", "--", "a.txt", "b.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        fixture.git(&["switch", "-c", "topic"]);
        fixture.write("a.txt", "topic-a\n");
        fixture.write("b.txt", "topic-b\n");
        fixture.git(&["commit", "-am", "feat: topic"]);
        fixture.git(&["switch", "main"]);
        fixture.write("a.txt", "main-a\n");
        fixture.write("b.txt", "main-b\n");
        fixture.git(&["commit", "-am", "feat: main"]);
        fixture.git_fails(&["merge", "--no-ff", "--no-commit", "topic"]);

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let original_a = conflict_document(&workspace, &attached.repo_id, "a.txt");
        let first_poll = conflict_document(&workspace, &attached.repo_id, "a.txt");
        assert_eq!(first_poll.session_id, original_a.session_id);
        let block = original_a.blocks.first().expect("text conflict block");
        let chosen = workspace
            .execute(ExecuteRequest {
                operation_id: "choose-a".into(),
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action: Action::ConflictChoice {
                    session_id: original_a.session_id.clone(),
                    conflict_generation: original_a.conflict_generation.clone(),
                    content_hash: original_a.content_hash.clone(),
                    document_revision: hash(original_a.result.text.as_bytes()),
                    base_document_revision: hash(original_a.result.text.as_bytes()),
                    block_id: block.id.clone(),
                    draft_text: original_a.result.text.clone(),
                    choice: ConflictChoice::Current,
                },
                confirmation_token: None,
            })
            .unwrap();
        let chosen_edit = chosen.conflict_edit.expect("choice returns edit");
        let second_poll = conflict_document(&workspace, &attached.repo_id, "a.txt");
        assert_eq!(second_poll.session_id, original_a.session_id);
        assert_eq!(second_poll.result.text, chosen_edit.text);
        assert_eq!(second_poll.blocks, chosen_edit.blocks);
        let original_b = conflict_document(&workspace, &attached.repo_id, "b.txt");

        let saved_a = workspace
            .execute(ExecuteRequest {
                operation_id: "save-a".into(),
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action: Action::ConflictSave {
                    session_id: original_a.session_id.clone(),
                    conflict_generation: original_a.conflict_generation,
                    content_hash: original_a.content_hash,
                    result: "resolved-a\n".into(),
                },
                confirmation_token: None,
            })
            .unwrap();
        let refreshed_a = saved_a
            .conflict_document
            .as_ref()
            .expect("save returns the replacement session");
        assert_ne!(refreshed_a.session_id, original_a.session_id);
        assert!(refreshed_a.blocks.is_empty());

        let saved_b = workspace
            .execute(ExecuteRequest {
                operation_id: "save-b".into(),
                repo_id: attached.repo_id.clone(),
                expected_generation: saved_a.repo_generation,
                action: Action::ConflictSave {
                    session_id: original_b.session_id,
                    conflict_generation: original_b.conflict_generation,
                    content_hash: original_b.content_hash,
                    result: "resolved-b\n".into(),
                },
                confirmation_token: None,
            })
            .unwrap();

        workspace
            .execute(ExecuteRequest {
                operation_id: "resolve-a".into(),
                repo_id: attached.repo_id,
                expected_generation: saved_b.repo_generation,
                action: Action::ConflictMarkResolved {
                    session_id: refreshed_a.session_id.clone(),
                    conflict_generation: refreshed_a.conflict_generation.clone(),
                    content_hash: refreshed_a.content_hash.clone(),
                    result_kind: ConflictResultKind::File,
                },
                confirmation_token: None,
            })
            .unwrap();
        assert!(
            fixture
                .git_output(&["ls-files", "-u", "--", "a.txt"])
                .is_empty()
        );
        assert!(
            !fixture
                .git_output(&["ls-files", "-u", "--", "b.txt"])
                .is_empty()
        );
    }

    #[test]
    fn mark_resolved_stages_only_the_literal_magic_path() {
        let fixture = GitFixture::new();
        fixture.write("*", "base\n");
        fixture.write("other.txt", "base other\n");
        fixture.git(&["--literal-pathspecs", "add", "--", "*", "other.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        fixture.git(&["switch", "-c", "topic"]);
        fixture.write("*", "topic\n");
        fixture.git(&["--literal-pathspecs", "add", "--", "*"]);
        fixture.git(&["commit", "-m", "feat: topic"]);
        fixture.git(&["switch", "main"]);
        fixture.write("*", "main\n");
        fixture.git(&["--literal-pathspecs", "add", "--", "*"]);
        fixture.git(&["commit", "-m", "feat: main"]);
        fixture.git_fails(&["merge", "--no-ff", "--no-commit", "topic"]);
        fixture.write("other.txt", "unrelated worktree edit\n");

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let document = conflict_document(&workspace, &attached.repo_id, "*");
        let saved = workspace
            .execute(ExecuteRequest {
                operation_id: "literal-conflict-save".into(),
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action: Action::ConflictSave {
                    session_id: document.session_id,
                    conflict_generation: document.conflict_generation,
                    content_hash: document.content_hash,
                    result: "resolved\n".into(),
                },
                confirmation_token: None,
            })
            .unwrap();
        let refreshed = saved
            .conflict_document
            .expect("save returns a replacement conflict session");
        workspace
            .execute(ExecuteRequest {
                operation_id: "literal-conflict-resolve".into(),
                repo_id: attached.repo_id,
                expected_generation: saved.repo_generation,
                action: Action::ConflictMarkResolved {
                    session_id: refreshed.session_id,
                    conflict_generation: refreshed.conflict_generation,
                    content_hash: refreshed.content_hash,
                    result_kind: ConflictResultKind::File,
                },
                confirmation_token: None,
            })
            .unwrap();

        assert_eq!(
            fixture.git_output(&["diff", "--cached", "--name-only"]),
            "*"
        );
        assert_eq!(fixture.git_output(&["diff", "--name-only"]), "other.txt");
    }

    #[test]
    fn mark_resolved_infers_a_deleted_result_instead_of_trusting_the_wire_hint() {
        let fixture = GitFixture::new();
        fixture.write("f.txt", "base\n");
        fixture.git(&["add", "--", "f.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        fixture.git(&["switch", "-c", "topic"]);
        fixture.write("f.txt", "topic\n");
        fixture.git(&["commit", "-am", "feat: modify"]);
        fixture.git(&["switch", "main"]);
        fixture.git(&["rm", "--", "f.txt"]);
        fixture.git(&["commit", "-m", "feat: delete"]);
        fixture.git_fails(&["merge", "--no-ff", "--no-commit", "topic"]);

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let document = conflict_document(&workspace, &attached.repo_id, "f.txt");
        assert_eq!(document.kind, ConflictKind::ModifyDelete);
        assert!(document.capabilities.delete);
        assert!(!document.capabilities.choose_current);
        let action = Action::ConflictMaterialize {
            session_id: document.session_id,
            conflict_generation: document.conflict_generation,
            choice: ConflictChoice::Delete,
        };
        let token = preview_token(
            &workspace,
            &attached.repo_id,
            attached.snapshot.repo_generation,
            action.clone(),
        );
        let materialized = workspace
            .execute(ExecuteRequest {
                operation_id: "delete-conflict-result".into(),
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action,
                confirmation_token: Some(token),
            })
            .unwrap();
        let refreshed = materialized
            .conflict_document
            .expect("materialize returns refreshed document");
        assert!(!fixture.repo.join("f.txt").exists());
        workspace
            .execute(ExecuteRequest {
                operation_id: "resolve-deleted-conflict".into(),
                repo_id: attached.repo_id,
                expected_generation: materialized.repo_generation,
                action: Action::ConflictMarkResolved {
                    session_id: refreshed.session_id,
                    conflict_generation: refreshed.conflict_generation,
                    content_hash: refreshed.content_hash,
                    // 意図的に誤った旧形式のヒント。
                    // Rustは実際の作業ツリーの状態を使用する必要がある。
                    result_kind: ConflictResultKind::File,
                },
                confirmation_token: None,
            })
            .unwrap();
        assert!(
            fixture
                .git_output(&["ls-files", "-u", "--", "f.txt"])
                .is_empty()
        );
    }

    #[test]
    fn whole_file_incoming_choice_preserves_the_selected_stage_mode() {
        let fixture = GitFixture::new();
        fixture.write("base.txt", "base\n");
        fixture.git(&["add", "--", "base.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        fixture.git(&["switch", "-c", "topic"]);
        fixture.write("choice.sh", "topic\n");
        fs::set_permissions(
            fixture.repo.join("choice.sh"),
            fs::Permissions::from_mode(0o755),
        )
        .unwrap();
        fixture.git(&["add", "--", "choice.sh"]);
        fixture.git(&["commit", "-m", "feat: executable incoming"]);
        fixture.git(&["switch", "main"]);
        fixture.write("choice.sh", "main\n");
        fs::set_permissions(
            fixture.repo.join("choice.sh"),
            fs::Permissions::from_mode(0o644),
        )
        .unwrap();
        fixture.git(&["add", "--", "choice.sh"]);
        fixture.git(&["commit", "-m", "feat: regular current"]);
        fixture.git_fails(&["merge", "--no-ff", "--no-commit", "topic"]);

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let document = conflict_document(&workspace, &attached.repo_id, "choice.sh");
        assert_eq!(document.kind, ConflictKind::AddAdd);
        assert_eq!(document.sides.current.as_ref().unwrap().mode, "100644");
        assert_eq!(document.sides.incoming.as_ref().unwrap().mode, "100755");
        let action = Action::ConflictMaterialize {
            session_id: document.session_id,
            conflict_generation: document.conflict_generation,
            choice: ConflictChoice::Incoming,
        };
        let token = preview_token(
            &workspace,
            &attached.repo_id,
            attached.snapshot.repo_generation,
            action.clone(),
        );
        let materialized = workspace
            .execute(ExecuteRequest {
                operation_id: "incoming-with-mode".into(),
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action,
                confirmation_token: Some(token),
            })
            .unwrap();
        assert_eq!(
            fs::read_to_string(fixture.repo.join("choice.sh")).unwrap(),
            "topic\n"
        );
        assert_ne!(
            fs::metadata(fixture.repo.join("choice.sh"))
                .unwrap()
                .permissions()
                .mode()
                & 0o111,
            0
        );

        let refreshed = materialized
            .conflict_document
            .expect("materialize returns a replacement conflict session");
        workspace
            .execute(ExecuteRequest {
                operation_id: "resolve-incoming-with-mode".into(),
                repo_id: attached.repo_id,
                expected_generation: materialized.repo_generation,
                action: Action::ConflictMarkResolved {
                    session_id: refreshed.session_id,
                    conflict_generation: refreshed.conflict_generation,
                    content_hash: refreshed.content_hash,
                    result_kind: ConflictResultKind::File,
                },
                confirmation_token: None,
            })
            .unwrap();
        assert!(
            fixture
                .git_output(&["ls-files", "--stage", "--", "choice.sh"])
                .starts_with("100755 ")
        );
    }

    #[test]
    fn gitattributes_binary_conflict_is_never_exposed_as_editable_text() {
        let fixture = GitFixture::new();
        fixture.write(".gitattributes", "*.dat binary\n");
        fixture.write("f.dat", "base utf8\n");
        fixture.git(&["add", "--", ".gitattributes", "f.dat"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        fixture.git(&["switch", "-c", "topic"]);
        fixture.write("f.dat", "topic utf8\n");
        fixture.git(&["commit", "-am", "feat: topic"]);
        fixture.git(&["switch", "main"]);
        fixture.write("f.dat", "main utf8\n");
        fixture.git(&["commit", "-am", "feat: main"]);
        fixture.git_fails(&["merge", "--no-ff", "--no-commit", "topic"]);

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let document = conflict_document(&workspace, &attached.repo_id, "f.dat");
        assert_eq!(document.kind, ConflictKind::Binary);
        assert!(document.blocks.is_empty());
        assert!(!document.capabilities.in_app_edit);
        assert!(document.capabilities.external_editor);
        assert!(!document.capabilities.choose_current);
        assert!(!document.capabilities.choose_incoming);
        assert!(!document.capabilities.choose_both);

        let error = workspace
            .execute(ExecuteRequest {
                operation_id: "binary-resolve-without-choice".into(),
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action: Action::ConflictMarkResolved {
                    session_id: document.session_id.clone(),
                    conflict_generation: document.conflict_generation.clone(),
                    content_hash: document.content_hash.clone(),
                    result_kind: ConflictResultKind::File,
                },
                confirmation_token: None,
            })
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidRequest);

        // `ConflictOpenExternal`がエディターを正常に起動した後の状態遷移だけを再現し、
        // テスト用プロセスから画面を起動することは避ける。
        let repo = workspace.repo(&attached.repo_id).unwrap();
        workspace
            .record_external_conflict_baseline(&repo, &document.session_id, document.content_hash)
            .unwrap();
        fixture.write("f.dat", "manual binary-driver resolution\n");
        let refreshed = conflict_document(&workspace, &attached.repo_id, "f.dat");
        let status = match workspace
            .query(QueryRequest {
                repo_id: attached.repo_id.clone(),
                query: Query::Status,
            })
            .unwrap()
        {
            QueryOutcome::Status(status) => status,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        workspace
            .execute(ExecuteRequest {
                operation_id: "binary-resolve-after-external-edit".into(),
                repo_id: attached.repo_id,
                expected_generation: status.repo_generation,
                action: Action::ConflictMarkResolved {
                    session_id: refreshed.session_id,
                    conflict_generation: refreshed.conflict_generation,
                    content_hash: refreshed.content_hash,
                    result_kind: ConflictResultKind::File,
                },
                confirmation_token: None,
            })
            .unwrap();
        assert!(
            fixture
                .git_output(&["ls-files", "-u", "--", "f.dat"])
                .is_empty()
        );
    }

    #[test]
    fn sparse_multi_gibibyte_conflict_query_is_metadata_only_and_external() {
        let fixture = GitFixture::new();
        fixture.write("f.txt", "base\n");
        fixture.git(&["add", "--", "f.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        fixture.git(&["switch", "-c", "topic"]);
        fixture.write("f.txt", "topic\n");
        fixture.git(&["commit", "-am", "feat: topic"]);
        fixture.git(&["switch", "main"]);
        fixture.write("f.txt", "main\n");
        fixture.git(&["commit", "-am", "feat: main"]);
        fixture.git_fails(&["merge", "--no-ff", "--no-commit", "topic"]);

        let path = fixture.repo.join("f.txt");
        let file = File::create(&path).unwrap();
        file.set_len(8 * 1024 * 1024 * 1024).unwrap();
        drop(file);
        fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).unwrap();

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let document = conflict_document(&workspace, &attached.repo_id, "f.txt");
        assert_eq!(document.kind, ConflictKind::Oversize);
        assert!(document.content_hash.starts_with("metadata:"));
        assert!(document.result.text.is_empty());
        assert!(document.blocks.is_empty());
        assert!(!document.capabilities.in_app_edit);
        assert!(document.capabilities.external_editor);
        assert!(!document.capabilities.choose_current);
        assert!(!document.capabilities.choose_incoming);
        assert!(!document.capabilities.choose_both);
    }

    #[test]
    fn markerless_text_conflict_requires_a_changed_save_before_mark_resolved() {
        let fixture = GitFixture::new();
        fixture.write("f.txt", "base\n");
        fixture.git(&["add", "--", "f.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        fixture.git(&["switch", "-c", "topic"]);
        fixture.write("f.txt", "topic\n");
        fixture.git(&["commit", "-am", "feat: topic"]);
        fixture.git(&["switch", "main"]);
        fixture.write("f.txt", "main\n");
        fixture.git(&["commit", "-am", "feat: main"]);
        fixture.git_fails(&["merge", "--no-ff", "--no-commit", "topic"]);
        fixture.write("f.txt", "current side without markers\n");

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let document = conflict_document(&workspace, &attached.repo_id, "f.txt");
        assert_eq!(document.kind, ConflictKind::Text);
        assert!(document.blocks.is_empty());
        let error = workspace
            .execute(ExecuteRequest {
                operation_id: "markerless-resolve-without-save".into(),
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action: Action::ConflictMarkResolved {
                    session_id: document.session_id.clone(),
                    conflict_generation: document.conflict_generation.clone(),
                    content_hash: document.content_hash.clone(),
                    result_kind: ConflictResultKind::File,
                },
                confirmation_token: None,
            })
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidRequest);

        let saved = workspace
            .execute(ExecuteRequest {
                operation_id: "markerless-manual-save".into(),
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action: Action::ConflictSave {
                    session_id: document.session_id,
                    conflict_generation: document.conflict_generation,
                    content_hash: document.content_hash,
                    result: "manual resolution\n".into(),
                },
                confirmation_token: None,
            })
            .unwrap();
        let refreshed = saved.conflict_document.unwrap();
        workspace
            .execute(ExecuteRequest {
                operation_id: "markerless-resolve-after-save".into(),
                repo_id: attached.repo_id,
                expected_generation: saved.repo_generation,
                action: Action::ConflictMarkResolved {
                    session_id: refreshed.session_id,
                    conflict_generation: refreshed.conflict_generation,
                    content_hash: refreshed.content_hash,
                    result_kind: ConflictResultKind::File,
                },
                confirmation_token: None,
            })
            .unwrap();
        assert!(
            fixture
                .git_output(&["ls-files", "-u", "--", "f.txt"])
                .is_empty()
        );
    }

    #[test]
    fn failed_conflict_edit_emits_a_terminal_event_and_refresh_generation_detail() {
        let fixture = GitFixture::new();
        fixture.write("f.txt", "base\n");
        fixture.git(&["add", "--", "f.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        fixture.git(&["switch", "-c", "topic"]);
        fixture.write("f.txt", "topic\n");
        fixture.git(&["commit", "-am", "feat: topic"]);
        fixture.git(&["switch", "main"]);
        fixture.write("f.txt", "main\n");
        fixture.git(&["commit", "-am", "feat: main"]);
        fixture.git_fails(&["merge", "--no-ff", "--no-commit", "topic"]);

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let document = conflict_document(&workspace, &attached.repo_id, "f.txt");
        let block_id = document
            .blocks
            .first()
            .expect("text conflict block")
            .id
            .clone();
        let error = workspace
            .execute(ExecuteRequest {
                operation_id: "invalid-conflict-choice".into(),
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action: Action::ConflictChoice {
                    session_id: document.session_id,
                    conflict_generation: document.conflict_generation,
                    content_hash: document.content_hash,
                    document_revision: "invalid".into(),
                    base_document_revision: hash(document.result.text.as_bytes()),
                    block_id,
                    draft_text: document.result.text,
                    choice: ConflictChoice::Current,
                },
                confirmation_token: None,
            })
            .unwrap_err();
        assert!(error.details.contains_key("repoGeneration"));
        let status = match workspace
            .query(QueryRequest {
                repo_id: attached.repo_id,
                query: Query::Status,
            })
            .unwrap()
        {
            QueryOutcome::Status(status) => status,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        assert_eq!(
            status.event_seq, 2,
            "started and failed must both be emitted"
        );
    }

    #[test]
    fn merge_rebase_cherry_pick_and_revert_share_the_choice_save_resolve_contract() {
        for (label, fixture, action) in conflict_operation_fixtures() {
            resolve_conflicting_action(label, &fixture, action);
        }
    }

    #[test]
    fn externally_started_cherry_pick_continue_is_rejected_without_removing_its_marker() {
        assert_external_structured_continue_is_rejected(StructuredOperation::CherryPick);
    }

    #[test]
    fn externally_started_revert_continue_is_rejected_without_removing_its_marker() {
        assert_external_structured_continue_is_rejected(StructuredOperation::Revert);
    }

    #[test]
    fn prepared_structured_journals_recover_to_abort_only_after_restart() {
        for operation in [StructuredOperation::CherryPick, StructuredOperation::Revert] {
            assert_interrupted_structured_recovery(operation, false);
        }
    }

    #[test]
    fn applied_but_unpersisted_structured_operations_abort_safely_after_restart() {
        for operation in [StructuredOperation::CherryPick, StructuredOperation::Revert] {
            assert_interrupted_structured_recovery(operation, true);
        }
    }

    #[test]
    fn successful_revert_uses_the_structured_commit_journal_across_restart() {
        let fixture = GitFixture::new();
        fixture.write("base.txt", "base\n");
        fixture.git(&["add", "--", "base.txt"]);
        fixture.git(&["commit", "-m", "feat: revert base"]);
        fixture.write("effect.txt", "revert me\n");
        fixture.git(&["add", "--", "effect.txt"]);
        fixture.git(&["commit", "-m", "feat: revert target"]);
        let source_oid = fixture.git_output(&["rev-parse", "HEAD"]);
        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let action = Action::Revert {
            commit: source_oid,
            mainline: None,
        };
        let token = preview_token(
            &workspace,
            &attached.repo_id,
            attached.snapshot.repo_generation,
            action.clone(),
        );
        let pending = workspace
            .execute(ExecuteRequest {
                operation_id: "revert-pending-before-restart".into(),
                repo_id: attached.repo_id,
                expected_generation: attached.snapshot.repo_generation,
                action,
                confirmation_token: Some(token),
            })
            .unwrap();
        assert!(matches!(
            pending.snapshot.operation,
            OperationState::PendingStructuredCommit {
                operation: StructuredOperation::Revert,
                ..
            }
        ));
        drop(workspace);

        let restarted = fixture.workspace();
        let recovered = restarted
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        assert!(matches!(
            recovered.snapshot.operation,
            OperationState::PendingStructuredCommit {
                operation: StructuredOperation::Revert,
                ..
            }
        ));
    }

    #[test]
    fn merge_commit_cherry_pick_and_revert_use_the_selected_mainline_parent() {
        let merge_fixture = || {
            let fixture = GitFixture::new();
            fixture.write("base.txt", "base\n");
            fixture.git(&["add", "--", "base.txt"]);
            fixture.git(&["commit", "-m", "feat: base"]);
            fixture.git(&["switch", "-c", "side"]);
            fixture.write("side.txt", "side\n");
            fixture.git(&["add", "--", "side.txt"]);
            fixture.git(&["commit", "-m", "feat: side"]);
            fixture.git(&["switch", "main"]);
            fixture.write("main.txt", "main\n");
            fixture.git(&["add", "--", "main.txt"]);
            fixture.git(&["commit", "-m", "feat: main"]);
            let main_parent = fixture.git_output(&["rev-parse", "HEAD"]);
            fixture.git(&["merge", "--no-ff", "side", "-m", "feat: merge side"]);
            let merge_oid = fixture.git_output(&["rev-parse", "HEAD"]);
            (fixture, main_parent, merge_oid)
        };

        let (cherry, main_parent, merge_oid) = merge_fixture();
        cherry.git(&["switch", "-c", "cherry-target", &main_parent]);
        let workspace = cherry.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: cherry.repo_string(),
                },
                None,
            )
            .unwrap();
        let missing_mainline = workspace
            .preview(PreviewRequest {
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action: Action::CherryPick {
                    commit: merge_oid.clone(),
                    mainline: None,
                },
            })
            .unwrap_err();
        assert_eq!(missing_mainline.code, ErrorCode::InvalidRequest);
        let action = Action::CherryPick {
            commit: merge_oid,
            mainline: Some(1),
        };
        let preview = workspace
            .preview(PreviewRequest {
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action: action.clone(),
            })
            .unwrap();
        assert_eq!(preview.affected_paths, ["side.txt"]);
        workspace
            .execute(ExecuteRequest {
                operation_id: "merge-cherry-pick-mainline".into(),
                repo_id: attached.repo_id,
                expected_generation: attached.snapshot.repo_generation,
                action,
                confirmation_token: preview.confirmation_token,
            })
            .unwrap();
        assert_eq!(
            cherry.git_output(&["diff", "--cached", "--name-status"]),
            "A\tside.txt"
        );

        let (revert, _main_parent, merge_oid) = merge_fixture();
        let workspace = revert.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: revert.repo_string(),
                },
                None,
            )
            .unwrap();
        let action = Action::Revert {
            commit: merge_oid,
            mainline: Some(1),
        };
        let preview = workspace
            .preview(PreviewRequest {
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action: action.clone(),
            })
            .unwrap();
        assert_eq!(preview.affected_paths, ["side.txt"]);
        workspace
            .execute(ExecuteRequest {
                operation_id: "merge-revert-mainline".into(),
                repo_id: attached.repo_id,
                expected_generation: attached.snapshot.repo_generation,
                action,
                confirmation_token: preview.confirmation_token,
            })
            .unwrap();
        assert_eq!(
            revert.git_output(&["diff", "--cached", "--name-status"]),
            "D\tside.txt"
        );
    }

    #[test]
    fn pending_structured_commit_survives_workspace_restart_and_aborts_safely() {
        let fixture = GitFixture::new();
        fixture.write("base.txt", "base\n");
        fixture.git(&["add", "--", "base.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        fixture.git(&["switch", "-c", "topic"]);
        fixture.write("picked.txt", "picked\n");
        fixture.git(&["add", "--", "picked.txt"]);
        fixture.git(&["commit", "-m", "feat: picked"]);
        let source = fixture.git_output(&["rev-parse", "HEAD"]);
        fixture.git(&["switch", "main"]);

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let action = Action::CherryPick {
            commit: source,
            mainline: None,
        };
        let token = preview_token(
            &workspace,
            &attached.repo_id,
            attached.snapshot.repo_generation,
            action.clone(),
        );
        let pending = workspace
            .execute(ExecuteRequest {
                operation_id: "pending-before-restart".into(),
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action,
                confirmation_token: Some(token),
            })
            .unwrap();
        assert!(matches!(
            pending.snapshot.operation,
            OperationState::PendingStructuredCommit { .. }
        ));
        drop(workspace);

        let restarted = fixture.workspace();
        let recovered = restarted
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        assert!(matches!(
            recovered.snapshot.operation,
            OperationState::PendingStructuredCommit { .. }
        ));
        let abort = Action::Abort;
        let token = preview_token(
            &restarted,
            &recovered.repo_id,
            recovered.snapshot.repo_generation,
            abort.clone(),
        );
        let aborted = restarted
            .execute(ExecuteRequest {
                operation_id: "abort-after-restart".into(),
                repo_id: recovered.repo_id,
                expected_generation: recovered.snapshot.repo_generation,
                action: abort,
                confirmation_token: Some(token),
            })
            .unwrap();
        assert_eq!(aborted.snapshot.operation, OperationState::None);
        assert!(aborted.snapshot.entries.is_empty());
        assert!(!fixture.repo.join("picked.txt").exists());
    }

    #[test]
    fn pending_structured_commit_revalidates_the_exact_effect_before_commit() {
        let fixture = GitFixture::new();
        fixture.write("base.txt", "base\n");
        fixture.git(&["add", "--", "base.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        let pre_head = fixture.git_output(&["rev-parse", "HEAD"]);
        fixture.git(&["switch", "-c", "topic"]);
        fixture.write("picked.txt", "picked\n");
        fixture.git(&["add", "--", "picked.txt"]);
        fixture.git(&["commit", "-m", "feat: picked"]);
        let source = fixture.git_output(&["rev-parse", "HEAD"]);
        fixture.git(&["switch", "main"]);

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let action = Action::CherryPick {
            commit: source,
            mainline: None,
        };
        let token = preview_token(
            &workspace,
            &attached.repo_id,
            attached.snapshot.repo_generation,
            action.clone(),
        );
        let pending = workspace
            .execute(ExecuteRequest {
                operation_id: "pending-exact-effect".into(),
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action,
                confirmation_token: Some(token),
            })
            .unwrap();
        assert!(matches!(
            pending.snapshot.operation,
            OperationState::PendingStructuredCommit { .. }
        ));

        let mut journal = workspace.journal.load(&attached.repo_id).unwrap().unwrap();
        journal.effect_digest = Some(hash(b"tampered journal digest"));
        workspace.journal.save(&journal).unwrap();

        let error = workspace
            .execute(ExecuteRequest {
                operation_id: "reject-tampered-effect".into(),
                repo_id: attached.repo_id,
                expected_generation: pending.snapshot.repo_generation,
                action: conventional_commit_action("picked"),
                confirmation_token: None,
            })
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::OperationInProgress);
        assert_eq!(fixture.git_output(&["rev-parse", "HEAD"]), pre_head);
    }

    #[test]
    fn pending_structured_hook_side_effect_recovers_to_abort_only() {
        for operation in [StructuredOperation::CherryPick, StructuredOperation::Revert] {
            assert_pending_hook_failure(operation, true);
        }
    }

    #[test]
    fn pending_structured_hook_failure_without_changes_stays_pending() {
        for operation in [StructuredOperation::CherryPick, StructuredOperation::Revert] {
            assert_pending_hook_failure(operation, false);
        }
    }

    #[test]
    fn directory_file_conflict_is_external_only() {
        let fixture = GitFixture::new();
        fixture.write("seed.txt", "base\n");
        fixture.git(&["add", "--", "seed.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        fixture.git(&["switch", "-c", "topic"]);
        fs::create_dir_all(fixture.repo.join("node")).unwrap();
        fixture.write("node/child.txt", "directory side\n");
        fixture.git(&["add", "--", "node/child.txt"]);
        fixture.git(&["commit", "-m", "feat: add directory"]);
        fixture.git(&["switch", "main"]);
        fixture.write("node", "file side\n");
        fixture.git(&["add", "--", "node"]);
        fixture.git(&["commit", "-m", "feat: add file"]);
        fixture.git_fails(&["merge", "--no-ff", "--no-commit", "topic"]);

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let document = attached
            .snapshot
            .entries
            .iter()
            .filter(|entry| entry.conflict)
            .find_map(|entry| {
                let document = conflict_document(&workspace, &attached.repo_id, &entry.path);
                (document.kind == ConflictKind::DirectoryFile).then_some(document)
            })
            .expect("directory/file conflict document");
        assert!(document.capabilities.external_editor);
        assert!(!document.capabilities.in_app_edit);
        assert!(!document.capabilities.choose_current);
        assert!(!document.capabilities.choose_incoming);
        assert!(!document.capabilities.choose_both);
    }

    #[test]
    fn commit_activity_uses_committer_dates_counts_merges_once_and_reads_only_current_head() {
        const DAY: i64 = 86_400;
        let start = 1_700_000_000;
        let fixture = GitFixture::new();
        fixture.write("base.txt", "base\n");
        fixture.git(&["add", "--", "base.txt"]);
        fixture.git_at(&["commit", "-m", "feat: base"], start + 100);

        fixture.git(&["switch", "-c", "topic"]);
        fixture.write("topic.txt", "topic\n");
        fixture.git(&["add", "--", "topic.txt"]);
        fixture.git_with_author_and_dates(
            &["commit", "-m", "feat: topic"],
            start + 4 * DAY + 100,
            start + DAY + 100,
            "Alternate Author",
            "ALTERNATE@Example.Test",
        );

        fixture.git(&["switch", "main"]);
        fixture.write("main.txt", "main\n");
        fixture.git(&["add", "--", "main.txt"]);
        fixture.git_at(&["commit", "-m", "feat: main"], start + 2 * DAY + 100);
        fixture.git_at(
            &["merge", "--no-ff", "--no-edit", "topic"],
            start + 3 * DAY + 100,
        );

        fixture.git(&["switch", "-c", "side"]);
        fixture.write("side.txt", "side\n");
        fixture.git(&["add", "--", "side.txt"]);
        fixture.git_at(&["commit", "-m", "feat: side"], start + 4 * DAY + 100);
        fixture.git(&["switch", "main"]);

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let boundaries = (0..=5)
            .map(|day| start + i64::from(day) * DAY)
            .collect::<Vec<_>>();
        let result = match workspace
            .query(QueryRequest {
                repo_id: attached.repo_id.clone(),
                query: Query::CommitActivity {
                    operation_id: "commit-activity-1".into(),
                    bucket_boundaries_unix_seconds: boundaries.clone(),
                },
            })
            .unwrap()
        {
            QueryOutcome::CommitActivity(result) => result,
            value => panic!("unexpected query outcome: {value:?}"),
        };

        assert_eq!(
            result.history_revision,
            fixture.git_output(&["rev-parse", "HEAD"]).trim()
        );
        assert_eq!(result.time_basis, CommitActivityTimeBasis::Committed);
        assert_eq!(result.totals.commits, 4);
        assert_eq!(result.totals.active_days, 4);
        assert_eq!(result.totals.contributors, 2);
        assert_eq!(result.totals.branches, 3);
        assert_eq!(
            result
                .buckets
                .iter()
                .map(|bucket| bucket.commit_count)
                .collect::<Vec<_>>(),
            [1, 1, 1, 1, 0]
        );
        assert_eq!(
            result
                .buckets
                .iter()
                .map(|bucket| bucket.contributor_count)
                .collect::<Vec<_>>(),
            [1, 1, 1, 1, 0]
        );
        assert_eq!(
            result
                .buckets
                .iter()
                .map(|bucket| bucket.branch_count)
                .collect::<Vec<_>>(),
            [0, 1, 0, 1, 1]
        );
        assert_eq!(result.coverage, CommitActivityCoverage::Complete);

        fixture.git(&["branch", "spare"]);
        let cached = match workspace
            .query(QueryRequest {
                repo_id: attached.repo_id,
                query: Query::CommitActivity {
                    operation_id: "commit-activity-2".into(),
                    bucket_boundaries_unix_seconds: boundaries,
                },
            })
            .unwrap()
        {
            QueryOutcome::CommitActivity(result) => result,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        assert_eq!(cached.totals.commits, 4);
        assert_eq!(cached.totals.branches, 4);
        assert_eq!(cached.buckets[3].branch_count, 2);
        assert!(cached.repo_generation > result.repo_generation);
    }

    #[test]
    fn unborn_commit_activity_is_zero_filled() {
        let fixture = GitFixture::new();
        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let result = match workspace
            .query(QueryRequest {
                repo_id: attached.repo_id,
                query: Query::CommitActivity {
                    operation_id: "unborn-commit-activity".into(),
                    bucket_boundaries_unix_seconds: vec![1_700_000_000, 1_700_086_400],
                },
            })
            .unwrap()
        {
            QueryOutcome::CommitActivity(result) => result,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        assert_eq!(result.history_revision, UNBORN_HISTORY_REVISION);
        assert_eq!(result.totals.commits, 0);
        assert_eq!(result.totals.active_days, 0);
        assert_eq!(result.totals.contributors, 0);
        assert_eq!(result.totals.branches, 0);
        assert_eq!(result.buckets[0].commit_count, 0);
        assert_eq!(result.coverage, CommitActivityCoverage::Complete);
    }

    #[test]
    fn commit_activity_cancelled_after_registration_never_starts_git() {
        let fixture = GitFixture::new();
        fixture.write("f.txt", "base\n");
        fixture.git(&["add", "--", "f.txt"]);
        fixture.git_at(&["commit", "-m", "feat: base"], 1_700_000_100);

        let marker = fixture.temp.path().join("commit-activity-git-started");
        let wrapper = fixture.temp.path().join("observed-git");
        fs::write(
            &wrapper,
            format!(
                "#!/bin/sh\ncase \"$*\" in\n  *\"--format=%ct%x1f%ae%x1f%an%x1e\"*)\n    : > \"{}\"\n    ;;\nesac\nexec /usr/bin/git \"$@\"\n",
                marker.display()
            ),
        )
        .unwrap();
        let mut permissions = fs::metadata(&wrapper).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&wrapper, permissions).unwrap();

        let workspace = Workspace::new(
            GitExecutor::at(wrapper),
            test_journal_store(&fixture.temp.path().join("pre-worker-cancel-journal")).unwrap(),
        );
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let operation_id = "pre-worker-cancel-commit-activity".to_owned();
        let request = QueryRequest {
            repo_id: attached.repo_id,
            query: Query::CommitActivity {
                operation_id: operation_id.clone(),
                bucket_boundaries_unix_seconds: vec![1_700_000_000, 1_700_086_400],
            },
        };
        let registration = workspace.prepare_query(&request).unwrap();

        assert!(
            workspace
                .cancel(CancelRequest {
                    operation_id: operation_id.clone(),
                })
                .accepted
        );
        let error = workspace.query_prepared(request, registration).unwrap_err();
        assert_eq!(error.code, ErrorCode::Cancelled);
        assert!(!marker.exists(), "cancelled query must not start Git");
        assert!(
            !workspace.cancel(CancelRequest { operation_id }).accepted,
            "cancelled queries must be removed from the operation registry"
        );
    }

    #[test]
    fn commit_activity_is_cancelled_through_the_shared_operation_registry() {
        let fixture = GitFixture::new();
        fixture.write("f.txt", "base\n");
        fixture.git(&["add", "--", "f.txt"]);
        fixture.git_at(&["commit", "-m", "feat: base"], 1_700_000_100);

        let marker = fixture.temp.path().join("commit-activity-started");
        let wrapper = fixture.temp.path().join("slow-git");
        fs::write(
            &wrapper,
            format!(
                "#!/bin/sh\ncase \"$*\" in\n  *\"--format=%ct%x1f%ae%x1f%an%x1e\"*)\n    : > \"{}\"\n    /bin/sleep 30\n    ;;\nesac\nexec /usr/bin/git \"$@\"\n",
                marker.display()
            ),
        )
        .unwrap();
        let mut permissions = fs::metadata(&wrapper).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&wrapper, permissions).unwrap();

        let workspace = Arc::new(Workspace::new(
            GitExecutor::at(wrapper),
            test_journal_store(&fixture.temp.path().join("cancel-journal")).unwrap(),
        ));
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let operation_id = "cancel-commit-activity".to_owned();
        let query_workspace = workspace.clone();
        let query_operation_id = operation_id.clone();
        let handle = std::thread::spawn(move || {
            query_workspace.query(QueryRequest {
                repo_id: attached.repo_id,
                query: Query::CommitActivity {
                    operation_id: query_operation_id,
                    bucket_boundaries_unix_seconds: vec![1_700_000_000, 1_700_086_400],
                },
            })
        });

        for _ in 0..200 {
            if marker.exists() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(marker.exists(), "commit activity Git process did not start");
        assert!(
            workspace
                .cancel(CancelRequest {
                    operation_id: operation_id.clone(),
                })
                .accepted
        );
        let error = handle.join().unwrap().unwrap_err();
        assert_eq!(error.code, ErrorCode::Cancelled);
        assert!(
            !workspace.cancel(CancelRequest { operation_id }).accepted,
            "completed queries must be removed from the operation registry"
        );
    }

    #[test]
    fn commit_activity_retries_once_then_rejects_a_moving_head() {
        let fixture = GitFixture::new();
        fixture.write("f.txt", "first\n");
        fixture.git(&["add", "--", "f.txt"]);
        fixture.git_at(&["commit", "-m", "feat: first"], 1_700_000_100);
        let first_oid = fixture.git_output(&["rev-parse", "HEAD"]).trim().to_owned();
        fixture.write("f.txt", "second\n");
        fixture.git(&["add", "--", "f.txt"]);
        fixture.git_at(&["commit", "-m", "feat: second"], 1_700_086_500);
        let second_oid = fixture.git_output(&["rev-parse", "HEAD"]).trim().to_owned();

        let wrapper = fixture.temp.path().join("moving-head-git");
        fs::write(
            &wrapper,
            format!(
                "#!/bin/sh\ncase \"$*\" in\n  *\"--format=%ct%x1f%ae%x1f%an%x1e\"*)\n    /usr/bin/git \"$@\"\n    status=$?\n    current=$(/usr/bin/git rev-parse HEAD)\n    if [ \"$current\" = \"{second_oid}\" ]; then\n      /usr/bin/git update-ref refs/heads/main {first_oid}\n    else\n      /usr/bin/git update-ref refs/heads/main {second_oid}\n    fi\n    exit $status\n    ;;\nesac\nexec /usr/bin/git \"$@\"\n"
            ),
        )
        .unwrap();
        let mut permissions = fs::metadata(&wrapper).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&wrapper, permissions).unwrap();

        let workspace = Workspace::new(
            GitExecutor::at(wrapper),
            test_journal_store(&fixture.temp.path().join("moving-head-journal")).unwrap(),
        );
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let error = workspace
            .query(QueryRequest {
                repo_id: attached.repo_id,
                query: Query::CommitActivity {
                    operation_id: "moving-head-activity".into(),
                    bucket_boundaries_unix_seconds: vec![
                        1_700_000_000,
                        1_700_086_400,
                        1_700_172_800,
                    ],
                },
            })
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::StaleGeneration);
        assert!(!error.details["beforeHead"].is_empty());
        assert!(!error.details["afterHead"].is_empty());
    }

    #[test]
    fn commit_activity_rechecks_head_after_counting_local_branches() {
        let fixture = GitFixture::new();
        fixture.write("f.txt", "first\n");
        fixture.git(&["add", "--", "f.txt"]);
        fixture.git_at(&["commit", "-m", "feat: first"], 1_700_000_100);
        let first_oid = fixture.git_output(&["rev-parse", "HEAD"]).trim().to_owned();
        fixture.write("f.txt", "second\n");
        fixture.git(&["add", "--", "f.txt"]);
        fixture.git_at(&["commit", "-m", "feat: second"], 1_700_086_500);
        let second_oid = fixture.git_output(&["rev-parse", "HEAD"]).trim().to_owned();

        let marker = fixture.temp.path().join("move-head-during-branch-count");
        let wrapper = fixture.temp.path().join("branch-count-moving-head-git");
        fs::write(
            &wrapper,
            format!(
                "#!/bin/sh\ncase \"$*\" in\n  *\"for-each-ref\"*)\n    /usr/bin/git \"$@\"\n    status=$?\n    if [ -f \"{}\" ]; then\n      current=$(/usr/bin/git rev-parse HEAD)\n      if [ \"$current\" = \"{second_oid}\" ]; then\n        /usr/bin/git update-ref refs/heads/main {first_oid}\n      else\n        /usr/bin/git update-ref refs/heads/main {second_oid}\n      fi\n    fi\n    exit $status\n    ;;\nesac\nexec /usr/bin/git \"$@\"\n",
                marker.display()
            ),
        )
        .unwrap();
        let mut permissions = fs::metadata(&wrapper).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&wrapper, permissions).unwrap();

        let workspace = Workspace::new(
            GitExecutor::at(wrapper),
            test_journal_store(&fixture.temp.path().join("branch-count-moving-head-journal"))
                .unwrap(),
        );
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        fs::write(&marker, b"move").unwrap();

        let error = workspace
            .query(QueryRequest {
                repo_id: attached.repo_id,
                query: Query::CommitActivity {
                    operation_id: "branch-count-moving-head-activity".into(),
                    bucket_boundaries_unix_seconds: vec![
                        1_700_000_000,
                        1_700_086_400,
                        1_700_172_800,
                    ],
                },
            })
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::StaleGeneration);
        assert!(!error.details["beforeHead"].is_empty());
        assert!(!error.details["afterHead"].is_empty());
    }

    #[test]
    fn history_search_matches_subject_author_oid_and_ref_with_match_pagination() {
        let fixture = GitFixture::new();
        fixture.write("f.txt", "first\n");
        fixture.git(&["add", "--", "f.txt"]);
        fixture.git_at(&["commit", "-m", "feat: Needle first"], 1_700_000_100);
        let first_oid = fixture.git_output(&["rev-parse", "HEAD"]).trim().to_owned();

        fixture.write("f.txt", "author\n");
        fixture.git_with_author_and_dates(
            &["commit", "-am", "chore: unrelated"],
            1_700_000_200,
            1_700_000_200,
            "Search Author",
            "search-author@example.test",
        );
        let author_oid = fixture.git_output(&["rev-parse", "HEAD"]).trim().to_owned();

        fixture.write("f.txt", "second\n");
        fixture.git_at(&["commit", "-am", "fix: Needle second"], 1_700_000_300);
        let second_oid = fixture.git_output(&["rev-parse", "HEAD"]).trim().to_owned();
        fixture.git(&[
            "update-ref",
            "refs/remotes/origin/review-candidate",
            &first_oid,
        ]);

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let search = |value: &str, skip: u32| match workspace
            .query(QueryRequest {
                repo_id: attached.repo_id.clone(),
                query: Query::History {
                    limit: 1,
                    skip,
                    search: Some(value.into()),
                },
            })
            .unwrap()
        {
            QueryOutcome::History(result) => result.commits,
            value => panic!("unexpected query outcome: {value:?}"),
        };

        assert_eq!(search("needle", 0)[0].oid, second_oid);
        assert_eq!(search("needle", 1)[0].oid, first_oid);
        assert_eq!(search("search author", 0)[0].oid, author_oid);
        assert_eq!(search(&author_oid[..12], 0)[0].oid, author_oid);
        assert_eq!(search("origin/review", 0)[0].oid, first_oid);
    }

    #[test]
    fn creates_a_lightweight_tag_on_the_selected_commit() {
        let fixture = GitFixture::new();
        fixture.write("f.txt", "first\n");
        fixture.git(&["add", "--", "f.txt"]);
        fixture.git(&["commit", "-m", "feat: first"]);
        let first_oid = fixture.git_output(&["rev-parse", "HEAD"]);
        fixture.write("f.txt", "second\n");
        fixture.git(&["commit", "-am", "feat: second"]);

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let action = Action::CreateTag {
            name: "release/v1.0.0".into(),
            target: first_oid.clone(),
        };
        let token = preview_token(
            &workspace,
            &attached.repo_id,
            attached.snapshot.repo_generation,
            action.clone(),
        );
        let outcome = workspace
            .execute(ExecuteRequest {
                operation_id: "create-tag".into(),
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action,
                confirmation_token: Some(token),
            })
            .unwrap();

        assert_eq!(outcome.summary.id, "backendTagCreated");
        assert!(outcome.repo_generation > attached.snapshot.repo_generation);
        assert_eq!(
            fixture.git_output(&["rev-parse", "refs/tags/release/v1.0.0"]),
            first_oid
        );
        let history = match workspace
            .query(QueryRequest {
                repo_id: attached.repo_id,
                query: Query::History {
                    limit: 10,
                    skip: 0,
                    search: None,
                },
            })
            .unwrap()
        {
            QueryOutcome::History(result) => result.commits,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        assert!(history.iter().any(|commit| {
            commit.oid == first_oid
                && commit
                    .refs
                    .iter()
                    .any(|name| name.contains("refs/tags/release/v1.0.0"))
        }));
    }

    #[test]
    fn commit_details_include_metadata_and_a_root_commit_patch() {
        let fixture = GitFixture::new();
        fixture.write("f.txt", "root\n");
        fixture.git(&["add", "--", "f.txt"]);
        fixture.git(&["commit", "-m", "feat: root", "-m", "body text"]);
        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let details = match workspace
            .query(QueryRequest {
                repo_id: attached.repo_id,
                query: Query::CommitDetails { oid: "HEAD".into() },
            })
            .unwrap()
        {
            QueryOutcome::CommitDetails(details) => details,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        assert!(details.parents.is_empty());
        assert_eq!(details.author, "Stella Test");
        assert_eq!(details.author_email, "stella@example.test");
        assert_eq!(details.subject, "feat: root");
        assert_eq!(details.body, "body text");
        assert!(details.patch.contains("new file mode"));
        assert!(details.patch.contains("+root"));
        assert!(!details.truncated);
    }

    #[test]
    fn commit_details_report_when_the_history_patch_is_truncated() {
        let fixture = GitFixture::new();
        fixture.write("large.txt", &format!("{}\n", "x".repeat(17 * 1024 * 1024)));
        fixture.git(&["add", "--", "large.txt"]);
        fixture.git(&["commit", "-m", "feat: large history patch"]);
        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let details = match workspace
            .query(QueryRequest {
                repo_id: attached.repo_id,
                query: Query::CommitDetails { oid: "HEAD".into() },
            })
            .unwrap()
        {
            QueryOutcome::CommitDetails(details) => details,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        assert!(details.truncated);
        assert!(details.patch.is_empty());
        assert_eq!(details.files.as_ref().map(Vec::len), Some(1));
        assert_eq!(details.files.as_ref().unwrap()[0].path, "large.txt");
    }

    #[test]
    fn commit_file_diff_uses_the_selected_path_and_hides_an_oversized_body() {
        let fixture = GitFixture::new();
        fixture.write("small.txt", "small\n");
        fixture.write("large.txt", &format!("{}\n", "x".repeat(DIFF_LIMIT + 1)));
        fixture.git(&["add", "--", "small.txt", "large.txt"]);
        fixture.git(&["commit", "-m", "feat: large file"]);
        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let details = match workspace
            .query(QueryRequest {
                repo_id: attached.repo_id.clone(),
                query: Query::CommitDetails { oid: "HEAD".into() },
            })
            .unwrap()
        {
            QueryOutcome::CommitDetails(details) => details,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        assert!(details.truncated);
        assert_eq!(details.files.as_ref().map(Vec::len), Some(2));
        assert!(
            details
                .files
                .as_ref()
                .unwrap()
                .iter()
                .any(|file| file.path == "small.txt")
        );
        let diff = match workspace
            .query(QueryRequest {
                repo_id: attached.repo_id.clone(),
                query: Query::CommitFileDiff {
                    oid: "HEAD".into(),
                    path: "large.txt".into(),
                    previous_path: None,
                },
            })
            .unwrap()
        {
            QueryOutcome::CommitFileDiff(diff) => diff,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        assert!(diff.truncated);
        assert!(diff.patch.is_empty());
        let small = match workspace
            .query(QueryRequest {
                repo_id: attached.repo_id.clone(),
                query: Query::CommitFileDiff {
                    oid: "HEAD".into(),
                    path: "small.txt".into(),
                    previous_path: None,
                },
            })
            .unwrap()
        {
            QueryOutcome::CommitFileDiff(diff) => diff,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        assert!(!small.truncated);
        assert!(small.patch.contains("small.txt"));
        assert!(
            workspace
                .query(QueryRequest {
                    repo_id: attached.repo_id,
                    query: Query::CommitFileDiff {
                        oid: "HEAD".into(),
                        path: "../outside".into(),
                        previous_path: None,
                    },
                })
                .is_err()
        );
    }

    #[test]
    fn arbitrary_pre_commit_failure_is_classified_and_refreshes_state() {
        let fixture = GitFixture::new();
        fixture.write("f.txt", "base\n");
        fixture.git(&["add", "--", "f.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        fixture.write("f.txt", "changed\n");

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let hook = fixture.repo.join(".git/hooks/pre-commit");
        fs::write(
            &hook,
            "#!/bin/sh\nprintf 'created by policy\\n' > hook-side-effect.txt\nprintf 'policy denied this commit\\n' >&2\nexit 1\n",
        )
        .unwrap();
        let mut permissions = fs::metadata(&hook).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&hook, permissions).unwrap();

        let error = workspace
            .execute(ExecuteRequest {
                operation_id: "blocked-commit".into(),
                repo_id: attached.repo_id,
                expected_generation: attached.snapshot.repo_generation,
                action: Action::Commit {
                    input: CommitInput::Conventional {
                        commit_type: "feat".into(),
                        scope: None,
                        breaking: false,
                        description: "blocked".into(),
                        body: None,
                        footers: Vec::new(),
                    },
                    include_all_changes: true,
                },
                confirmation_token: None,
            })
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::HookFailed);
        assert!(
            error
                .details
                .get("stderr")
                .is_some_and(|stderr| stderr.contains("policy denied this commit"))
        );
        assert_eq!(
            fixture.git_output(&["diff", "--cached", "--name-only"]),
            "f.txt"
        );
        assert_eq!(fixture.git_output(&["diff", "--name-only"]), "");
        let refreshed_generation: u64 = error.details["repoGeneration"].parse().unwrap();
        assert!(refreshed_generation > attached.snapshot.repo_generation);
        assert!(fixture.repo.join("hook-side-effect.txt").is_file());
    }

    #[test]
    fn cancellation_terminates_a_hook_process_group() {
        let fixture = GitFixture::new();
        fixture.write("f.txt", "base\n");
        fixture.git(&["add", "--", "f.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        fixture.write("f.txt", "changed\n");
        fixture.git(&["add", "--", "f.txt"]);
        let child_pid = fixture.repo.join("hook-child.pid");
        let hook = fixture.repo.join(".git/hooks/pre-commit");
        fs::write(
            &hook,
            format!(
                "#!/bin/sh\nsleep 30 &\nprintf '%s' \"$!\" > '{}'\nwait\n",
                child_pid.display()
            ),
        )
        .unwrap();
        let mut permissions = fs::metadata(&hook).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&hook, permissions).unwrap();

        let workspace = Arc::new(fixture.workspace());
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let running = Arc::clone(&workspace);
        let handle = std::thread::spawn(move || {
            running.execute(ExecuteRequest {
                operation_id: "cancel-hook-tree".into(),
                repo_id: attached.repo_id,
                expected_generation: attached.snapshot.repo_generation,
                action: conventional_commit_action("cancel hook"),
                confirmation_token: None,
            })
        });
        for _ in 0..100 {
            if child_pid.is_file() {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(child_pid.is_file(), "hook did not start");
        assert!(
            workspace
                .cancel(CancelRequest {
                    operation_id: "cancel-hook-tree".into(),
                })
                .accepted
        );
        let error = handle.join().unwrap().unwrap_err();
        assert_eq!(error.code, ErrorCode::Cancelled);

        let pid = fs::read_to_string(&child_pid).unwrap();
        let mut alive = true;
        for _ in 0..100 {
            alive = Command::new("/bin/kill")
                .args(["-0", pid.trim()])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .is_ok_and(|status| status.success());
            if !alive {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(!alive, "hook child process survived cancellation");
    }

    #[test]
    fn initial_push_targets_only_the_explicit_branch_on_a_bare_remote() {
        let fixture = GitFixture::new();
        fixture.write("f.txt", "base\n");
        fixture.git(&["add", "--", "f.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        let bare = fixture.temp.path().join("remote.git");
        run_git(
            fixture.temp.path(),
            &["init", "--bare", "-b", "main", bare.to_str().unwrap()],
        );
        fixture.git(&["remote", "add", "origin", bare.to_str().unwrap()]);

        let workspace = fixture.workspace();
        let session = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let outcome = workspace
            .execute(ExecuteRequest {
                operation_id: "initial-push".into(),
                repo_id: session.repo_id,
                expected_generation: session.snapshot.repo_generation,
                action: Action::Push {
                    remote: "origin".into(),
                    local_branch: "main".into(),
                    remote_branch: "main".into(),
                    set_upstream: true,
                    force_with_lease: false,
                    push_tags: false,
                },
                confirmation_token: None,
            })
            .unwrap();
        assert_eq!(outcome.snapshot.upstream.as_deref(), Some("origin/main"));
        let remote_head = run_git_output(
            fixture.temp.path(),
            &[
                "--git-dir",
                bare.to_str().unwrap(),
                "rev-parse",
                "refs/heads/main",
            ],
        );
        assert_eq!(remote_head, fixture.git_output(&["rev-parse", "HEAD"]));
    }

    #[test]
    fn rejected_tag_keeps_the_branch_and_upstream_unchanged() {
        let fixture = GitFixture::new();
        fixture.write("f.txt", "base\n");
        fixture.git(&["add", "--", "f.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        fixture.git(&["tag", "existing"]);
        let bare = fixture.temp.path().join("remote.git");
        run_git(
            fixture.temp.path(),
            &["init", "--bare", "-b", "main", bare.to_str().unwrap()],
        );
        fixture.git(&["remote", "add", "origin", bare.to_str().unwrap()]);
        fixture.git(&["push", "origin", "main", "--tags"]);
        let remote_head = run_git_output(
            fixture.temp.path(),
            &[
                "--git-dir",
                bare.to_str().unwrap(),
                "rev-parse",
                "refs/heads/main",
            ],
        );

        fixture.write("local.txt", "local\n");
        fixture.git(&["add", "--", "local.txt"]);
        fixture.git(&["commit", "-m", "feat: local update"]);
        fixture.git(&["tag", "-f", "existing"]);
        fixture.git_fails(&["config", "--get", "branch.main.remote"]);

        let workspace = fixture.workspace();
        let session = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let error = workspace
            .execute(ExecuteRequest {
                operation_id: "atomic-tag-rejection".into(),
                repo_id: session.repo_id,
                expected_generation: session.snapshot.repo_generation,
                action: Action::Push {
                    remote: "origin".into(),
                    local_branch: "main".into(),
                    remote_branch: "main".into(),
                    set_upstream: true,
                    force_with_lease: false,
                    push_tags: true,
                },
                confirmation_token: None,
            })
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::GitFailed);
        assert_eq!(
            run_git_output(
                fixture.temp.path(),
                &[
                    "--git-dir",
                    bare.to_str().unwrap(),
                    "rev-parse",
                    "refs/heads/main",
                ],
            ),
            remote_head
        );
        fixture.git_fails(&["config", "--get", "branch.main.remote"]);
    }

    #[test]
    fn force_with_lease_rejects_a_remote_branch_updated_elsewhere() {
        let fixture = GitFixture::new();
        fixture.write("f.txt", "base\n");
        fixture.git(&["add", "--", "f.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        let bare = fixture.temp.path().join("remote.git");
        run_git(
            fixture.temp.path(),
            &["init", "--bare", "-b", "main", bare.to_str().unwrap()],
        );
        fixture.git(&["remote", "add", "origin", bare.to_str().unwrap()]);
        fixture.git(&["push", "--set-upstream", "origin", "main"]);

        let other = fixture.temp.path().join("other");
        run_git(
            fixture.temp.path(),
            &["clone", bare.to_str().unwrap(), other.to_str().unwrap()],
        );
        run_git(&other, &["config", "user.name", "Other Test"]);
        run_git(&other, &["config", "user.email", "other@example.test"]);
        fs::write(other.join("other.txt"), "remote\n").unwrap();
        run_git(&other, &["add", "--", "other.txt"]);
        run_git(&other, &["commit", "-m", "feat: remote update"]);
        run_git(&other, &["push", "origin", "main"]);
        let remote_head = run_git_output(&other, &["rev-parse", "HEAD"]);

        fixture.write("local.txt", "local\n");
        fixture.git(&["add", "--", "local.txt"]);
        fixture.git(&["commit", "-m", "feat: local update"]);
        let workspace = fixture.workspace();
        let session = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let error = workspace
            .execute(ExecuteRequest {
                operation_id: "stale-force-lease".into(),
                repo_id: session.repo_id,
                expected_generation: session.snapshot.repo_generation,
                action: Action::Push {
                    remote: "origin".into(),
                    local_branch: "main".into(),
                    remote_branch: "main".into(),
                    set_upstream: false,
                    force_with_lease: true,
                    push_tags: false,
                },
                confirmation_token: None,
            })
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::GitFailed);
        assert_eq!(
            run_git_output(
                fixture.temp.path(),
                &[
                    "--git-dir",
                    bare.to_str().unwrap(),
                    "rev-parse",
                    "refs/heads/main",
                ],
            ),
            remote_head
        );
    }

    #[test]
    fn force_with_lease_uses_an_empty_expectation_without_tracking_information() {
        let fixture = GitFixture::new();
        fixture.write("f.txt", "base\n");
        fixture.git(&["add", "--", "f.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        let bare = fixture.temp.path().join("remote.git");
        run_git(
            fixture.temp.path(),
            &["init", "--bare", "-b", "main", bare.to_str().unwrap()],
        );
        fixture.git(&["remote", "add", "origin", bare.to_str().unwrap()]);
        fixture.git(&["push", "origin", "main"]);
        fixture.git(&["update-ref", "-d", "refs/remotes/origin/main"]);
        fixture.write("local.txt", "local\n");
        fixture.git(&["add", "--", "local.txt"]);
        fixture.git(&["commit", "-m", "feat: local update"]);

        let workspace = fixture.workspace();
        let session = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let error = workspace
            .execute(ExecuteRequest {
                operation_id: "empty-force-lease".into(),
                repo_id: session.repo_id,
                expected_generation: session.snapshot.repo_generation,
                action: Action::Push {
                    remote: "origin".into(),
                    local_branch: "main".into(),
                    remote_branch: "main".into(),
                    set_upstream: false,
                    force_with_lease: true,
                    push_tags: false,
                },
                confirmation_token: None,
            })
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::GitFailed);
    }

    #[test]
    fn push_tags_sends_all_tags_to_git_and_git_lfs() {
        let fixture = GitFixture::new();
        fixture.write("main.txt", "main\n");
        fixture.git(&["add", "--", "main.txt"]);
        fixture.git(&["commit", "-m", "feat: main"]);
        fixture.git(&["tag", "v-main"]);
        fixture.git(&["switch", "-c", "tagged"]);
        fixture.write("tagged.txt", "tagged\n");
        fixture.git(&["add", "--", "tagged.txt"]);
        fixture.git(&["commit", "-m", "feat: tagged object"]);
        fixture.git(&["tag", "v-tagged"]);
        fixture.git(&["switch", "main"]);

        let bare = fixture.temp.path().join("remote.git");
        run_git(
            fixture.temp.path(),
            &["init", "--bare", "-b", "main", bare.to_str().unwrap()],
        );
        fixture.git(&["remote", "add", "origin", bare.to_str().unwrap()]);
        let lfs_log = fixture.temp.path().join("lfs-args");
        let lfs = fixture.temp.path().join("git-lfs");
        fs::write(
            &lfs,
            format!(
                "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"{}\"\n",
                lfs_log.display()
            ),
        )
        .unwrap();
        let mut permissions = fs::metadata(&lfs).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&lfs, permissions).unwrap();
        let workspace = Workspace::new(
            GitExecutor::configured(
                PathBuf::from("/usr/bin/git"),
                Some(lfs),
                None,
                Vec::new(),
                None,
            ),
            test_journal_store(&fixture.temp.path().join("lfs-journal")).unwrap(),
        );
        let session = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();

        workspace
            .execute(ExecuteRequest {
                operation_id: "push-tags-with-lfs".into(),
                repo_id: session.repo_id,
                expected_generation: session.snapshot.repo_generation,
                action: Action::Push {
                    remote: "origin".into(),
                    local_branch: "main".into(),
                    remote_branch: "main".into(),
                    set_upstream: true,
                    force_with_lease: false,
                    push_tags: true,
                },
                confirmation_token: None,
            })
            .unwrap();

        let lfs_args = fs::read_to_string(lfs_log).unwrap();
        assert_eq!(
            lfs_args.lines().collect::<Vec<_>>(),
            [
                "push",
                "--all",
                "origin",
                "refs/heads/main",
                "refs/tags/v-main",
                "refs/tags/v-tagged",
            ]
        );
        for tag in ["v-main", "v-tagged"] {
            assert!(
                !run_git_output(
                    fixture.temp.path(),
                    &[
                        "--git-dir",
                        bare.to_str().unwrap(),
                        "rev-parse",
                        &format!("refs/tags/{tag}"),
                    ],
                )
                .is_empty()
            );
        }
    }

    fn assert_external_structured_continue_is_rejected(operation: StructuredOperation) {
        let fixture = GitFixture::new();
        fixture.write("f.txt", "base\n");
        fixture.git(&["add", "--", "f.txt"]);
        fixture.git(&["commit", "-m", "feat: external operation base"]);

        let (label, marker, source_oid, expected_operation) = match operation {
            StructuredOperation::CherryPick => {
                fixture.git(&["switch", "-c", "topic"]);
                fixture.write("f.txt", "incoming\n");
                fixture.git(&["commit", "-am", "feat: external cherry-pick source"]);
                let source_oid = fixture.git_output(&["rev-parse", "HEAD"]);
                fixture.git(&["switch", "main"]);
                fixture.write("f.txt", "current\n");
                fixture.git(&["commit", "-am", "feat: external cherry-pick current"]);
                fixture.git_fails(&["cherry-pick", "--", &source_oid]);
                (
                    "cherry-pick",
                    "CHERRY_PICK_HEAD",
                    source_oid.clone(),
                    OperationState::CherryPick {
                        source_oid: Some(source_oid),
                    },
                )
            }
            StructuredOperation::Revert => {
                fixture.write("f.txt", "target\n");
                fixture.git(&["commit", "-am", "feat: external revert target"]);
                let source_oid = fixture.git_output(&["rev-parse", "HEAD"]);
                fixture.write("f.txt", "later\n");
                fixture.git(&["commit", "-am", "feat: external revert later"]);
                fixture.git_fails(&["revert", "--", &source_oid]);
                (
                    "revert",
                    "REVERT_HEAD",
                    source_oid.clone(),
                    OperationState::Revert {
                        source_oid: Some(source_oid),
                    },
                )
            }
        };
        let pre_continue_head = fixture.git_output(&["rev-parse", "HEAD"]);
        fixture.write("f.txt", "resolved\n");
        fixture.git(&["add", "--", "f.txt"]);
        let marker_path = fixture.repo.join(".git").join(marker);
        assert!(marker_path.exists(), "{label} must have a Git marker");

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        assert_eq!(attached.snapshot.operation, expected_operation);
        assert!(workspace.journal.load(&attached.repo_id).unwrap().is_none());

        let error = workspace
            .execute(ExecuteRequest {
                operation_id: format!("reject-external-{label}-continue"),
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action: Action::Continue,
                confirmation_token: None,
            })
            .unwrap_err();

        assert_eq!(error.code, ErrorCode::OperationInProgress);
        assert!(error.message.contains("outside the app"));
        assert!(
            marker_path.exists(),
            "{label} marker must remain after rejection"
        );
        assert_eq!(
            fixture.git_output(&["rev-parse", "HEAD"]),
            pre_continue_head
        );
        assert!(workspace.journal.load(&attached.repo_id).unwrap().is_none());
        let refreshed = match workspace
            .query(QueryRequest {
                repo_id: attached.repo_id,
                query: Query::Status,
            })
            .unwrap()
        {
            QueryOutcome::Status(snapshot) => snapshot,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        assert_eq!(refreshed.operation, expected_operation);
        assert_eq!(fixture.git_output(&["rev-parse", marker]), source_oid);
    }

    fn assert_pending_hook_failure(operation: StructuredOperation, changes_effect: bool) {
        let fixture = GitFixture::new();
        fixture.write("base.txt", "base\n");
        fixture.git(&["add", "--", "base.txt"]);
        fixture.git(&["commit", "-m", "feat: hook recovery base"]);
        let (label, source_oid, pre_head_oid) = match operation {
            StructuredOperation::CherryPick => {
                fixture.git(&["switch", "-c", "topic"]);
                fixture.write("effect.txt", "cherry-pick effect\n");
                fixture.git(&["add", "--", "effect.txt"]);
                fixture.git(&["commit", "-m", "feat: hook recovery source"]);
                let source_oid = fixture.git_output(&["rev-parse", "HEAD"]);
                fixture.git(&["switch", "main"]);
                let pre_head_oid = fixture.git_output(&["rev-parse", "HEAD"]);
                ("cherry-pick", source_oid, pre_head_oid)
            }
            StructuredOperation::Revert => {
                fixture.write("effect.txt", "revert target\n");
                fixture.git(&["add", "--", "effect.txt"]);
                fixture.git(&["commit", "-m", "feat: hook recovery target"]);
                let source_oid = fixture.git_output(&["rev-parse", "HEAD"]);
                ("revert", source_oid.clone(), source_oid)
            }
        };
        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let action = match operation {
            StructuredOperation::CherryPick => Action::CherryPick {
                commit: source_oid.clone(),
                mainline: None,
            },
            StructuredOperation::Revert => Action::Revert {
                commit: source_oid.clone(),
                mainline: None,
            },
        };
        let token = preview_token(
            &workspace,
            &attached.repo_id,
            attached.snapshot.repo_generation,
            action.clone(),
        );
        let pending = workspace
            .execute(ExecuteRequest {
                operation_id: format!("{label}-hook-pending"),
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action,
                confirmation_token: Some(token),
            })
            .unwrap();
        assert!(matches!(
            pending.snapshot.operation,
            OperationState::PendingStructuredCommit { .. }
        ));

        let hook = fixture.repo.join(".git/hooks/pre-commit");
        let hook_source = if changes_effect {
            "#!/bin/sh\nprintf 'created by hook\\n' > hook-side-effect.txt\n/usr/bin/git add -- hook-side-effect.txt\nprintf 'structured policy denied this commit\\n' >&2\nexit 1\n"
        } else {
            "#!/bin/sh\nprintf 'structured policy denied this commit\\n' >&2\nexit 1\n"
        };
        fs::write(&hook, hook_source).unwrap();
        let mut permissions = fs::metadata(&hook).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&hook, permissions).unwrap();

        let error = workspace
            .execute(ExecuteRequest {
                operation_id: format!("{label}-hook-failed-commit"),
                repo_id: attached.repo_id.clone(),
                expected_generation: pending.repo_generation,
                action: conventional_commit_action("hook failure"),
                confirmation_token: None,
            })
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::HookFailed);
        assert!(
            error
                .details
                .get("stderr")
                .is_some_and(|stderr| stderr.contains("structured policy denied this commit"))
        );
        assert!(error.details.contains_key("repoGeneration"));
        if changes_effect {
            let refreshed_generation: u64 = error.details["repoGeneration"].parse().unwrap();
            assert!(refreshed_generation > pending.repo_generation);
        }
        drop(workspace);

        let restarted = fixture.workspace();
        let recovered = restarted
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        if !changes_effect {
            assert!(matches!(
                recovered.snapshot.operation,
                OperationState::PendingStructuredCommit { .. }
            ));
            return;
        }

        assert_eq!(
            recovered.snapshot.operation,
            OperationState::StructuredAbortRecovery {
                operation,
                source_oid,
                pre_head_oid: pre_head_oid.clone(),
            }
        );
        let commit_error = restarted
            .execute(ExecuteRequest {
                operation_id: format!("{label}-hook-recovery-commit"),
                repo_id: recovered.repo_id.clone(),
                expected_generation: recovered.snapshot.repo_generation,
                action: conventional_commit_action("must remain abort-only"),
                confirmation_token: None,
            })
            .unwrap_err();
        assert_eq!(commit_error.code, ErrorCode::OperationInProgress);

        let abort = Action::Abort;
        let preview = restarted
            .preview(PreviewRequest {
                repo_id: recovered.repo_id.clone(),
                expected_generation: recovered.snapshot.repo_generation,
                action: abort.clone(),
            })
            .unwrap();
        fixture.write("hook-side-effect.txt", "edited after preview\n");
        let changed = match restarted
            .query(QueryRequest {
                repo_id: recovered.repo_id.clone(),
                query: Query::Status,
            })
            .unwrap()
        {
            QueryOutcome::Status(snapshot) => snapshot,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        let stale = restarted
            .execute(ExecuteRequest {
                operation_id: format!("{label}-hook-stale-abort"),
                repo_id: recovered.repo_id.clone(),
                expected_generation: changed.repo_generation,
                action: abort.clone(),
                confirmation_token: preview.confirmation_token,
            })
            .unwrap_err();
        assert_eq!(stale.code, ErrorCode::PreviewMismatch);
        let retry = restarted
            .preview(PreviewRequest {
                repo_id: recovered.repo_id.clone(),
                expected_generation: changed.repo_generation,
                action: abort.clone(),
            })
            .unwrap();
        let aborted = restarted
            .execute(ExecuteRequest {
                operation_id: format!("{label}-hook-abort"),
                repo_id: recovered.repo_id,
                expected_generation: changed.repo_generation,
                action: abort,
                confirmation_token: retry.confirmation_token,
            })
            .unwrap();
        assert_eq!(aborted.snapshot.operation, OperationState::None);
        assert_eq!(fixture.git_output(&["rev-parse", "HEAD"]), pre_head_oid);
        assert!(fixture.git_output(&["status", "--porcelain=v2"]).is_empty());
    }

    fn assert_interrupted_structured_recovery(
        operation: StructuredOperation,
        applied_before_crash: bool,
    ) {
        let fixture = GitFixture::new();
        fixture.write("base.txt", "base\n");
        fixture.git(&["add", "--", "base.txt"]);
        fixture.git(&["commit", "-m", "feat: recovery base"]);
        let (label, source_oid, pre_head_oid) = match operation {
            StructuredOperation::CherryPick => {
                fixture.git(&["switch", "-c", "topic"]);
                fixture.write("effect.txt", "cherry-pick effect\n");
                fixture.git(&["add", "--", "effect.txt"]);
                fixture.git(&["commit", "-m", "feat: recovery source"]);
                let source_oid = fixture.git_output(&["rev-parse", "HEAD"]);
                fixture.git(&["switch", "main"]);
                let pre_head_oid = fixture.git_output(&["rev-parse", "HEAD"]);
                ("cherry-pick", source_oid, pre_head_oid)
            }
            StructuredOperation::Revert => {
                fixture.write("effect.txt", "revert target\n");
                fixture.git(&["add", "--", "effect.txt"]);
                fixture.git(&["commit", "-m", "feat: recovery target"]);
                let source_oid = fixture.git_output(&["rev-parse", "HEAD"]);
                ("revert", source_oid.clone(), source_oid)
            }
        };
        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        workspace
            .journal
            .save(&OperationJournal {
                worktree_id: attached.repo_id.clone(),
                operation,
                source_oid: source_oid.clone(),
                pre_head_oid: pre_head_oid.clone(),
                phase: Some(JournalPhase::Preparing),
                effect_digest: None,
                state_fingerprint: None,
            })
            .unwrap();
        if applied_before_crash {
            match operation {
                StructuredOperation::CherryPick => {
                    fixture.git(&["cherry-pick", "--no-commit", "--", &source_oid]);
                }
                StructuredOperation::Revert => {
                    fixture.git(&["revert", "--no-commit", "--", &source_oid]);
                }
            }
            assert!(!fixture.git_output(&["status", "--porcelain=v2"]).is_empty());
        }
        drop(workspace);

        let restarted = fixture.workspace();
        let recovered = restarted
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        assert_eq!(
            recovered.snapshot.operation,
            OperationState::StructuredAbortRecovery {
                operation,
                source_oid: source_oid.clone(),
                pre_head_oid: pre_head_oid.clone(),
            },
            "{label} applied={applied_before_crash}"
        );
        let commit_error = restarted
            .execute(ExecuteRequest {
                operation_id: format!("{label}-interrupted-commit"),
                repo_id: recovered.repo_id.clone(),
                expected_generation: recovered.snapshot.repo_generation,
                action: conventional_commit_action("must stay abort-only"),
                confirmation_token: None,
            })
            .unwrap_err();
        assert_eq!(commit_error.code, ErrorCode::OperationInProgress);

        let abort = Action::Abort;
        let preview = restarted
            .preview(PreviewRequest {
                repo_id: recovered.repo_id.clone(),
                expected_generation: recovered.snapshot.repo_generation,
                action: abort.clone(),
            })
            .unwrap();
        let (generation, confirmation_token) = if applied_before_crash {
            fixture.write("effect.txt", "edited after abort preview\n");
            let changed = match restarted
                .query(QueryRequest {
                    repo_id: recovered.repo_id.clone(),
                    query: Query::Status,
                })
                .unwrap()
            {
                QueryOutcome::Status(snapshot) => snapshot,
                value => panic!("unexpected query outcome: {value:?}"),
            };
            let stale = restarted
                .execute(ExecuteRequest {
                    operation_id: format!("{label}-stale-interrupted-abort"),
                    repo_id: recovered.repo_id.clone(),
                    expected_generation: changed.repo_generation,
                    action: abort.clone(),
                    confirmation_token: preview.confirmation_token,
                })
                .unwrap_err();
            assert_eq!(stale.code, ErrorCode::PreviewMismatch);
            let retry = restarted
                .preview(PreviewRequest {
                    repo_id: recovered.repo_id.clone(),
                    expected_generation: changed.repo_generation,
                    action: abort.clone(),
                })
                .unwrap();
            (changed.repo_generation, retry.confirmation_token)
        } else {
            (
                recovered.snapshot.repo_generation,
                preview.confirmation_token,
            )
        };
        let aborted = restarted
            .execute(ExecuteRequest {
                operation_id: format!("{label}-interrupted-abort"),
                repo_id: recovered.repo_id.clone(),
                expected_generation: generation,
                action: abort,
                confirmation_token,
            })
            .unwrap();

        assert_eq!(aborted.snapshot.operation, OperationState::None);
        assert_eq!(fixture.git_output(&["rev-parse", "HEAD"]), pre_head_oid);
        assert!(fixture.git_output(&["status", "--porcelain=v2"]).is_empty());
        assert!(
            restarted
                .journal
                .load(&recovered.repo_id)
                .unwrap()
                .is_none()
        );
    }

    fn conflict_operation_fixtures() -> Vec<(&'static str, GitFixture, Action)> {
        let merge = GitFixture::new();
        merge.write("f.txt", "base\n");
        merge.git(&["add", "--", "f.txt"]);
        merge.git(&["commit", "-m", "feat: base"]);
        merge.git(&["switch", "-c", "topic"]);
        merge.write("f.txt", "topic\n");
        merge.git(&["commit", "-am", "feat: topic"]);
        merge.git(&["switch", "main"]);
        merge.write("f.txt", "main\n");
        merge.git(&["commit", "-am", "feat: main"]);

        let rebase = GitFixture::new();
        rebase.write("f.txt", "base\n");
        rebase.git(&["add", "--", "f.txt"]);
        rebase.git(&["commit", "-m", "feat: base"]);
        rebase.git(&["switch", "-c", "topic"]);
        rebase.write("f.txt", "topic\n");
        rebase.git(&["commit", "-am", "feat: topic"]);
        rebase.git(&["switch", "main"]);
        rebase.write("f.txt", "main\n");
        rebase.git(&["commit", "-am", "feat: main"]);
        rebase.git(&["switch", "topic"]);

        let cherry_pick = GitFixture::new();
        cherry_pick.write("f.txt", "base\n");
        cherry_pick.git(&["add", "--", "f.txt"]);
        cherry_pick.git(&["commit", "-m", "feat: base"]);
        cherry_pick.git(&["switch", "-c", "topic"]);
        cherry_pick.write("f.txt", "topic\n");
        cherry_pick.git(&["commit", "-am", "feat: topic"]);
        let cherry_oid = cherry_pick.git_output(&["rev-parse", "HEAD"]);
        cherry_pick.git(&["switch", "main"]);
        cherry_pick.write("f.txt", "main\n");
        cherry_pick.git(&["commit", "-am", "feat: main"]);

        let revert = GitFixture::new();
        revert.write("f.txt", "base\n");
        revert.git(&["add", "--", "f.txt"]);
        revert.git(&["commit", "-m", "feat: base"]);
        revert.write("f.txt", "target\n");
        revert.git(&["commit", "-am", "feat: target"]);
        let revert_oid = revert.git_output(&["rev-parse", "HEAD"]);
        revert.write("f.txt", "later\n");
        revert.git(&["commit", "-am", "feat: later"]);

        vec![
            (
                "merge",
                merge,
                Action::Merge {
                    source: "topic".into(),
                    commit_immediately: false,
                },
            ),
            (
                "rebase",
                rebase,
                Action::Rebase {
                    onto: "main".into(),
                },
            ),
            (
                "cherry-pick",
                cherry_pick,
                Action::CherryPick {
                    commit: cherry_oid,
                    mainline: None,
                },
            ),
            (
                "revert",
                revert,
                Action::Revert {
                    commit: revert_oid,
                    mainline: None,
                },
            ),
        ]
    }

    fn resolve_conflicting_action(label: &str, fixture: &GitFixture, action: Action) {
        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let token = preview_token(
            &workspace,
            &attached.repo_id,
            attached.snapshot.repo_generation,
            action.clone(),
        );
        let error = workspace
            .execute(ExecuteRequest {
                operation_id: format!("{label}-start"),
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action,
                confirmation_token: Some(token),
            })
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::GitFailed, "{label}");
        let status = match workspace
            .query(QueryRequest {
                repo_id: attached.repo_id.clone(),
                query: Query::Status,
            })
            .unwrap()
        {
            QueryOutcome::Status(status) => status,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        let document = conflict_document(&workspace, &attached.repo_id, "f.txt");
        let block = document.blocks.first().expect("text conflict block");
        let chosen = workspace
            .execute(ExecuteRequest {
                operation_id: format!("{label}-choice"),
                repo_id: attached.repo_id.clone(),
                expected_generation: status.repo_generation,
                action: Action::ConflictChoice {
                    session_id: document.session_id.clone(),
                    conflict_generation: document.conflict_generation.clone(),
                    content_hash: document.content_hash.clone(),
                    document_revision: hash(document.result.text.as_bytes()),
                    base_document_revision: hash(document.result.text.as_bytes()),
                    block_id: block.id.clone(),
                    draft_text: document.result.text.clone(),
                    choice: ConflictChoice::Current,
                },
                confirmation_token: None,
            })
            .unwrap();
        let edit = chosen.conflict_edit.expect("choice edit");
        let saved = workspace
            .execute(ExecuteRequest {
                operation_id: format!("{label}-save"),
                repo_id: attached.repo_id.clone(),
                expected_generation: chosen.repo_generation,
                action: Action::ConflictSave {
                    session_id: document.session_id,
                    conflict_generation: document.conflict_generation,
                    content_hash: document.content_hash,
                    result: edit.text,
                },
                confirmation_token: None,
            })
            .unwrap();
        let refreshed = saved
            .conflict_document
            .expect("save returns refreshed document");
        workspace
            .execute(ExecuteRequest {
                operation_id: format!("{label}-resolve"),
                repo_id: attached.repo_id,
                expected_generation: saved.repo_generation,
                action: Action::ConflictMarkResolved {
                    session_id: refreshed.session_id,
                    conflict_generation: refreshed.conflict_generation,
                    content_hash: refreshed.content_hash,
                    result_kind: ConflictResultKind::File,
                },
                confirmation_token: None,
            })
            .unwrap();
        assert!(
            fixture
                .git_output(&["ls-files", "-u", "--", "f.txt"])
                .is_empty(),
            "{label}"
        );
    }

    #[test]
    fn attaching_lfs_repository_without_lfs_is_rejected() {
        let fixture = GitFixture::new();
        fixture.write(
            ".gitattributes",
            "*.bin filter=lfs diff=lfs merge=lfs -text\n",
        );
        fixture.git(&["add", "--", ".gitattributes"]);
        fixture.git(&["commit", "-m", "test: LFS属性を追加"]);
        let error = fixture
            .workspace()
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::UnsupportedRepository);
        assert_eq!(
            error.details.get("requiredComponent").map(String::as_str),
            Some("git-lfs")
        );
    }

    #[test]
    fn pushing_repository_that_started_using_lfs_after_attach_is_rejected_without_lfs() {
        let fixture = GitFixture::new();
        fixture.write("f.txt", "base\n");
        fixture.git(&["add", "--", "f.txt"]);
        fixture.git(&["commit", "-m", "test: 初期コミット"]);
        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();

        fixture.write(
            ".gitattributes",
            "*.bin filter=lfs diff=lfs merge=lfs -text\n",
        );
        fixture.git(&["add", "--", ".gitattributes"]);
        fixture.git(&["commit", "-m", "test: LFS属性を追加"]);
        let status = match workspace
            .query(QueryRequest {
                repo_id: attached.repo_id.clone(),
                query: Query::Status,
            })
            .unwrap()
        {
            QueryOutcome::Status(status) => status,
            value => panic!("unexpected query outcome: {value:?}"),
        };

        let error = workspace
            .execute(ExecuteRequest {
                operation_id: "push-without-lfs".into(),
                repo_id: attached.repo_id,
                expected_generation: status.repo_generation,
                action: Action::Push {
                    remote: "origin".into(),
                    local_branch: "main".into(),
                    remote_branch: "main".into(),
                    set_upstream: true,
                    force_with_lease: false,
                    push_tags: false,
                },
                confirmation_token: None,
            })
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::UnsupportedRepository);
        assert_eq!(
            error.details.get("requiredComponent").map(String::as_str),
            Some("git-lfs")
        );
    }

    #[test]
    fn file_contents_and_save_preserve_bom_crlf_and_the_staged_index() {
        use std::os::unix::fs::PermissionsExt;

        let fixture = GitFixture::new();
        fs::write(fixture.repo.join("note.txt"), b"\xEF\xBB\xBFbase\r\n").unwrap();
        fixture.git(&["add", "--", "note.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        fs::write(fixture.repo.join("note.txt"), b"\xEF\xBB\xBFstaged\r\n").unwrap();
        fs::set_permissions(
            fixture.repo.join("note.txt"),
            fs::Permissions::from_mode(0o744),
        )
        .unwrap();
        fixture.git(&["add", "--", "note.txt"]);

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let document = match workspace
            .query(QueryRequest {
                repo_id: attached.repo_id.clone(),
                query: Query::FileContents {
                    path: "note.txt".into(),
                },
            })
            .unwrap()
        {
            QueryOutcome::FileContents(document) => document,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        assert_eq!(document.text, "staged\r\n");
        assert_eq!(document.line_ending, LineEnding::Crlf);
        assert!(document.has_utf8_bom);

        workspace
            .execute(ExecuteRequest {
                operation_id: "save-file".into(),
                repo_id: attached.repo_id,
                expected_generation: attached.snapshot.repo_generation,
                action: Action::SaveFile {
                    path: "note.txt".into(),
                    text: "saved\nline\n".into(),
                    expected_content_hash: document.content_hash,
                },
                confirmation_token: None,
            })
            .unwrap();

        assert_eq!(
            fs::read(fixture.repo.join("note.txt")).unwrap(),
            b"\xEF\xBB\xBFsaved\r\nline\r\n"
        );
        assert_eq!(fixture.git_output(&["show", ":note.txt"]), "\u{feff}staged");
        assert_eq!(
            fs::metadata(fixture.repo.join("note.txt"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o744
        );
    }

    #[test]
    fn file_contents_supports_untracked_and_renamed_current_paths() {
        let fixture = GitFixture::new();
        fixture.write("before.txt", "before\n");
        fixture.git(&["add", "--", "before.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        fixture.git(&["mv", "--", "before.txt", "after.txt"]);
        fixture.write("new.txt", "new\n");

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        for (path, expected) in [("after.txt", "before\n"), ("new.txt", "new\n")] {
            let result = workspace
                .query(QueryRequest {
                    repo_id: attached.repo_id.clone(),
                    query: Query::FileContents { path: path.into() },
                })
                .unwrap();
            let QueryOutcome::FileContents(document) = result else {
                panic!("unexpected query outcome: {result:?}");
            };
            assert_eq!(document.path, path);
            assert_eq!(document.text, expected);
        }
    }

    #[test]
    fn rename_file_moves_modified_and_untracked_files_without_overwriting() {
        let fixture = GitFixture::new();
        fixture.write("modified.txt", "base\n");
        fixture.git(&["add", "--", "modified.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        fixture.write("modified.txt", "changed\n");
        fixture.write("new.txt", "new\n");
        fixture.write("occupied.txt", "occupied\n");

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let renamed = workspace
            .execute(ExecuteRequest {
                operation_id: "rename-modified".into(),
                repo_id: attached.repo_id.clone(),
                expected_generation: attached.snapshot.repo_generation,
                action: Action::RenameFile {
                    path: "modified.txt".into(),
                    new_path: "renamed.txt".into(),
                },
                confirmation_token: None,
            })
            .unwrap();
        assert!(!fixture.repo.join("modified.txt").exists());
        assert_eq!(
            fs::read_to_string(fixture.repo.join("renamed.txt")).unwrap(),
            "changed\n"
        );

        let renamed_new = workspace
            .execute(ExecuteRequest {
                operation_id: "rename-untracked".into(),
                repo_id: attached.repo_id.clone(),
                expected_generation: renamed.repo_generation,
                action: Action::RenameFile {
                    path: "new.txt".into(),
                    new_path: "new-name.txt".into(),
                },
                confirmation_token: None,
            })
            .unwrap();
        assert!(!fixture.repo.join("new.txt").exists());
        assert_eq!(
            fs::read_to_string(fixture.repo.join("new-name.txt")).unwrap(),
            "new\n"
        );

        let error = workspace
            .execute(ExecuteRequest {
                operation_id: "rename-overwrite".into(),
                repo_id: attached.repo_id,
                expected_generation: renamed_new.repo_generation,
                action: Action::RenameFile {
                    path: "new-name.txt".into(),
                    new_path: "occupied.txt".into(),
                },
                confirmation_token: None,
            })
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidRequest);
        assert_eq!(
            fs::read_to_string(fixture.repo.join("occupied.txt")).unwrap(),
            "occupied\n"
        );
    }

    #[test]
    fn save_file_rejects_an_external_change_and_preserves_it() {
        let fixture = GitFixture::new();
        fixture.write("note.txt", "base\n");
        fixture.git(&["add", "--", "note.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        fixture.write("note.txt", "opened\n");

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let QueryOutcome::FileContents(document) = workspace
            .query(QueryRequest {
                repo_id: attached.repo_id.clone(),
                query: Query::FileContents {
                    path: "note.txt".into(),
                },
            })
            .unwrap()
        else {
            panic!("expected file contents");
        };
        fixture.write("note.txt", "external\n");

        let error = workspace
            .execute(ExecuteRequest {
                operation_id: "stale-file-save".into(),
                repo_id: attached.repo_id,
                expected_generation: attached.snapshot.repo_generation,
                action: Action::SaveFile {
                    path: "note.txt".into(),
                    text: "draft\n".into(),
                    expected_content_hash: document.content_hash,
                },
                confirmation_token: None,
            })
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::StaleGeneration);
        assert_eq!(
            fs::read_to_string(fixture.repo.join("note.txt")).unwrap(),
            "external\n"
        );
    }

    #[test]
    fn file_contents_rejects_unsupported_text_encodings_and_limits() {
        let fixture = GitFixture::new();
        fs::write(fixture.repo.join("mixed.txt"), b"a\r\nb\n").unwrap();
        fs::write(fixture.repo.join("nul.txt"), b"a\0b").unwrap();
        fs::write(fixture.repo.join("non-utf8.txt"), [0xff, 0xfe]).unwrap();
        fs::write(
            fixture.repo.join("long.txt"),
            vec![b'a'; crate::worktree_text::MAX_EDIT_LONGEST_LINE + 1],
        )
        .unwrap();
        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();

        for (path, reason) in [
            ("mixed.txt", "lineEndings"),
            ("nul.txt", "nul"),
            ("non-utf8.txt", "nonUtf8"),
            ("long.txt", "tooLarge"),
        ] {
            let error = workspace
                .query(QueryRequest {
                    repo_id: attached.repo_id.clone(),
                    query: Query::FileContents { path: path.into() },
                })
                .unwrap_err();
            assert_eq!(
                error.details.get("reason").map(String::as_str),
                Some(reason),
                "{path}"
            );
        }
    }

    #[test]
    fn file_contents_rejects_clean_and_symlink_entries() {
        use std::os::unix::fs::symlink;

        let fixture = GitFixture::new();
        fixture.write("clean.txt", "clean\n");
        fixture.git(&["add", "--", "clean.txt"]);
        fixture.git(&["commit", "-m", "feat: base"]);
        symlink("clean.txt", fixture.repo.join("link.txt")).unwrap();

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let clean_error = workspace
            .query(QueryRequest {
                repo_id: attached.repo_id.clone(),
                query: Query::FileContents {
                    path: "clean.txt".into(),
                },
            })
            .unwrap_err();
        assert_eq!(clean_error.localized_message.id, "fileEditUnavailable");

        let link_error = workspace
            .query(QueryRequest {
                repo_id: attached.repo_id,
                query: Query::FileContents {
                    path: "link.txt".into(),
                },
            })
            .unwrap_err();
        assert_eq!(
            link_error.details.get("reason").map(String::as_str),
            Some("symlink")
        );
    }

    #[test]
    fn plain_commit_input_creates_an_ordinary_git_commit() {
        let fixture = GitFixture::new();
        fixture.write("message.txt", "plain\n");
        fixture.git(&["add", "--", "message.txt"]);
        fixture.write("unstaged.txt", "leave me\n");
        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();

        workspace
            .execute(ExecuteRequest {
                operation_id: "plain-commit".into(),
                repo_id: attached.repo_id,
                expected_generation: attached.snapshot.repo_generation,
                action: Action::Commit {
                    input: CommitInput::Plain {
                        message: "  日本語の通常メッセージ  ".into(),
                    },
                    include_all_changes: false,
                },
                confirmation_token: None,
            })
            .unwrap();

        assert_eq!(
            fixture.git_output(&["log", "-1", "--pretty=%B"]).trim(),
            "日本語の通常メッセージ"
        );
        assert_eq!(
            fixture.git_output(&["status", "--short"]),
            "?? unstaged.txt"
        );
    }

    #[test]
    fn include_all_changes_commits_the_entire_worktree() {
        let fixture = GitFixture::new();
        fixture.write(".gitignore", "ignored.txt\n");
        fixture.write("partial.txt", "base\n");
        fixture.write("deleted.txt", "base\n");
        fixture.git(&["add", "--all"]);
        fixture.git(&["commit", "-m", "test: base"]);

        fixture.write("partial.txt", "staged\n");
        fixture.git(&["add", "--", "partial.txt"]);
        fixture.write("partial.txt", "worktree\n");
        fs::remove_file(fixture.repo.join("deleted.txt")).unwrap();
        fixture.write("untracked.txt", "new\n");
        fixture.write("ignored.txt", "ignored\n");

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();

        workspace
            .execute(ExecuteRequest {
                operation_id: "commit-all".into(),
                repo_id: attached.repo_id,
                expected_generation: attached.snapshot.repo_generation,
                action: Action::Commit {
                    input: CommitInput::Plain {
                        message: "すべてコミット".into(),
                    },
                    include_all_changes: true,
                },
                confirmation_token: None,
            })
            .unwrap();

        assert_eq!(
            fixture.git_output(&["show", "HEAD:partial.txt"]),
            "worktree"
        );
        assert_eq!(fixture.git_output(&["show", "HEAD:untracked.txt"]), "new");
        fixture.git_fails(&["cat-file", "-e", "HEAD:deleted.txt"]);
        assert_eq!(fixture.git_output(&["status", "--short"]), "");
        assert!(fixture.repo.join("ignored.txt").is_file());
    }

    #[test]
    fn image_bytes_follow_worktree_index_and_commit_sources() {
        let fixture = GitFixture::new();
        let base = b"\0base-image";
        let changed = b"\0changed-image";
        fs::write(fixture.repo.join("image.bin"), base).unwrap();
        fixture.write("unchanged.bin", "not part of the image diff");
        fixture.git(&["add", "--", "image.bin", "unchanged.bin"]);
        fixture.git(&["commit", "-m", "test: base image"]);
        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();

        fs::write(fixture.repo.join("image.bin"), changed).unwrap();
        let unstaged = diff_for_target(
            &workspace,
            &attached.repo_id,
            "image.bin",
            DiffTarget::Unstaged,
        );
        let working_tree_target = |area, diff: &DiffResult| ImageBytesTarget::WorkingTree {
            path: "image.bin".into(),
            previous_path: None,
            area,
            generation: diff.repo_generation,
            diff_id: diff.diff_revision.clone(),
        };
        assert_eq!(
            workspace
                .image_bytes(ImageBytesRequest {
                    repo_id: attached.repo_id.clone(),
                    target: working_tree_target(ImageChangeArea::Unstaged, &unstaged),
                    side: ImageDiffSide::Before,
                })
                .unwrap(),
            base
        );
        assert_eq!(
            workspace
                .image_bytes(ImageBytesRequest {
                    repo_id: attached.repo_id.clone(),
                    target: working_tree_target(ImageChangeArea::Unstaged, &unstaged),
                    side: ImageDiffSide::After,
                })
                .unwrap(),
            changed
        );

        let untracked_bytes = b"\0untracked-image";
        fs::write(fixture.repo.join("untracked.bin"), untracked_bytes).unwrap();
        let untracked = diff_for_path(&workspace, &attached.repo_id, "untracked.bin");
        assert_eq!(
            workspace
                .image_bytes(ImageBytesRequest {
                    repo_id: attached.repo_id.clone(),
                    target: ImageBytesTarget::WorkingTree {
                        path: "untracked.bin".into(),
                        previous_path: None,
                        area: ImageChangeArea::Untracked,
                        generation: untracked.repo_generation,
                        diff_id: untracked.diff_revision,
                    },
                    side: ImageDiffSide::After,
                })
                .unwrap(),
            untracked_bytes
        );

        fixture.git(&["add", "--", "image.bin"]);
        let staged = diff_for_target(
            &workspace,
            &attached.repo_id,
            "image.bin",
            DiffTarget::Staged,
        );
        assert_eq!(
            workspace
                .image_bytes(ImageBytesRequest {
                    repo_id: attached.repo_id.clone(),
                    target: working_tree_target(ImageChangeArea::Staged, &staged),
                    side: ImageDiffSide::Before,
                })
                .unwrap(),
            base
        );
        assert_eq!(
            workspace
                .image_bytes(ImageBytesRequest {
                    repo_id: attached.repo_id.clone(),
                    target: working_tree_target(ImageChangeArea::Staged, &staged),
                    side: ImageDiffSide::After,
                })
                .unwrap(),
            changed
        );

        fixture.git(&["commit", "-m", "test: changed image"]);
        let oid = fixture.git_output(&["rev-parse", "HEAD"]);
        let details = match workspace
            .query(QueryRequest {
                repo_id: attached.repo_id.clone(),
                query: Query::CommitDetails { oid: oid.clone() },
            })
            .unwrap()
        {
            QueryOutcome::CommitDetails(details) => details,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        let commit_target = ImageBytesTarget::Commit {
            oid,
            path: "image.bin".into(),
            previous_path: None,
            diff_id: details.diff_revision.clone(),
            patch_scope: CommitImagePatchScope::All,
        };
        let forged_error = workspace
            .image_bytes(ImageBytesRequest {
                repo_id: attached.repo_id.clone(),
                target: ImageBytesTarget::Commit {
                    oid: details.oid.clone(),
                    path: "unchanged.bin".into(),
                    previous_path: None,
                    diff_id: details.diff_revision,
                    patch_scope: CommitImagePatchScope::All,
                },
                side: ImageDiffSide::After,
            })
            .unwrap_err();
        assert_eq!(forged_error.code, ErrorCode::InvalidRequest);
        assert_eq!(
            workspace
                .image_bytes(ImageBytesRequest {
                    repo_id: attached.repo_id.clone(),
                    target: commit_target.clone(),
                    side: ImageDiffSide::Before,
                })
                .unwrap(),
            base
        );
        assert_eq!(
            workspace
                .image_bytes(ImageBytesRequest {
                    repo_id: attached.repo_id,
                    target: commit_target,
                    side: ImageDiffSide::After,
                })
                .unwrap(),
            changed
        );
    }

    #[test]
    fn image_bytes_reject_large_commit_diff_ids_but_accepts_a_small_scoped_diff() {
        let fixture = GitFixture::new();
        let base = b"\0base-image";
        let changed = b"\0changed-image";
        fs::write(fixture.repo.join("small.bin"), base).unwrap();
        fixture.git(&["add", "--", "small.bin"]);
        fixture.git(&["commit", "-m", "test: base image"]);

        fs::write(fixture.repo.join("small.bin"), changed).unwrap();
        let mut state = 0x4d59_5df4_u32;
        let large = (0..=DIFF_LIMIT)
            .map(|_| {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                (state >> 24) as u8
            })
            .collect::<Vec<_>>();
        fs::write(fixture.repo.join("large.bin"), large).unwrap();
        fixture.git(&["add", "--", "small.bin", "large.bin"]);
        fixture.git(&["commit", "-m", "test: large image diff"]);

        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let details = match workspace
            .query(QueryRequest {
                repo_id: attached.repo_id.clone(),
                query: Query::CommitDetails { oid: "HEAD".into() },
            })
            .unwrap()
        {
            QueryOutcome::CommitDetails(details) => details,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        assert!(details.truncated);
        let target = |path: &str, diff_id: String, patch_scope| ImageBytesTarget::Commit {
            oid: details.oid.clone(),
            path: path.into(),
            previous_path: None,
            diff_id,
            patch_scope,
        };
        let aggregate_error = workspace
            .image_bytes(ImageBytesRequest {
                repo_id: attached.repo_id.clone(),
                target: target(
                    "small.bin",
                    details.diff_revision.clone(),
                    CommitImagePatchScope::All,
                ),
                side: ImageDiffSide::After,
            })
            .unwrap_err();
        assert_eq!(aggregate_error.code, ErrorCode::StaleGeneration);

        let small = match workspace
            .query(QueryRequest {
                repo_id: attached.repo_id.clone(),
                query: Query::CommitFileDiff {
                    oid: details.oid.clone(),
                    path: "small.bin".into(),
                    previous_path: None,
                },
            })
            .unwrap()
        {
            QueryOutcome::CommitFileDiff(diff) => diff,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        assert!(!small.truncated);
        assert_eq!(
            workspace
                .image_bytes(ImageBytesRequest {
                    repo_id: attached.repo_id.clone(),
                    target: target(
                        "small.bin",
                        small.diff_revision,
                        CommitImagePatchScope::File
                    ),
                    side: ImageDiffSide::After,
                })
                .unwrap(),
            changed
        );

        let large = match workspace
            .query(QueryRequest {
                repo_id: attached.repo_id.clone(),
                query: Query::CommitFileDiff {
                    oid: details.oid.clone(),
                    path: "large.bin".into(),
                    previous_path: None,
                },
            })
            .unwrap()
        {
            QueryOutcome::CommitFileDiff(diff) => diff,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        assert!(large.truncated);
        let large_error = workspace
            .image_bytes(ImageBytesRequest {
                repo_id: attached.repo_id,
                target: target(
                    "large.bin",
                    large.diff_revision,
                    CommitImagePatchScope::File,
                ),
                side: ImageDiffSide::After,
            })
            .unwrap_err();
        assert_eq!(large_error.code, ErrorCode::StaleGeneration);
    }

    #[test]
    fn image_bytes_uses_only_the_requested_commit_patch_scope() {
        let fixture = GitFixture::new();
        let base = b"\0base-image";
        let changed = b"\0changed-image";
        fs::write(fixture.repo.join("image.bin"), base).unwrap();
        fixture.git(&["add", "--", "image.bin"]);
        fixture.git(&["commit", "-m", "test: base image"]);
        fs::write(fixture.repo.join("image.bin"), changed).unwrap();
        fixture.write("other.txt", "other\n");
        fixture.git(&["add", "--", "image.bin", "other.txt"]);
        fixture.git(&["commit", "-m", "test: changed image"]);

        let id_workspace = fixture.workspace();
        let id_attached = id_workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let details = match id_workspace
            .query(QueryRequest {
                repo_id: id_attached.repo_id.clone(),
                query: Query::CommitDetails { oid: "HEAD".into() },
            })
            .unwrap()
        {
            QueryOutcome::CommitDetails(details) => details,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        let file_diff = match id_workspace
            .query(QueryRequest {
                repo_id: id_attached.repo_id,
                query: Query::CommitFileDiff {
                    oid: details.oid.clone(),
                    path: "image.bin".into(),
                    previous_path: None,
                },
            })
            .unwrap()
        {
            QueryOutcome::CommitFileDiff(diff) => diff,
            value => panic!("unexpected query outcome: {value:?}"),
        };

        let patch_log = fixture.temp.path().join("commit-patches.log");
        let wrapper = fixture.temp.path().join("record-commit-patches");
        fs::write(
            &wrapper,
            format!(
                r#"#!/bin/sh
case "$*" in
  *"diff --binary --no-color --no-ext-diff --no-textconv --find-renames"*)
    printf '%s\n' "$*" >> "{patch_log}"
    ;;
esac
exec /usr/bin/git "$@"
"#,
                patch_log = patch_log.display(),
            ),
        )
        .unwrap();
        let mut permissions = fs::metadata(&wrapper).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&wrapper, permissions).unwrap();
        let workspace = Workspace::new(
            GitExecutor::at(wrapper),
            test_journal_store(&fixture.temp.path().join("patch-scope-journal")).unwrap(),
        );
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();
        let target = |diff_id: String, patch_scope| ImageBytesTarget::Commit {
            oid: details.oid.clone(),
            path: "image.bin".into(),
            previous_path: None,
            diff_id,
            patch_scope,
        };

        assert_eq!(
            workspace
                .image_bytes(ImageBytesRequest {
                    repo_id: attached.repo_id.clone(),
                    target: target(details.diff_revision.clone(), CommitImagePatchScope::All),
                    side: ImageDiffSide::After,
                })
                .unwrap(),
            changed
        );
        let all_patches = fs::read_to_string(&patch_log).unwrap();
        assert_eq!(all_patches.lines().count(), 1);
        assert!(!all_patches.contains(" -- image.bin"));

        fs::write(&patch_log, "").unwrap();
        let all_scope_error = workspace
            .image_bytes(ImageBytesRequest {
                repo_id: attached.repo_id.clone(),
                target: target(file_diff.diff_revision.clone(), CommitImagePatchScope::All),
                side: ImageDiffSide::After,
            })
            .unwrap_err();
        assert_eq!(all_scope_error.code, ErrorCode::StaleGeneration);
        let rejected_all_patches = fs::read_to_string(&patch_log).unwrap();
        assert_eq!(rejected_all_patches.lines().count(), 1);
        assert!(!rejected_all_patches.contains(" -- image.bin"));

        fs::write(&patch_log, "").unwrap();
        assert_eq!(
            workspace
                .image_bytes(ImageBytesRequest {
                    repo_id: attached.repo_id,
                    target: target(file_diff.diff_revision, CommitImagePatchScope::File),
                    side: ImageDiffSide::After,
                })
                .unwrap(),
            changed
        );
        let file_patches = fs::read_to_string(&patch_log).unwrap();
        assert_eq!(file_patches.lines().count(), 1);
        assert!(file_patches.contains(" -- image.bin"));
    }

    #[test]
    fn image_bytes_support_a_pure_binary_rename_without_a_binary_patch_marker() {
        let fixture = GitFixture::new();
        let bytes = b"\0renamed-image";
        fs::write(fixture.repo.join("old.bin"), bytes).unwrap();
        fixture.git(&["add", "--", "old.bin"]);
        fixture.git(&["commit", "-m", "test: base image"]);
        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();

        fixture.git(&["mv", "--", "old.bin", "new.bin"]);
        let diff = match workspace
            .query(QueryRequest {
                repo_id: attached.repo_id.clone(),
                query: Query::Diff {
                    target: DiffTarget::Staged,
                    paths: vec!["old.bin".into(), "new.bin".into()],
                },
            })
            .unwrap()
        {
            QueryOutcome::Diff(diff) => diff,
            value => panic!("unexpected query outcome: {value:?}"),
        };
        assert!(diff.patch.contains("similarity index 100%"));
        assert!(!diff.patch.contains("GIT binary patch"));
        let target = ImageBytesTarget::WorkingTree {
            path: "new.bin".into(),
            previous_path: Some("old.bin".into()),
            area: ImageChangeArea::Staged,
            generation: diff.repo_generation,
            diff_id: diff.diff_revision,
        };

        for side in [ImageDiffSide::Before, ImageDiffSide::After] {
            assert_eq!(
                workspace
                    .image_bytes(ImageBytesRequest {
                        repo_id: attached.repo_id.clone(),
                        target: target.clone(),
                        side,
                    })
                    .unwrap(),
                bytes
            );
        }
    }

    #[test]
    fn image_bytes_reject_stale_escaping_symlink_and_oversized_worktree_reads() {
        use std::os::unix::fs::symlink;

        let fixture = GitFixture::new();
        fixture.write("tracked.bin", "base");
        fixture.git(&["add", "--", "tracked.bin"]);
        fixture.git(&["commit", "-m", "test: base"]);
        let workspace = fixture.workspace();
        let attached = workspace
            .attach(
                OpenRequest::Open {
                    path: fixture.repo_string(),
                },
                None,
            )
            .unwrap();

        fixture.write("tracked.bin", "changed");
        let stale = diff_for_path(&workspace, &attached.repo_id, "tracked.bin");
        fixture.write("tracked.bin", "changed again");
        let stale_error = workspace
            .image_bytes(ImageBytesRequest {
                repo_id: attached.repo_id.clone(),
                target: ImageBytesTarget::WorkingTree {
                    path: "tracked.bin".into(),
                    previous_path: None,
                    area: ImageChangeArea::Unstaged,
                    generation: stale.repo_generation,
                    diff_id: stale.diff_revision,
                },
                side: ImageDiffSide::After,
            })
            .unwrap_err();
        assert_eq!(stale_error.code, ErrorCode::StaleGeneration);

        let current = diff_for_path(&workspace, &attached.repo_id, "tracked.bin");
        let forged_previous_path_error = workspace
            .image_bytes(ImageBytesRequest {
                repo_id: attached.repo_id.clone(),
                target: ImageBytesTarget::WorkingTree {
                    path: "tracked.bin".into(),
                    previous_path: Some("unrelated.bin".into()),
                    area: ImageChangeArea::Unstaged,
                    generation: current.repo_generation,
                    diff_id: current.diff_revision,
                },
                side: ImageDiffSide::Before,
            })
            .unwrap_err();
        assert_eq!(forged_previous_path_error.code, ErrorCode::InvalidRequest);

        symlink("tracked.bin", fixture.repo.join("link.bin")).unwrap();
        let link = diff_for_path(&workspace, &attached.repo_id, "link.bin");
        let link_error = workspace
            .image_bytes(ImageBytesRequest {
                repo_id: attached.repo_id.clone(),
                target: ImageBytesTarget::WorkingTree {
                    path: "link.bin".into(),
                    previous_path: None,
                    area: ImageChangeArea::Untracked,
                    generation: link.repo_generation,
                    diff_id: link.diff_revision,
                },
                side: ImageDiffSide::After,
            })
            .unwrap_err();
        assert_eq!(link_error.code, ErrorCode::InvalidRequest);

        File::create(fixture.repo.join("large.bin"))
            .unwrap()
            .set_len((OUTPUT_LIMIT + 1) as u64)
            .unwrap();
        let large = diff_for_path(&workspace, &attached.repo_id, "large.bin");
        let large_error = workspace
            .image_bytes(ImageBytesRequest {
                repo_id: attached.repo_id.clone(),
                target: ImageBytesTarget::WorkingTree {
                    path: "large.bin".into(),
                    previous_path: None,
                    area: ImageChangeArea::Untracked,
                    generation: large.repo_generation,
                    diff_id: large.diff_revision.clone(),
                },
                side: ImageDiffSide::After,
            })
            .unwrap_err();
        assert_eq!(large_error.code, ErrorCode::InvalidRequest);

        let path_error = workspace
            .image_bytes(ImageBytesRequest {
                repo_id: attached.repo_id,
                target: ImageBytesTarget::WorkingTree {
                    path: "../outside.bin".into(),
                    previous_path: None,
                    area: ImageChangeArea::Untracked,
                    generation: large.repo_generation,
                    diff_id: large.diff_revision,
                },
                side: ImageDiffSide::After,
            })
            .unwrap_err();
        assert_eq!(path_error.code, ErrorCode::InvalidRequest);
    }

    struct GitFixture {
        temp: TempDir,
        repo: PathBuf,
    }

    impl GitFixture {
        fn new() -> Self {
            let temp = tempfile::tempdir().unwrap();
            let repo = temp.path().join("repo");
            run_git(temp.path(), &["init", "-b", "main", repo.to_str().unwrap()]);
            run_git(&repo, &["config", "user.name", "Stella Test"]);
            run_git(&repo, &["config", "user.email", "stella@example.test"]);
            Self { temp, repo }
        }

        fn workspace(&self) -> Workspace {
            Workspace::new(
                GitExecutor::at(PathBuf::from("/usr/bin/git")),
                test_journal_store(&self.temp.path().join("journal")).unwrap(),
            )
        }

        fn repo_string(&self) -> String {
            self.repo.display().to_string()
        }

        fn write(&self, path: &str, content: &str) {
            fs::write(self.repo.join(path), content).unwrap();
        }

        fn git(&self, args: &[&str]) {
            run_git(&self.repo, args);
        }

        fn git_at(&self, args: &[&str], unix_seconds: i64) {
            self.git_with_author_and_dates(
                args,
                unix_seconds,
                unix_seconds,
                "Stella Test",
                "stella@example.test",
            );
        }

        fn git_with_author_and_dates(
            &self,
            args: &[&str],
            author_unix_seconds: i64,
            committer_unix_seconds: i64,
            author_name: &str,
            author_email: &str,
        ) {
            let author_date = format!("{author_unix_seconds} +0000");
            let committer_date = format!("{committer_unix_seconds} +0000");
            let output = Command::new("/usr/bin/git")
                .args(args)
                .current_dir(&self.repo)
                .env("LC_ALL", "C")
                .env("GIT_AUTHOR_NAME", author_name)
                .env("GIT_AUTHOR_EMAIL", author_email)
                .env("GIT_AUTHOR_DATE", author_date)
                .env("GIT_COMMITTER_DATE", committer_date)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "git {args:?} failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }

        fn git_fails(&self, args: &[&str]) {
            let output = Command::new("/usr/bin/git")
                .args(args)
                .current_dir(&self.repo)
                .env("LC_ALL", "C")
                .output()
                .unwrap();
            assert!(
                !output.status.success(),
                "git {args:?} unexpectedly succeeded"
            );
        }

        fn git_output(&self, args: &[&str]) -> String {
            run_git_output(&self.repo, args)
        }
    }

    fn run_git(cwd: &Path, args: &[&str]) {
        let output = Command::new("/usr/bin/git")
            .args(args)
            .current_dir(cwd)
            .env("LC_ALL", "C")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn run_git_output(cwd: &Path, args: &[&str]) -> String {
        let output = Command::new("/usr/bin/git")
            .args(args)
            .current_dir(cwd)
            .env("LC_ALL", "C")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_owned()
    }

    fn capture_events(events: Arc<Mutex<Vec<WorkspaceEvent>>>) -> Channel<WorkspaceEvent> {
        Channel::new(move |body| {
            let InvokeResponseBody::Json(json) = body else {
                panic!("workspace event must use JSON IPC");
            };
            events.lock().unwrap().push(serde_json::from_str(&json)?);
            Ok(())
        })
    }

    fn conflict_document(workspace: &Workspace, repo_id: &str, path: &str) -> ConflictDocument {
        match workspace
            .query(QueryRequest {
                repo_id: repo_id.to_owned(),
                query: Query::Conflict {
                    path: path.to_owned(),
                },
            })
            .unwrap()
        {
            QueryOutcome::Conflict(document) => *document,
            value => panic!("unexpected query outcome: {value:?}"),
        }
    }

    fn diff_for_path(workspace: &Workspace, repo_id: &str, path: &str) -> DiffResult {
        diff_for_target(workspace, repo_id, path, DiffTarget::Unstaged)
    }

    fn diff_for_target(
        workspace: &Workspace,
        repo_id: &str,
        path: &str,
        target: DiffTarget,
    ) -> DiffResult {
        match workspace
            .query(QueryRequest {
                repo_id: repo_id.to_owned(),
                query: Query::Diff {
                    target,
                    paths: vec![path.to_owned()],
                },
            })
            .unwrap()
        {
            QueryOutcome::Diff(diff) => diff,
            value => panic!("unexpected query outcome: {value:?}"),
        }
    }

    fn preview_token(
        workspace: &Workspace,
        repo_id: &str,
        generation: RepoGeneration,
        action: Action,
    ) -> String {
        workspace
            .preview(PreviewRequest {
                repo_id: repo_id.to_owned(),
                expected_generation: generation,
                action,
            })
            .unwrap()
            .confirmation_token
            .expect("destructive action returns a preview token")
    }

    fn conventional_commit_action(description: &str) -> Action {
        Action::Commit {
            input: CommitInput::Conventional {
                commit_type: "feat".into(),
                scope: None,
                breaking: false,
                description: description.into(),
                body: None,
                footers: Vec::new(),
            },
            include_all_changes: false,
        }
    }
}
