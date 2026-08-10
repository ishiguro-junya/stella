use crate::model::{CommandActivity, DiffTarget, ResetMode, WorkspaceError, WorkspaceResult};
use std::ffi::OsString;
use std::fs;
use std::io::{Read, Write};
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

const OUTPUT_LIMIT: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone)]
pub(crate) struct GitExecutor {
    executable: PathBuf,
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
    Diff {
        target: DiffTarget,
        paths: Vec<String>,
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
    Branches,
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
    },
    CreateBranch {
        name: String,
        start_point: String,
    },
    CreateAndSwitch {
        name: String,
        start_point: String,
    },
    Switch {
        branch: String,
    },
    MergeNoCommit {
        source: String,
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
    CatFileSize {
        oid: String,
    },
    CatFile {
        oid: String,
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
                "--format=%H%x00%P%x00%D%x00%an%x00%ae%x00%aI%x00%s%x00%B".into(),
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
            Self::Branches => strings([
                "for-each-ref",
                "--format=%(refname)%00%(refname:short)%00%(objectname)%00%(HEAD)%00%(upstream)",
                "refs/heads",
                "refs/remotes",
            ]),
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
            } => {
                let mut args = strings(["push", "--porcelain", "--progress"]);
                if *set_upstream {
                    args.push("--set-upstream".into());
                }
                args.push("--".into());
                args.push(remote.into());
                args.push(refspec.into());
                args
            }
            Self::CreateBranch { name, start_point } => vec![
                "branch".into(),
                "--".into(),
                name.into(),
                start_point.into(),
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
            Self::MergeNoCommit { source } => vec![
                "merge".into(),
                "--no-commit".into(),
                "--no-ff".into(),
                "--no-edit".into(),
                "--no-autostash".into(),
                "--no-overwrite-ignore".into(),
                "--".into(),
                source.into(),
            ],
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
            Self::CatFileSize { oid } => vec!["cat-file".into(), "-s".into(), oid.into()],
            Self::CatFile { oid } => vec!["cat-file".into(), "blob".into(), oid.into()],
        };
        // Gitは`--`より後のpath引数もpathspec式として解釈する。
        // 現在と将来の全commandで`*`、`[name]`、`:(glob)*`などの正当なfile名を安全に扱うため、
        // process全体の既定値をliteral matchにする。
        args.insert(0, "--literal-pathspecs".into());
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
                | Self::CommitActivity { .. }
                | Self::CommitMetadata { .. }
                | Self::CommitParents { .. }
                | Self::Branches
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
                | Self::CatFileSize { .. }
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
        Ok(Self { executable })
    }

    #[cfg(test)]
    pub(crate) fn at(executable: PathBuf) -> Self {
        Self { executable }
    }

    pub(crate) fn run(
        &self,
        cwd: Option<&Path>,
        command: GitCommand,
        stdin: Option<&[u8]>,
        control: Option<&RunControl>,
    ) -> WorkspaceResult<GitOutput> {
        let complete_stdout_required = command.requires_complete_stdout();
        let args = command.args();
        let argv = display_argv(&self.executable, &args);
        let hook_trace = matches!(command, GitCommand::Commit { .. }).then(HookTrace::new);
        let mut process = Command::new(&self.executable);
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
            .env("GIT_OPTIONAL_LOCKS", "0");
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
                format!("Failed to start Git: {error}"),
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
