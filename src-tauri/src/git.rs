use crate::model::{CommandActivity, DiffTarget, ResetMode, WorkspaceError, WorkspaceResult};
use std::ffi::OsString;
use std::fs;
use std::io::{Read, Write};
#[cfg(debug_assertions)]
use std::os::unix::fs::MetadataExt;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::thread;
use std::time::Duration;
use uuid::Uuid;

pub(crate) const OUTPUT_LIMIT: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone)]
pub(crate) struct GitExecutor {
    executable: PathBuf,
    lfs_executable: Option<PathBuf>,
    flow_executable: Option<PathBuf>,
    environment: Vec<(OsString, OsString)>,
    unavailable_reason: Option<String>,
    #[cfg(debug_assertions)]
    development_build_guard: Option<DevelopmentBuildGuard>,
}

#[cfg(debug_assertions)]
#[derive(Debug, Clone)]
struct DevelopmentBuildGuard {
    executable: PathBuf,
    startup_identity: ExecutableIdentity,
}

#[cfg(debug_assertions)]
#[derive(Debug, Clone, PartialEq, Eq)]
struct ExecutableIdentity {
    device: u64,
    inode: u64,
    size: u64,
    modified_seconds: i64,
    modified_nanoseconds: i64,
}

#[cfg(debug_assertions)]
impl DevelopmentBuildGuard {
    fn current() -> WorkspaceResult<Self> {
        let executable = std::env::current_exe().map_err(|error| {
            WorkspaceError::new(
                crate::model::ErrorCode::Internal,
                format!("開発版の実行ファイルを確認できません: {error}"),
            )
        })?;
        Self::capture(executable)
    }

    fn capture(executable: PathBuf) -> WorkspaceResult<Self> {
        let startup_identity = ExecutableIdentity::read(&executable).map_err(|error| {
            WorkspaceError::new(
                crate::model::ErrorCode::Internal,
                format!("開発版の実行ファイルを確認できません: {error}"),
            )
        })?;
        Ok(Self {
            executable,
            startup_identity,
        })
    }

    fn ensure_current(&self) -> WorkspaceResult<()> {
        let current_identity = ExecutableIdentity::read(&self.executable)
            .map_err(|_| development_build_updated_error())?;
        if current_identity != self.startup_identity {
            return Err(development_build_updated_error());
        }
        Ok(())
    }
}

#[cfg(debug_assertions)]
impl ExecutableIdentity {
    fn read(path: &Path) -> std::io::Result<Self> {
        let metadata = fs::metadata(path)?;
        Ok(Self {
            device: metadata.dev(),
            inode: metadata.ino(),
            size: metadata.size(),
            modified_seconds: metadata.mtime(),
            modified_nanoseconds: metadata.mtime_nsec(),
        })
    }
}

#[cfg(debug_assertions)]
fn development_build_updated_error() -> WorkspaceError {
    WorkspaceError::new(
        crate::model::ErrorCode::InvalidRequest,
        "更新があります。アプリを再起動してください。",
    )
    .localized_message(crate::model::LocalizedMessage::new(
        "developmentBuildUpdated",
    ))
}

#[derive(Debug, Clone)]
pub(crate) struct RunControl {
    cancelled: Arc<AtomicBool>,
}

impl RunControl {
    pub(crate) fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub(crate) fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub(crate) fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

#[derive(Debug, Clone)]
pub(crate) enum SequencerAction {
    Continue,
    Skip,
    Abort,
    Quit,
}

#[derive(Debug, Clone)]
pub(crate) enum GitCommand {
    Version,
    Clone {
        remote: String,
        destination: PathBuf,
    },
    Init {
        path: PathBuf,
        initial_branch: String,
    },
    TopLevel,
    GitDir,
    CommonDir,
    IsBare,
    Status,
    AttributeFiles,
    Diff {
        target: DiffTarget,
        paths: Vec<String>,
    },
    DiffNumstat {
        target: DiffTarget,
    },
    UntrackedDiff {
        path: String,
    },
    History {
        limit: u32,
        skip: u32,
    },
    CommitActivity {
        head_oid: String,
        since_unix_seconds: i64,
        until_unix_seconds: i64,
        limit: u32,
    },
    CommitMetadata {
        oid: String,
    },
    CommitParents {
        oid: String,
    },
    CommitPatch {
        oid: String,
        parent: Option<String>,
    },
    References,
    Branches,
    RemoteNames,
    RemoteUrls {
        remote: String,
        push: bool,
    },
    HeadOid,
    Resolve {
        revision: String,
    },
    MergeBase {
        left: String,
        right: String,
    },
    ChangedPaths {
        from: String,
        to: String,
    },
    CommitChangedPaths {
        oid: String,
    },
    LostCommits {
        head: String,
        target: String,
    },
    CommitsNotReachable {
        head: String,
        excluded: String,
    },
    IndexEntries {
        paths: Vec<String>,
    },
    TreeEntries {
        treeish: String,
        paths: Vec<String>,
    },
    Add {
        paths: Vec<String>,
    },
    AddAll,
    Remove {
        paths: Vec<String>,
    },
    RemoveCached {
        paths: Vec<String>,
    },
    RestoreWorktree {
        paths: Vec<String>,
    },
    RestoreStaged {
        paths: Vec<String>,
    },
    Apply {
        cached: bool,
        reverse: bool,
        check: bool,
    },
    Commit {
        message_file: PathBuf,
    },
    Fetch {
        remote: String,
        branch: Option<String>,
    },
    Push {
        remote: String,
        refspec: String,
        set_upstream: bool,
        force_with_lease: Option<(String, String)>,
        push_tags: bool,
    },
    SetRemoteUrl {
        remote: String,
        push: bool,
        new_url: String,
        expected_url: String,
    },
    CreateBranch {
        name: String,
        start_point: String,
    },
    DeleteBranch {
        name: String,
        force: bool,
    },
    CreateTag {
        name: String,
        target: String,
    },
    CreateAndSwitch {
        name: String,
        start_point: String,
    },
    Switch {
        branch: String,
    },
    Merge {
        source: String,
        commit_immediately: bool,
    },
    MergeFastForward {
        source: String,
    },
    Rebase {
        onto: String,
    },
    CherryPickNoCommit {
        commit: String,
        mainline: Option<u32>,
    },
    RevertNoCommit {
        commit: String,
        mainline: Option<u32>,
    },
    Reset {
        commit: String,
        mode: ResetMode,
    },
    MergeSequencer {
        action: SequencerAction,
    },
    RebaseSequencer {
        action: SequencerAction,
    },
    CherryPickSequencer {
        action: SequencerAction,
    },
    RevertSequencer {
        action: SequencerAction,
    },
    Unmerged {
        path: Option<String>,
    },
    CheckConflictAttributes {
        path: String,
    },
    CheckLfsAttribute {
        path: String,
    },
    CatFileSize {
        oid: String,
    },
    CatFile {
        oid: String,
    },
    GitFlowConfigList {
        file: Option<PathBuf>,
    },
    GitFlowConfigUnset {
        key: String,
    },
    GitFlowConfigAdd {
        file: Option<PathBuf>,
        key: String,
        value: String,
    },
}

impl GitCommand {
    fn args(&self) -> Vec<OsString> {
        let mut args = match self {
            Self::Version => strings(["--version"]),
            Self::Clone {
                remote,
                destination,
            } => vec![
                "clone".into(),
                "--progress".into(),
                "--".into(),
                remote.into(),
                destination.as_os_str().to_owned(),
            ],
            Self::Init {
                path,
                initial_branch,
            } => vec![
                "init".into(),
                "-b".into(),
                initial_branch.into(),
                "--".into(),
                path.as_os_str().to_owned(),
            ],
            Self::TopLevel => strings(["rev-parse", "--show-toplevel"]),
            Self::GitDir => strings(["rev-parse", "--absolute-git-dir"]),
            Self::CommonDir => strings(["rev-parse", "--path-format=absolute", "--git-common-dir"]),
            Self::IsBare => strings(["rev-parse", "--is-bare-repository"]),
            Self::Status => strings([
                "--no-optional-locks",
                "status",
                "--porcelain=v2",
                "--branch",
                "--untracked-files=all",
                "-z",
            ]),
            Self::AttributeFiles => strings([
                "ls-files",
                "--cached",
                "--others",
                "--exclude-standard",
                "-z",
                "--",
                ".gitattributes",
                ":(glob)**/.gitattributes",
            ]),
            Self::Diff { target, paths } => {
                let mut args = strings([
                    "--no-optional-locks",
                    "diff",
                    "--binary",
                    "--no-color",
                    "--no-ext-diff",
                    "--no-textconv",
                    "--find-renames",
                ]);
                match target {
                    DiffTarget::Staged => args.push("--cached".into()),
                    DiffTarget::Head => args.push("HEAD".into()),
                    DiffTarget::Unstaged => {}
                }
                push_paths(&mut args, paths);
                args
            }
            Self::DiffNumstat { target } => {
                let mut args = strings([
                    "--no-optional-locks",
                    "diff",
                    "--numstat",
                    "-z",
                    "--no-renames",
                    "--no-ext-diff",
                    "--no-textconv",
                ]);
                match target {
                    DiffTarget::Staged => args.push("--cached".into()),
                    DiffTarget::Head => args.push("HEAD".into()),
                    DiffTarget::Unstaged => {}
                }
                args.push("--".into());
                args
            }
            Self::UntrackedDiff { path } => {
                let mut args = strings([
                    "--no-optional-locks",
                    "diff",
                    "--no-index",
                    "--binary",
                    "--no-color",
                    "--no-ext-diff",
                    "--no-textconv",
                    "--src-prefix=a/",
                    "--dst-prefix=b/",
                    "--",
                    "/dev/null",
                ]);
                args.push(path.into());
                args
            }
            Self::History { limit, skip } => vec![
                "--no-pager".into(),
                "log".into(),
                "--all".into(),
                "--date-order".into(),
                "--decorate=full".into(),
                "--format=%H%x1f%P%x1f%D%x1f%an%x1f%aI%x1f%s%x1e".into(),
                format!("--max-count={limit}").into(),
                format!("--skip={skip}").into(),
            ],
            Self::CommitActivity {
                head_oid,
                since_unix_seconds,
                until_unix_seconds,
                limit,
            } => vec![
                "--no-pager".into(),
                "log".into(),
                "--no-show-signature".into(),
                "--format=%ct%x1f%ae%x1f%an%x1e".into(),
                format!("--since-as-filter=@{since_unix_seconds}").into(),
                format!("--until=@{until_unix_seconds}").into(),
                format!("--max-count={limit}").into(),
                head_oid.into(),
            ],
            Self::CommitMetadata { oid } => vec![
                "show".into(),
                "--no-patch".into(),
                "--decorate=full".into(),
                "--format=%H%x00%P%x00%D%x00%an%x00%ae%x00%aI%x00%s%x00%b".into(),
                oid.into(),
            ],
            Self::CommitParents { oid } => vec![
                "show".into(),
                "--no-patch".into(),
                "--format=%P".into(),
                oid.into(),
            ],
            Self::CommitPatch { oid, parent } => {
                let mut args = strings([
                    "diff",
                    "--binary",
                    "--no-color",
                    "--no-ext-diff",
                    "--no-textconv",
                    "--find-renames",
                ]);
                if let Some(parent) = parent {
                    args.push(parent.into());
                    args.push(oid.into());
                } else {
                    args = strings([
                        "diff-tree",
                        "--root",
                        "--no-commit-id",
                        "--binary",
                        "--no-color",
                        "--no-ext-diff",
                        "--no-textconv",
                        "--find-renames",
                        "-p",
                    ]);
                    args.push(oid.into());
                }
                args
            }
            Self::References => strings([
                "for-each-ref",
                "--format=%(refname)%00%(objectname)",
                "refs/heads",
                "refs/remotes",
                "refs/tags",
            ]),
            Self::Branches => strings([
                "for-each-ref",
                "--format=%(refname)%00%(refname:short)%00%(objectname)%00%(HEAD)%00%(upstream)%00%(committerdate:unix)",
                "refs/heads",
                "refs/remotes",
            ]),
            Self::RemoteNames => strings(["remote"]),
            Self::RemoteUrls { remote, push } => {
                let mut args = strings(["remote", "get-url", "--all"]);
                if *push {
                    args.push("--push".into());
                }
                args.push(remote.into());
                args
            }
            Self::HeadOid => strings(["rev-parse", "--verify", "HEAD"]),
            Self::Resolve { revision } => vec![
                "rev-parse".into(),
                "--verify".into(),
                format!("{revision}^{{commit}}").into(),
            ],
            Self::MergeBase { left, right } => {
                vec!["merge-base".into(), "--".into(), left.into(), right.into()]
            }
            Self::ChangedPaths { from, to } => vec![
                "diff".into(),
                "--name-only".into(),
                "-z".into(),
                "--no-ext-diff".into(),
                "--no-textconv".into(),
                "--no-renames".into(),
                from.into(),
                to.into(),
                "--".into(),
            ],
            Self::CommitChangedPaths { oid } => vec![
                "diff-tree".into(),
                "--root".into(),
                "--no-commit-id".into(),
                "--name-only".into(),
                "-r".into(),
                "-z".into(),
                oid.into(),
                "--".into(),
            ],
            Self::LostCommits { head, target } => vec![
                "rev-list".into(),
                head.into(),
                format!("^{target}").into(),
                "--".into(),
            ],
            Self::CommitsNotReachable { head, excluded } => vec![
                "rev-list".into(),
                "--reverse".into(),
                "--topo-order".into(),
                head.into(),
                "--not".into(),
                excluded.into(),
                "--".into(),
            ],
            Self::IndexEntries { paths } => {
                let mut args = strings(["ls-files", "--stage", "-z"]);
                push_paths(&mut args, paths);
                args
            }
            Self::TreeEntries { treeish, paths } => {
                let mut args = strings(["ls-tree", "-r", "-z", "--full-tree"]);
                args.push(treeish.into());
                push_paths(&mut args, paths);
                args
            }
            Self::Add { paths } => {
                let mut args = strings(["add"]);
                push_paths(&mut args, paths);
                args
            }
            Self::AddAll => strings(["add", "--all"]),
            Self::Remove { paths } => {
                let mut args = strings(["rm", "--ignore-unmatch"]);
                push_paths(&mut args, paths);
                args
            }
            Self::RemoveCached { paths } => {
                let mut args = strings(["rm", "--cached", "--ignore-unmatch"]);
                push_paths(&mut args, paths);
                args
            }
            Self::RestoreWorktree { paths } => {
                let mut args = strings(["restore", "--worktree"]);
                push_paths(&mut args, paths);
                args
            }
            Self::RestoreStaged { paths } => {
                let mut args = strings(["restore", "--staged"]);
                push_paths(&mut args, paths);
                args
            }
            Self::Apply {
                cached,
                reverse,
                check,
            } => {
                let mut args = strings([
                    "apply",
                    "--recount",
                    "--unidiff-zero",
                    "--whitespace=nowarn",
                ]);
                if *cached {
                    args.push("--cached".into());
                }
                if *reverse {
                    args.push("--reverse".into());
                }
                if *check {
                    args.push("--check".into());
                }
                args.push("-".into());
                args
            }
            Self::Commit { message_file } => vec![
                "commit".into(),
                "--file".into(),
                message_file.as_os_str().to_owned(),
                "--cleanup=verbatim".into(),
            ],
            Self::Fetch { remote, branch } => {
                let mut args = strings([
                    "fetch",
                    "--no-prune",
                    "--no-recurse-submodules",
                    "--progress",
                ]);
                args.push("--".into());
                args.push(remote.into());
                if let Some(branch) = branch {
                    args.push(branch.into());
                }
                args
            }
            Self::Push {
                remote,
                refspec,
                set_upstream,
                force_with_lease,
                push_tags,
            } => {
                let mut args = strings(["push", "--porcelain", "--progress"]);
                if *set_upstream {
                    args.push("--set-upstream".into());
                }
                if let Some((reference, expected)) = force_with_lease {
                    args.push(format!("--force-with-lease={reference}:{expected}").into());
                }
                if *push_tags {
                    args.push("--atomic".into());
                    args.push("--tags".into());
                }
                args.push("--".into());
                args.push(remote.into());
                args.push(refspec.into());
                args
            }
            Self::SetRemoteUrl {
                remote,
                push,
                new_url,
                expected_url,
            } => {
                let mut args = strings(["remote", "set-url"]);
                if *push {
                    args.push("--push".into());
                }
                args.push(remote.into());
                args.push(new_url.into());
                args.push(exact_git_regex(expected_url).into());
                args
            }
            Self::CreateBranch { name, start_point } => vec![
                "branch".into(),
                "--".into(),
                name.into(),
                start_point.into(),
            ],
            Self::DeleteBranch { name, force } => {
                let mut args = strings(["branch", "--delete"]);
                if *force {
                    args.push("--force".into());
                }
                args.extend([OsString::from("--"), name.into()]);
                args
            }
            Self::CreateTag { name, target } => vec![
                "tag".into(),
                "--no-sign".into(),
                "--".into(),
                name.into(),
                target.into(),
            ],
            Self::CreateAndSwitch { name, start_point } => vec![
                "switch".into(),
                "--no-guess".into(),
                "--no-overwrite-ignore".into(),
                "-c".into(),
                name.into(),
                start_point.into(),
            ],
            Self::Switch { branch } => {
                vec![
                    "switch".into(),
                    "--no-guess".into(),
                    "--no-overwrite-ignore".into(),
                    "--".into(),
                    branch.into(),
                ]
            }
            Self::Merge {
                source,
                commit_immediately,
            } => {
                let mut args = strings(["merge"]);
                if !commit_immediately {
                    args.push("--no-commit".into());
                }
                args.extend(strings([
                    "--no-ff",
                    "--no-edit",
                    "--no-autostash",
                    "--no-overwrite-ignore",
                    "--",
                ]));
                args.push(source.into());
                args
            }
            Self::MergeFastForward { source } => vec![
                "merge".into(),
                "--ff-only".into(),
                "--no-edit".into(),
                "--no-autostash".into(),
                "--no-overwrite-ignore".into(),
                "--".into(),
                source.into(),
            ],
            Self::Rebase { onto } => vec![
                "rebase".into(),
                "--no-autostash".into(),
                "--no-rebase-merges".into(),
                "--".into(),
                onto.into(),
            ],
            Self::CherryPickNoCommit { commit, mainline } => {
                let mut args = strings(["cherry-pick", "--no-commit"]);
                if let Some(mainline) = mainline {
                    args.push("--mainline".into());
                    args.push(mainline.to_string().into());
                }
                args.push("--".into());
                args.push(commit.into());
                args
            }
            Self::RevertNoCommit { commit, mainline } => {
                let mut args = strings(["revert", "--no-commit"]);
                if let Some(mainline) = mainline {
                    args.push("--mainline".into());
                    args.push(mainline.to_string().into());
                }
                args.push("--".into());
                args.push(commit.into());
                args
            }
            Self::Reset { commit, mode } => vec![
                "reset".into(),
                match mode {
                    ResetMode::Soft => "--soft",
                    ResetMode::Mixed => "--mixed",
                    ResetMode::Hard => "--hard",
                }
                .into(),
                commit.into(),
            ],
            Self::MergeSequencer { action } => sequencer_args("merge", action),
            Self::RebaseSequencer { action } => sequencer_args("rebase", action),
            Self::CherryPickSequencer { action } => sequencer_args("cherry-pick", action),
            Self::RevertSequencer { action } => sequencer_args("revert", action),
            Self::Unmerged { path } => {
                let mut args = strings(["ls-files", "--unmerged", "-z"]);
                if let Some(path) = path {
                    push_paths(&mut args, std::slice::from_ref(path));
                }
                args
            }
            Self::CheckConflictAttributes { path } => vec![
                "check-attr".into(),
                "-z".into(),
                "binary".into(),
                "diff".into(),
                "merge".into(),
                "text".into(),
                "conflict-marker-size".into(),
                "--".into(),
                path.into(),
            ],
            Self::CheckLfsAttribute { path } => vec![
                "check-attr".into(),
                "-z".into(),
                "filter".into(),
                "--".into(),
                path.into(),
            ],
            Self::CatFileSize { oid } => vec!["cat-file".into(), "-s".into(), oid.into()],
            Self::CatFile { oid } => vec!["cat-file".into(), "blob".into(), oid.into()],
            Self::GitFlowConfigList { file } => {
                let mut args = strings(["config"]);
                if let Some(file) = file {
                    args.push("--file".into());
                    args.push(file.as_os_str().to_owned());
                } else {
                    args.push("--local".into());
                }
                args.extend(strings(["--null", "--get-regexp", "^gitflow\\."]));
                args
            }
            Self::GitFlowConfigUnset { key } => vec![
                "config".into(),
                "--local".into(),
                "--unset-all".into(),
                key.into(),
            ],
            Self::GitFlowConfigAdd { file, key, value } => {
                let mut args = strings(["config"]);
                if let Some(file) = file {
                    args.push("--file".into());
                    args.push(file.as_os_str().to_owned());
                } else {
                    args.push("--local".into());
                }
                args.extend([OsString::from("--add"), key.into(), value.into()]);
                args
            }
        };
        // Gitは`--`より後のpath引数もpathspec式として解釈する。
        // 現在と将来の全commandで`*`、`[name]`、`:(glob)*`などの正当なfile名を安全に扱うため、
        // process全体の既定値をliteral matchにする。
        if !matches!(self, Self::AttributeFiles) {
            args.insert(0, "--literal-pathspecs".into());
        }
        args
    }

    fn requires_complete_stdout(&self) -> bool {
        matches!(
            self,
            Self::TopLevel
                | Self::GitDir
                | Self::CommonDir
                | Self::IsBare
                | Self::Status
                | Self::DiffNumstat { .. }
                | Self::AttributeFiles
                | Self::CommitActivity { .. }
                | Self::CommitMetadata { .. }
                | Self::CommitParents { .. }
                | Self::References
                | Self::Branches
                | Self::RemoteNames
                | Self::RemoteUrls { .. }
                | Self::HeadOid
                | Self::Resolve { .. }
                | Self::MergeBase { .. }
                | Self::ChangedPaths { .. }
                | Self::CommitChangedPaths { .. }
                | Self::LostCommits { .. }
                | Self::CommitsNotReachable { .. }
                | Self::IndexEntries { .. }
                | Self::TreeEntries { .. }
                | Self::Unmerged { .. }
                | Self::CheckConflictAttributes { .. }
                | Self::CheckLfsAttribute { .. }
                | Self::CatFileSize { .. }
                | Self::GitFlowConfigList { .. }
        )
    }
}

fn sequencer_args(command: &str, action: &SequencerAction) -> Vec<OsString> {
    vec![
        command.into(),
        match action {
            SequencerAction::Continue => "--continue",
            SequencerAction::Skip => "--skip",
            SequencerAction::Abort => "--abort",
            SequencerAction::Quit => "--quit",
        }
        .into(),
    ]
}

fn strings<const N: usize>(items: [&str; N]) -> Vec<OsString> {
    items.into_iter().map(OsString::from).collect()
}

fn push_paths(args: &mut Vec<OsString>, paths: &[String]) {
    args.push("--".into());
    args.extend(paths.iter().map(OsString::from));
}

#[derive(Debug, Clone)]
pub(crate) struct GitOutput {
    pub(crate) argv: Vec<String>,
    pub(crate) status: Option<i32>,
    pub(crate) stdout: Vec<u8>,
    pub(crate) stderr: Vec<u8>,
    pub(crate) truncated: bool,
    pub(crate) cancelled: bool,
    pub(crate) hook_executed: bool,
}

impl GitOutput {
    pub(crate) fn success(&self) -> bool {
        self.status == Some(0) && !self.cancelled
    }

    pub(crate) fn stdout_text(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }

    pub(crate) fn stderr_text(&self) -> String {
        String::from_utf8_lossy(&self.stderr).into_owned()
    }

    pub(crate) fn activity(&self) -> CommandActivity {
        CommandActivity {
            argv: self.argv.clone(),
            exit_code: self.status,
            stdout: redact(&String::from_utf8_lossy(&self.stdout)),
            stderr: redact(&String::from_utf8_lossy(&self.stderr)),
            cancelled: self.cancelled,
        }
    }

    pub(crate) fn ensure_success(self) -> WorkspaceResult<Self> {
        if self.cancelled {
            return Err(WorkspaceError::new(
                crate::model::ErrorCode::Cancelled,
                "Git operation was cancelled",
            ));
        }
        if self.status != Some(0) {
            return Err(git_failure(&self));
        }
        Ok(self)
    }
}

impl GitExecutor {
    pub(crate) fn system() -> WorkspaceResult<Self> {
        let executable = PathBuf::from("/usr/bin/git");
        if !executable.is_file() {
            return Err(WorkspaceError::new(
                crate::model::ErrorCode::Internal,
                "Git was not found at /usr/bin/git. Install Command Line Tools",
            ));
        }
        Ok(Self::configured(executable, None, None, Vec::new(), None))
    }

    #[cfg(test)]
    pub(crate) fn at(executable: PathBuf) -> Self {
        Self::configured(executable, None, None, Vec::new(), None)
    }

    pub(crate) fn configured(
        executable: PathBuf,
        lfs_executable: Option<PathBuf>,
        flow_executable: Option<PathBuf>,
        environment: Vec<(OsString, OsString)>,
        unavailable_reason: Option<String>,
    ) -> Self {
        Self {
            executable,
            lfs_executable,
            flow_executable,
            environment,
            unavailable_reason,
            #[cfg(debug_assertions)]
            development_build_guard: None,
        }
    }

    pub(crate) fn guard_development_build(self) -> WorkspaceResult<Self> {
        #[cfg(debug_assertions)]
        let executor = {
            let mut executor = self;
            executor.development_build_guard = Some(DevelopmentBuildGuard::current()?);
            executor
        };
        #[cfg(not(debug_assertions))]
        let executor = self;
        Ok(executor)
    }

    pub(crate) fn ensure_development_build_current(&self) -> WorkspaceResult<()> {
        #[cfg(debug_assertions)]
        if let Some(guard) = &self.development_build_guard {
            guard.ensure_current()?;
        }
        Ok(())
    }

    pub(crate) fn has_lfs(&self) -> bool {
        self.lfs_executable.is_some()
    }

    pub(crate) fn has_flow(&self) -> bool {
        self.flow_executable.is_some()
    }

    pub(crate) fn run(
        &self,
        cwd: Option<&Path>,
        command: GitCommand,
        stdin: Option<&[u8]>,
        control: Option<&RunControl>,
    ) -> WorkspaceResult<GitOutput> {
        if let Some(reason) = &self.unavailable_reason {
            return Err(WorkspaceError::new(
                crate::model::ErrorCode::Internal,
                format!("Git toolchain is unavailable: {reason}"),
            ));
        }
        let complete_stdout_required = command.requires_complete_stdout();
        let args = command.args();
        let hook_trace = matches!(command, GitCommand::Commit { .. }).then(HookTrace::new);
        self.run_process(
            &self.executable,
            cwd,
            args,
            stdin,
            control,
            complete_stdout_required,
            hook_trace,
        )
    }

    pub(crate) fn run_flow(
        &self,
        cwd: &Path,
        args: Vec<OsString>,
        control: Option<&RunControl>,
        complete_stdout_required: bool,
    ) -> WorkspaceResult<GitOutput> {
        let executable = self.flow_executable.as_ref().ok_or_else(|| {
            WorkspaceError::new(
                crate::model::ErrorCode::UnsupportedRepository,
                "Git Flow is not available in the selected toolchain",
            )
        })?;
        self.run_process(
            executable,
            Some(cwd),
            args,
            None,
            control,
            complete_stdout_required,
            None,
        )
    }

    pub(crate) fn run_lfs(
        &self,
        cwd: &Path,
        args: Vec<OsString>,
        control: Option<&RunControl>,
    ) -> WorkspaceResult<GitOutput> {
        let executable = self.lfs_executable.as_ref().ok_or_else(|| {
            WorkspaceError::new(
                crate::model::ErrorCode::UnsupportedRepository,
                "Git LFS is not available in the selected toolchain",
            )
        })?;
        self.run_process(executable, Some(cwd), args, None, control, false, None)
    }

    #[allow(clippy::too_many_arguments)]
    fn run_process(
        &self,
        executable: &Path,
        cwd: Option<&Path>,
        args: Vec<OsString>,
        stdin: Option<&[u8]>,
        control: Option<&RunControl>,
        complete_stdout_required: bool,
        hook_trace: Option<HookTrace>,
    ) -> WorkspaceResult<GitOutput> {
        let argv = display_argv(executable, &args);
        let mut process = Command::new(executable);
        process
            .args(&args)
            .stdin(if stdin.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("LC_ALL", "C")
            .env("LANG", "C")
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_PAGER", "cat")
            .env("GIT_EDITOR", "true")
            .env("GIT_SEQUENCE_EDITOR", "true")
            .env("GIT_MERGE_AUTOEDIT", "no")
            .env("GIT_OPTIONAL_LOCKS", "0")
            .envs(self.environment.iter().cloned());
        // userがキャンセルした後にhelperを残さないよう、Git、hook、credential helperと
        // その子processを1つのprocess groupにまとめる。
        process.process_group(0);
        if let Some(trace) = &hook_trace {
            process.env("GIT_TRACE2_EVENT", &trace.path);
        }
        if let Some(cwd) = cwd {
            process.current_dir(cwd);
        }

        let mut child = process.spawn().map_err(|error| {
            WorkspaceError::new(
                crate::model::ErrorCode::Io,
                format!("Failed to start {}: {error}", executable.display()),
            )
        })?;

        if let Some(input) = stdin {
            let mut child_stdin = child.stdin.take().ok_or_else(|| {
                WorkspaceError::new(
                    crate::model::ErrorCode::Internal,
                    "Failed to access Git stdin",
                )
            })?;
            child_stdin.write_all(input).map_err(io_error)?;
        }

        let stdout = child.stdout.take().ok_or_else(|| {
            WorkspaceError::new(
                crate::model::ErrorCode::Internal,
                "Failed to access Git stdout",
            )
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            WorkspaceError::new(
                crate::model::ErrorCode::Internal,
                "Failed to access Git stderr",
            )
        })?;
        let stdout_reader = thread::spawn(move || read_limited(stdout));
        let stderr_reader = thread::spawn(move || read_limited(stderr));

        let (status, cancelled) = loop {
            if control.is_some_and(RunControl::is_cancelled) {
                let status = terminate_process_group(&mut child);
                break (status, true);
            }
            match child.try_wait() {
                Ok(Some(status)) => break (status.code(), false),
                Ok(None) => thread::sleep(Duration::from_millis(25)),
                Err(error) => {
                    let _ = terminate_process_group(&mut child);
                    return Err(io_error(error));
                }
            }
        };

        let stdout = stdout_reader.join().map_err(|_| {
            WorkspaceError::new(
                crate::model::ErrorCode::Internal,
                "The stdout reader exited unexpectedly",
            )
        })??;
        let stderr = stderr_reader.join().map_err(|_| {
            WorkspaceError::new(
                crate::model::ErrorCode::Internal,
                "The stderr reader exited unexpectedly",
            )
        })??;

        let LimitedRead {
            bytes: stdout,
            truncated,
        } = stdout;
        let stderr = stderr.bytes;
        let output = GitOutput {
            argv,
            status,
            stdout,
            stderr,
            truncated,
            cancelled,
            hook_executed: hook_trace.as_ref().is_some_and(HookTrace::hook_executed),
        };
        reject_incomplete_stdout(output, complete_stdout_required)
    }
}

struct HookTrace {
    path: PathBuf,
}

impl HookTrace {
    fn new() -> Self {
        Self {
            path: std::env::temp_dir().join(format!("stella-hook-{}.trace", Uuid::new_v4())),
        }
    }

    fn hook_executed(&self) -> bool {
        fs::read_to_string(&self.path).is_ok_and(|trace| {
            trace.lines().any(|line| {
                line.contains("\"child_class\":\"hook\"") || line.contains("\"hook_name\":")
            })
        })
    }
}

impl Drop for HookTrace {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

struct LimitedRead {
    bytes: Vec<u8>,
    truncated: bool,
}

fn read_limited(mut reader: impl Read) -> WorkspaceResult<LimitedRead> {
    let mut output = Vec::new();
    let mut buffer = [0_u8; 16 * 1024];
    let mut truncated = false;
    loop {
        let count = reader.read(&mut buffer).map_err(io_error)?;
        if count == 0 {
            break;
        }
        let remaining = OUTPUT_LIMIT.saturating_sub(output.len());
        if remaining > 0 {
            output.extend_from_slice(&buffer[..count.min(remaining)]);
        }
        truncated |= count > remaining;
    }
    if truncated {
        output.extend_from_slice(b"\n[output truncated by application]\n");
    }
    Ok(LimitedRead {
        bytes: output,
        truncated,
    })
}

fn reject_incomplete_stdout(
    output: GitOutput,
    complete_stdout_required: bool,
) -> WorkspaceResult<GitOutput> {
    if output.truncated && complete_stdout_required {
        return Err(WorkspaceError::new(
            crate::model::ErrorCode::UnsupportedRepository,
            "Git output exceeded the limit, so the repository state cannot be processed safely",
        )
        .detail(
            "argv",
            serde_json::to_string(&output.argv).unwrap_or_else(|_| "[]".into()),
        ));
    }
    Ok(output)
}

fn terminate_process_group(child: &mut std::process::Child) -> Option<i32> {
    let group = format!("-{}", child.id());
    let _ = Command::new("/bin/kill")
        .args(["-TERM", group.as_str()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let mut status = None;
    for _ in 0..20 {
        match child.try_wait() {
            Ok(Some(value)) => {
                status = value.code();
                break;
            }
            Ok(None) => thread::sleep(Duration::from_millis(25)),
            Err(_) => break,
        }
    }
    // Git親processが終了済みでも、hookが出力pipeを保持している場合に備えてgroupを終了する。
    let _ = Command::new("/bin/kill")
        .args(["-KILL", group.as_str()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let _ = child.kill();
    status.or_else(|| child.wait().ok().and_then(|value| value.code()))
}

fn display_argv(executable: &Path, args: &[OsString]) -> Vec<String> {
    let mut output = vec![executable.display().to_string()];
    output.extend(
        args.iter()
            .map(|argument| redact(&argument.to_string_lossy())),
    );
    output
}

fn redact(value: &str) -> String {
    let mut redacted = value.to_owned();
    if let Some(scheme) = redacted.find("://") {
        let authority = scheme + 3;
        if let Some(at) = redacted[authority..].find('@') {
            let at = authority + at;
            redacted.replace_range(authority..=at, "***@");
        }
    }
    for marker in ["access_token=", "password=", "token="] {
        let mut search_from = 0;
        while let Some(relative_start) = redacted[search_from..].to_ascii_lowercase().find(marker) {
            let start = search_from + relative_start;
            let value_start = start + marker.len();
            let value_end = redacted[value_start..]
                .find(['&', ' ', '\n'])
                .map_or(redacted.len(), |offset| value_start + offset);
            redacted.replace_range(value_start..value_end, "***");
            search_from = value_start + 3;
        }
    }
    redacted
}

fn exact_git_regex(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len() + 2);
    escaped.push('^');
    for ch in value.chars() {
        if matches!(
            ch,
            '.' | '[' | ']' | '\\' | '*' | '^' | '$' | '(' | ')' | '+' | '?' | '{' | '}' | '|'
        ) {
            escaped.push('\\');
        }
        escaped.push(ch);
    }
    escaped.push('$');
    escaped
}

fn git_failure(output: &GitOutput) -> WorkspaceError {
    let stderr = output.stderr_text();
    let lowered = stderr.to_ascii_lowercase();
    let code = if output.hook_executed || lowered.contains("hook") || lowered.contains("pre-commit")
    {
        crate::model::ErrorCode::HookFailed
    } else if lowered.contains("authentication failed")
        || lowered.contains("permission denied (publickey)")
        || lowered.contains("could not read username")
    {
        crate::model::ErrorCode::AuthenticationFailed
    } else if lowered.contains("repository not found")
        || lowered.contains("does not appear to be a git repository")
    {
        crate::model::ErrorCode::RemoteUnavailable
    } else if lowered.contains("could not resolve host")
        || lowered.contains("could not resolve hostname")
        || lowered.contains("failed to connect")
        || lowered.contains("connection timed out")
        || lowered.contains("network is unreachable")
        || lowered.contains("connection reset")
    {
        crate::model::ErrorCode::NetworkFailed
    } else {
        crate::model::ErrorCode::GitFailed
    };
    WorkspaceError::new(code, "Git operation failed")
        .detail(
            "exitCode",
            output
                .status
                .map_or_else(|| "signal".into(), |v| v.to_string()),
        )
        .detail("stderr", redact(&stderr))
        .detail("stdout", redact(&String::from_utf8_lossy(&output.stdout)))
        .detail(
            "argv",
            serde_json::to_string(&output.argv).unwrap_or_else(|_| "[]".into()),
        )
}

fn io_error(error: std::io::Error) -> WorkspaceError {
    WorkspaceError::new(crate::model::ErrorCode::Io, error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[cfg(debug_assertions)]
    #[test]
    fn development_build_guard_rejects_a_replaced_executable() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let executable = directory.path().join("stella");
        fs::write(&executable, b"old build").expect("old executable");
        let guard = DevelopmentBuildGuard::capture(executable.clone()).expect("capture guard");
        guard.ensure_current().expect("unchanged executable");

        let replacement = directory.path().join("stella.next");
        fs::write(&replacement, b"new build").expect("new executable");
        fs::rename(replacement, executable).expect("replace executable");

        let error = guard.ensure_current().expect_err("stale build");
        assert_eq!(
            error.message,
            "更新があります。アプリを再起動してください。"
        );
        assert_eq!(error.localized_message.id, "developmentBuildUpdated");
    }

    #[test]
    fn remote_credentials_are_redacted() {
        assert_eq!(
            redact("https://name:secret@example.test/repo.git"),
            "https://***@example.test/repo.git"
        );
        assert_eq!(
            redact("token=one&access_token=two password=three token=four"),
            "token=***&access_token=*** password=*** token=***"
        );
    }

    #[test]
    fn remote_failures_are_classified_without_promoting_ordinary_git_rejections() {
        let failure = |stderr: &str| GitOutput {
            argv: vec!["/usr/bin/git".into(), "fetch".into()],
            status: Some(128),
            stdout: Vec::new(),
            stderr: stderr.as_bytes().to_vec(),
            truncated: false,
            cancelled: false,
            hook_executed: false,
        };
        assert_eq!(
            git_failure(&failure("fatal: repository not found")).code,
            crate::model::ErrorCode::RemoteUnavailable
        );
        assert_eq!(
            git_failure(&failure("fatal: Authentication failed")).code,
            crate::model::ErrorCode::AuthenticationFailed
        );
        assert_eq!(
            git_failure(&failure("fatal: Could not resolve host: example.test")).code,
            crate::model::ErrorCode::NetworkFailed
        );
        assert_eq!(
            git_failure(&failure("remote rejected: protected branch")).code,
            crate::model::ErrorCode::GitFailed
        );
    }

    #[test]
    fn remote_url_commands_keep_values_as_single_arguments() {
        let args = GitCommand::SetRemoteUrl {
            remote: "origin".into(),
            push: true,
            new_url: "ssh://example.test/repo.git;touch injected".into(),
            expected_url: "ssh://example.test/old.[git]".into(),
        }
        .args();
        assert!(args.contains(&"ssh://example.test/repo.git;touch injected".into()));
        assert!(args.contains(&"^ssh://example\\.test/old\\.\\[git\\]$".into()));
    }

    #[test]
    fn push_combines_an_exact_force_lease_with_all_tags() {
        assert_eq!(
            GitCommand::Push {
                remote: "origin".into(),
                refspec: "refs/heads/main:refs/heads/release".into(),
                set_upstream: true,
                force_with_lease: Some(("refs/heads/release".into(), "expected-oid".into())),
                push_tags: true,
            }
            .args(),
            strings([
                "--literal-pathspecs",
                "push",
                "--porcelain",
                "--progress",
                "--set-upstream",
                "--force-with-lease=refs/heads/release:expected-oid",
                "--atomic",
                "--tags",
                "--",
                "origin",
                "refs/heads/main:refs/heads/release",
            ])
        );
    }

    #[test]
    fn paths_are_always_after_double_dash() {
        let args = GitCommand::Add {
            paths: vec!["--intent-to-add".into()],
        }
        .args();
        assert_eq!(args[0], "--literal-pathspecs");
        assert_eq!(args[2], "--");
        assert_eq!(args[3], "--intent-to-add");
    }

    #[test]
    fn every_pathspec_command_forces_literal_matching() {
        let commands = [
            GitCommand::Diff {
                target: DiffTarget::Unstaged,
                paths: vec!["*".into()],
            },
            GitCommand::Add {
                paths: vec!["*".into()],
            },
            GitCommand::Remove {
                paths: vec!["*".into()],
            },
            GitCommand::RemoveCached {
                paths: vec!["*".into()],
            },
            GitCommand::RestoreWorktree {
                paths: vec!["*".into()],
            },
            GitCommand::RestoreStaged {
                paths: vec!["*".into()],
            },
            GitCommand::Unmerged {
                path: Some("*".into()),
            },
        ];
        for command in commands {
            assert_eq!(
                command.args().first(),
                Some(&OsString::from("--literal-pathspecs"))
            );
        }
    }

    #[test]
    fn switch_mutations_refuse_to_overwrite_ignored_paths() {
        let switch = GitCommand::Switch {
            branch: "topic".into(),
        }
        .args();
        assert!(switch.contains(&OsString::from("--no-overwrite-ignore")));

        let create = GitCommand::CreateAndSwitch {
            name: "topic".into(),
            start_point: "abc".into(),
        }
        .args();
        assert!(create.contains(&OsString::from("--no-overwrite-ignore")));
        assert!(create.contains(&OsString::from("-c")));
    }

    #[test]
    fn branch_deletion_forces_only_when_requested() {
        let safe = GitCommand::DeleteBranch {
            name: "topic".into(),
            force: false,
        }
        .args();
        let forced = GitCommand::DeleteBranch {
            name: "topic".into(),
            force: true,
        }
        .args();

        assert!(safe.contains(&OsString::from("--delete")));
        assert!(!safe.contains(&OsString::from("--force")));
        assert!(forced.contains(&OsString::from("--delete")));
        assert!(forced.contains(&OsString::from("--force")));
    }

    #[test]
    fn merge_commit_option_only_omits_no_commit_when_enabled() {
        let pending = GitCommand::Merge {
            source: "topic".into(),
            commit_immediately: false,
        }
        .args();
        let immediate = GitCommand::Merge {
            source: "topic".into(),
            commit_immediately: true,
        }
        .args();

        assert!(pending.contains(&OsString::from("--no-commit")));
        assert!(!immediate.contains(&OsString::from("--no-commit")));
        assert!(immediate.contains(&OsString::from("--no-ff")));
        assert!(immediate.contains(&OsString::from("--no-edit")));
    }

    #[test]
    fn lightweight_tag_creation_disables_signing_and_separates_options() {
        assert_eq!(
            GitCommand::CreateTag {
                name: "v1.0.0".into(),
                target: "abc123".into(),
            }
            .args(),
            strings([
                "--literal-pathspecs",
                "tag",
                "--no-sign",
                "--",
                "v1.0.0",
                "abc123",
            ])
        );
    }

    #[test]
    fn structured_merge_commit_actions_pass_the_selected_mainline() {
        for args in [
            GitCommand::CherryPickNoCommit {
                commit: "merge-oid".into(),
                mainline: Some(2),
            }
            .args(),
            GitCommand::RevertNoCommit {
                commit: "merge-oid".into(),
                mainline: Some(2),
            }
            .args(),
        ] {
            let mainline = args
                .iter()
                .position(|argument| argument == "--mainline")
                .expect("mainline flag");
            assert_eq!(args.get(mainline + 1), Some(&OsString::from("2")));
            assert_eq!(args.last(), Some(&OsString::from("merge-oid")));
        }
    }

    #[test]
    fn lost_commit_inventory_has_no_silent_count_limit() {
        let args = GitCommand::LostCommits {
            head: "head".into(),
            target: "target".into(),
        }
        .args();
        assert_eq!(
            args,
            [
                OsString::from("--literal-pathspecs"),
                OsString::from("rev-list"),
                OsString::from("head"),
                OsString::from("^target"),
                OsString::from("--"),
            ]
        );
    }

    #[test]
    fn commit_activity_reads_committer_metadata_from_one_fixed_head() {
        let args = GitCommand::CommitActivity {
            head_oid: "abc123".into(),
            since_unix_seconds: 99,
            until_unix_seconds: 199,
            limit: 100_001,
        }
        .args();
        assert_eq!(
            args,
            [
                OsString::from("--literal-pathspecs"),
                OsString::from("--no-pager"),
                OsString::from("log"),
                OsString::from("--no-show-signature"),
                OsString::from("--format=%ct%x1f%ae%x1f%an%x1e"),
                OsString::from("--since-as-filter=@99"),
                OsString::from("--until=@199"),
                OsString::from("--max-count=100001"),
                OsString::from("abc123"),
            ]
        );
    }

    #[test]
    fn branch_inventory_includes_each_tip_commit_time_for_activity_buckets() {
        assert_eq!(
            GitCommand::Branches.args(),
            [
                OsString::from("--literal-pathspecs"),
                OsString::from("for-each-ref"),
                OsString::from(
                    "--format=%(refname)%00%(refname:short)%00%(objectname)%00%(HEAD)%00%(upstream)%00%(committerdate:unix)",
                ),
                OsString::from("refs/heads"),
                OsString::from("refs/remotes"),
            ]
        );
    }

    #[test]
    fn repository_reference_inventory_includes_tags() {
        assert_eq!(
            GitCommand::References.args(),
            [
                OsString::from("--literal-pathspecs"),
                OsString::from("for-each-ref"),
                OsString::from("--format=%(refname)%00%(objectname)"),
                OsString::from("refs/heads"),
                OsString::from("refs/remotes"),
                OsString::from("refs/tags"),
            ]
        );
    }

    #[test]
    fn limited_reader_drains_to_eof_after_truncation() {
        let input = vec![b'x'; OUTPUT_LIMIT + 64 * 1024];
        let output = read_limited(Cursor::new(input)).unwrap();
        assert!(output.truncated);
        assert!(output.bytes.starts_with(&vec![b'x'; OUTPUT_LIMIT]));
        assert!(
            output
                .bytes
                .ends_with(b"[output truncated by application]\n")
        );
    }

    #[test]
    fn safety_parsers_reject_truncated_stdout() {
        assert!(GitCommand::Status.requires_complete_stdout());
        assert!(
            GitCommand::ChangedPaths {
                from: "a".into(),
                to: "b".into(),
            }
            .requires_complete_stdout()
        );
        assert!(
            GitCommand::IndexEntries {
                paths: vec!["f.txt".into()],
            }
            .requires_complete_stdout()
        );
        assert!(
            GitCommand::TreeEntries {
                treeish: "abc".into(),
                paths: vec!["f.txt".into()],
            }
            .requires_complete_stdout()
        );
        assert!(
            GitCommand::CommitsNotReachable {
                head: "abc".into(),
                excluded: "def".into(),
            }
            .requires_complete_stdout()
        );
        assert!(GitCommand::Unmerged { path: None }.requires_complete_stdout());
        assert!(GitCommand::CatFileSize { oid: "abc".into() }.requires_complete_stdout());
        assert!(
            GitCommand::CommitActivity {
                head_oid: "abc".into(),
                since_unix_seconds: 0,
                until_unix_seconds: 1,
                limit: 100_001,
            }
            .requires_complete_stdout()
        );
        assert!(
            !GitCommand::History {
                limit: 2_000,
                skip: 0,
            }
            .requires_complete_stdout()
        );
        assert!(
            !GitCommand::Diff {
                target: DiffTarget::Unstaged,
                paths: Vec::new(),
            }
            .requires_complete_stdout()
        );

        let error = reject_incomplete_stdout(
            GitOutput {
                argv: vec!["/usr/bin/git".into(), "status".into()],
                status: Some(0),
                stdout: vec![b'x'; OUTPUT_LIMIT],
                stderr: Vec::new(),
                truncated: true,
                cancelled: false,
                hook_executed: false,
            },
            true,
        )
        .unwrap_err();
        assert_eq!(error.code, crate::model::ErrorCode::UnsupportedRepository);
    }
}
