use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub type RepoGeneration = u64;
pub type EventSeq = u64;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalizedMessage {
    pub id: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub args: BTreeMap<String, LocalizedArgument>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum LocalizedArgument {
    String(String),
    Number(serde_json::Number),
}

impl LocalizedMessage {
    pub fn new(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            args: BTreeMap::new(),
        }
    }

    pub fn arg(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.args
            .insert(key.into(), LocalizedArgument::String(value.into()));
        self
    }

    pub fn number_arg(
        mut self,
        key: impl Into<String>,
        value: impl Into<serde_json::Number>,
    ) -> Self {
        self.args
            .insert(key.into(), LocalizedArgument::Number(value.into()));
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub enum OpenRequest {
    Open {
        path: String,
    },
    OpenExisting {
        path: String,
    },
    Clone {
        remote: String,
        destination: String,
        operation_id: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSession {
    pub repo_id: String,
    pub snapshot: RepoSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DetachRequest {
    pub repo_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QueryRequest {
    pub repo_id: String,
    pub query: Query,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub enum Query {
    RepositoryAvailability {
        path: String,
    },
    Status,
    Diff {
        target: DiffTarget,
        #[serde(default)]
        paths: Vec<String>,
    },
    History {
        #[serde(default = "default_history_limit")]
        limit: u32,
        #[serde(default)]
        skip: u32,
        #[serde(default)]
        search: Option<String>,
    },
    CommitActivity {
        operation_id: String,
        bucket_boundaries_unix_seconds: Vec<i64>,
    },
    Branches,
    GitFlowOverview,
    CommitDetails {
        oid: String,
    },
    Conflict {
        path: String,
    },
    FileContents {
        path: String,
    },
    Remotes,
}

const fn default_history_limit() -> u32 {
    200
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DiffTarget {
    Unstaged,
    Staged,
    Head,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum PatchSelection {
    Lines {
        path: String,
        diff_revision: String,
        side: SelectionSide,
        start_line: u32,
        end_line: u32,
    },
    Hunk {
        path: String,
        diff_revision: String,
        hunk_index: u32,
    },
}

impl PatchSelection {
    pub fn path(&self) -> &str {
        match self {
            Self::Lines { path, .. } | Self::Hunk { path, .. } => path,
        }
    }

    pub fn diff_revision(&self) -> &str {
        match self {
            Self::Lines { diff_revision, .. } | Self::Hunk { diff_revision, .. } => diff_revision,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SelectionSide {
    Additions,
    Deletions,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind",
    content = "data"
)]
pub enum QueryOutcome {
    RepositoryAvailability(RepositoryAvailabilityResult),
    Status(RepoSnapshot),
    Diff(DiffResult),
    History(HistoryResult),
    CommitActivity(CommitActivityResult),
    Branches(BranchResult),
    GitFlowOverview(GitFlowOverview),
    CommitDetails(CommitDetails),
    Conflict(Box<ConflictDocument>),
    FileContents(FileDocument),
    Remotes(RemoteResult),
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RepositoryAvailability {
    Available,
    Missing,
    NotRepository,
    Inaccessible,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryAvailabilityResult {
    pub path: String,
    pub availability: RepositoryAvailability,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDefinition {
    pub name: String,
    pub fetch_urls: Vec<String>,
    pub push_urls: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteResult {
    pub remotes: Vec<RemoteDefinition>,
    pub repo_generation: RepoGeneration,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewRequest {
    pub repo_id: String,
    pub expected_generation: RepoGeneration,
    pub action: Action,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewOutcome {
    pub confirmation_token: Option<String>,
    pub expires_at_unix_ms: Option<u128>,
    pub summary: LocalizedMessage,
    pub destructive: bool,
    pub affected_paths: Vec<String>,
    pub affected_commits: Vec<String>,
    pub remote_effect: Option<LocalizedMessage>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub resolved_targets: Vec<ResolvedTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub impact_digest: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub lost_commit_oids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedTarget {
    pub input: String,
    pub oid: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteRequest {
    pub operation_id: String,
    pub repo_id: String,
    pub expected_generation: RepoGeneration,
    pub action: Action,
    pub confirmation_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CancelRequest {
    pub operation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CancelOutcome {
    pub accepted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ActionOutcome {
    pub operation_id: String,
    pub summary: LocalizedMessage,
    pub repo_generation: RepoGeneration,
    pub event_seq: EventSeq,
    pub snapshot: RepoSnapshot,
    pub command: CommandActivity,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conflict_edit: Option<ConflictEditResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conflict_document: Option<ConflictDocument>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub enum Action {
    Stage {
        #[serde(default)]
        paths: Vec<String>,
        selection: Option<PatchSelection>,
    },
    Unstage {
        #[serde(default)]
        paths: Vec<String>,
        selection: Option<PatchSelection>,
    },
    Discard {
        paths: Vec<String>,
        target: DiscardTarget,
        selection: Option<PatchSelection>,
    },
    Commit {
        input: CommitInput,
        include_all_changes: bool,
    },
    Fetch {
        remote: String,
    },
    Pull {
        remote: String,
        remote_branch: String,
    },
    Push {
        remote: String,
        local_branch: String,
        remote_branch: String,
        set_upstream: bool,
    },
    SetRemoteUrl {
        remote: String,
        url_kind: RemoteUrlKind,
        expected_url: String,
        new_url: String,
    },
    CreateBranch {
        name: String,
        start_point: String,
        checkout: bool,
    },
    CreateTag {
        name: String,
        target: String,
    },
    GitFlow {
        request: GitFlowRequest,
    },
    Checkout {
        branch: String,
    },
    Merge {
        source: String,
    },
    Rebase {
        onto: String,
    },
    CherryPick {
        commit: String,
        mainline: Option<u32>,
    },
    Revert {
        commit: String,
        mainline: Option<u32>,
    },
    Reset {
        commit: String,
        mode: ResetMode,
    },
    Continue,
    Skip,
    Abort,
    ConflictSave {
        session_id: String,
        conflict_generation: String,
        content_hash: String,
        result: String,
    },
    ConflictChoice {
        session_id: String,
        conflict_generation: String,
        content_hash: String,
        document_revision: String,
        base_document_revision: String,
        block_id: String,
        draft_text: String,
        choice: ConflictChoice,
    },
    ConflictMarkResolved {
        session_id: String,
        conflict_generation: String,
        content_hash: String,
        result_kind: ConflictResultKind,
    },
    ConflictMaterialize {
        session_id: String,
        conflict_generation: String,
        choice: ConflictChoice,
    },
    ConflictOpenExternal {
        session_id: String,
        conflict_generation: String,
        editor: ExternalEditor,
    },
    SaveFile {
        path: String,
        text: String,
        expected_content_hash: String,
    },
    FileAction {
        paths: Vec<String>,
        operation: FileOperation,
    },
}

impl Action {
    pub fn requires_confirmation(&self) -> bool {
        matches!(
            self,
            Self::Discard { .. }
                | Self::Reset {
                    mode: ResetMode::Hard,
                    ..
                }
                | Self::Rebase { .. }
                | Self::Abort
                | Self::ConflictMaterialize { .. }
                | Self::FileAction {
                    operation: FileOperation::MoveToTrash,
                    ..
                }
        ) || matches!(self, Self::GitFlow { request } if request.destructive())
    }

    pub fn kind_name(&self) -> &'static str {
        match self {
            Self::Stage { .. } => "stage",
            Self::Unstage { .. } => "unstage",
            Self::Discard { .. } => "discard",
            Self::Commit { .. } => "commit",
            Self::Fetch { .. } => "fetch",
            Self::Pull { .. } => "pull",
            Self::Push { .. } => "push",
            Self::SetRemoteUrl { .. } => "setRemoteUrl",
            Self::CreateBranch { .. } => "createBranch",
            Self::CreateTag { .. } => "createTag",
            Self::GitFlow { .. } => "gitFlow",
            Self::Checkout { .. } => "checkout",
            Self::Merge { .. } => "merge",
            Self::Rebase { .. } => "rebase",
            Self::CherryPick { .. } => "cherryPick",
            Self::Revert { .. } => "revert",
            Self::Reset { .. } => "reset",
            Self::Continue => "continue",
            Self::Skip => "skip",
            Self::Abort => "abort",
            Self::ConflictSave { .. } => "conflictSave",
            Self::ConflictChoice { .. } => "conflictChoice",
            Self::ConflictMarkResolved { .. } => "conflictMarkResolved",
            Self::ConflictMaterialize { .. } => "conflictMaterialize",
            Self::ConflictOpenExternal { .. } => "conflictOpenExternal",
            Self::SaveFile { .. } => "saveFile",
            Self::FileAction { .. } => "fileAction",
        }
    }

    pub fn requires_preview_binding(&self) -> bool {
        self.requires_confirmation()
            || matches!(
                self,
                Self::Reset { .. }
                    | Self::Merge { .. }
                    | Self::Rebase { .. }
                    | Self::CherryPick { .. }
                    | Self::Revert { .. }
                    | Self::CreateBranch { .. }
                    | Self::CreateTag { .. }
                    | Self::SetRemoteUrl { .. }
                    | Self::GitFlow { .. }
            )
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RemoteUrlKind {
    Fetch,
    Push,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GitFlowCommand {
    Init,
    Start,
    List,
    Checkout,
    Update,
    Publish,
    Track,
    Rename,
    Delete,
    Finish,
    Integrate,
    ConfigList,
    ConfigAddBase,
    ConfigAddTopic,
    ConfigEditBase,
    ConfigEditTopic,
    ConfigRenameBase,
    ConfigRenameTopic,
    ConfigDeleteBase,
    ConfigDeleteTopic,
    ConfigStatus,
    ConfigSync,
    Continue,
    Abort,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GitFlowPreset {
    Classic,
    Github,
    Gitlab,
    Custom,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GitFlowStrategy {
    Merge,
    Rebase,
    Squash,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitFlowRequest {
    pub command: GitFlowCommand,
    pub topic_type: Option<String>,
    pub name: Option<String>,
    pub secondary_name: Option<String>,
    pub parent: Option<String>,
    pub base: Option<String>,
    pub preset: Option<GitFlowPreset>,
    #[serde(default)]
    pub shared: bool,
    #[serde(default)]
    pub fetch: bool,
    #[serde(default)]
    pub remote: bool,
    pub tag_name: Option<String>,
    pub tag_message: Option<String>,
    #[serde(default)]
    pub sign: bool,
    pub signing_key: Option<String>,
    #[serde(default)]
    pub keep: bool,
    #[serde(default)]
    pub push: bool,
    pub strategy: Option<GitFlowStrategy>,
    pub downstream_strategy: Option<GitFlowStrategy>,
    pub prefix: Option<String>,
    pub starting_point: Option<String>,
    pub auto_update: Option<bool>,
    pub tag: Option<bool>,
}

impl GitFlowRequest {
    pub fn destructive(&self) -> bool {
        matches!(
            self.command,
            GitFlowCommand::Delete
                | GitFlowCommand::Finish
                | GitFlowCommand::Integrate
                | GitFlowCommand::ConfigRenameBase
                | GitFlowCommand::ConfigRenameTopic
                | GitFlowCommand::ConfigDeleteBase
                | GitFlowCommand::ConfigDeleteTopic
                | GitFlowCommand::Abort
        )
    }

    pub fn remote_effect(&self) -> bool {
        self.remote || self.push || matches!(self.command, GitFlowCommand::Publish)
    }

    pub fn uploads_lfs_objects(&self) -> bool {
        matches!(self.command, GitFlowCommand::Publish)
            || matches!(self.command, GitFlowCommand::Finish) && self.push
    }

    pub fn requires_clean_worktree(&self) -> bool {
        matches!(
            self.command,
            GitFlowCommand::Start
                | GitFlowCommand::Checkout
                | GitFlowCommand::Update
                | GitFlowCommand::Track
                | GitFlowCommand::Rename
                | GitFlowCommand::Delete
                | GitFlowCommand::Finish
                | GitFlowCommand::Integrate
        )
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FileOperation {
    MoveToTrash,
    RevealInFinder,
    OpenInDefaultApp,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DiscardTarget {
    Unstaged,
    Untracked,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ResetMode {
    Soft,
    Mixed,
    Hard,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "format")]
pub enum CommitInput {
    Plain {
        message: String,
    },
    Conventional {
        #[serde(rename = "type")]
        commit_type: String,
        scope: Option<String>,
        breaking: bool,
        description: String,
        body: Option<String>,
        #[serde(default)]
        footers: Vec<CommitFooter>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitFooter {
    pub token: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepoSnapshot {
    pub repo_id: String,
    pub root: String,
    pub head: HeadState,
    pub upstream: Option<String>,
    pub ahead: u64,
    pub behind: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub additions: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deletions: Option<u64>,
    pub entries: Vec<StatusEntry>,
    pub operation: OperationState,
    #[serde(default)]
    pub git_flow_operation: Option<String>,
    pub repo_generation: RepoGeneration,
    pub event_seq: EventSeq,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub enum HeadState {
    Branch { name: String, oid: Option<String> },
    Detached { oid: String },
    Unborn { name: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StatusEntry {
    pub path: String,
    pub original_path: Option<String>,
    pub index_status: String,
    pub worktree_status: String,
    pub conflict: bool,
    pub untracked: bool,
    pub submodule: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub enum OperationState {
    None,
    Merge {
        incoming_oid: Option<String>,
    },
    Rebase,
    CherryPick {
        source_oid: Option<String>,
    },
    Revert {
        source_oid: Option<String>,
    },
    Unknown {
        marker: String,
    },
    PendingStructuredCommit {
        operation: StructuredOperation,
        source_oid: String,
        pre_head_oid: String,
    },
    StructuredAbortRecovery {
        operation: StructuredOperation,
        source_oid: String,
        pre_head_oid: String,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum StructuredOperation {
    CherryPick,
    Revert,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiffResult {
    pub patch: String,
    pub truncated: bool,
    pub diff_revision: String,
    pub repo_generation: RepoGeneration,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryResult {
    pub commits: Vec<CommitSummary>,
    pub repo_generation: RepoGeneration,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitActivityResult {
    pub repo_generation: RepoGeneration,
    pub history_revision: String,
    pub time_basis: CommitActivityTimeBasis,
    pub totals: CommitActivityTotals,
    pub buckets: Vec<CommitActivityBucket>,
    pub coverage: CommitActivityCoverage,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CommitActivityTimeBasis {
    Committed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitActivityTotals {
    pub commits: u64,
    pub active_days: u64,
    pub contributors: u64,
    pub branches: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitActivityBucket {
    pub start_unix_seconds: i64,
    pub end_unix_seconds: i64,
    pub commit_count: u64,
    pub contributor_count: u64,
    pub branch_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub enum CommitActivityCoverage {
    Complete,
    Truncated { scan_limit: u32 },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitSummary {
    pub oid: String,
    pub parents: Vec<String>,
    pub refs: Vec<String>,
    pub author: String,
    pub authored_at: String,
    pub subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetails {
    pub oid: String,
    pub parents: Vec<String>,
    pub refs: Vec<String>,
    pub author: String,
    pub author_email: String,
    pub authored_at: String,
    pub subject: String,
    pub body: String,
    pub patch: String,
    pub truncated: bool,
    pub diff_revision: String,
    pub repo_generation: RepoGeneration,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BranchResult {
    pub branches: Vec<BranchSummary>,
    pub repo_generation: RepoGeneration,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BranchSummary {
    pub full_name: String,
    pub short_name: String,
    pub oid: String,
    pub current: bool,
    pub remote: bool,
    pub upstream: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitFlowOverview {
    pub initialized: bool,
    pub available: bool,
    pub raw: serde_json::Value,
    pub output: String,
    pub repo_generation: RepoGeneration,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandActivity {
    pub argv: Vec<String>,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEvent {
    pub repo_id: String,
    pub event_seq: EventSeq,
    pub repo_generation: RepoGeneration,
    pub operation_id: Option<String>,
    pub phase: EventPhase,
    pub summary: LocalizedMessage,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub details: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EventPhase {
    Started,
    Progress,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConflictDocument {
    pub session_id: String,
    pub repo_id: String,
    pub path: String,
    pub operation: ConflictOperation,
    pub conflict_generation: String,
    pub content_hash: String,
    pub labels: ConflictLabels,
    pub sides: ConflictSides,
    pub result: ConflictResult,
    pub blocks: Vec<ConflictBlock>,
    pub kind: ConflictKind,
    pub capabilities: ConflictCapabilities,
    #[serde(default)]
    pub related_paths: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConflictOperation {
    Merge,
    Rebase,
    CherryPick,
    Revert,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConflictLabels {
    pub current: LocalizedMessage,
    pub incoming: LocalizedMessage,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConflictSides {
    pub base: Option<ConflictSide>,
    pub current: Option<ConflictSide>,
    pub incoming: Option<ConflictSide>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConflictSide {
    pub oid: String,
    pub mode: String,
    pub text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConflictResult {
    pub text: String,
    pub line_ending: LineEnding,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LineEnding {
    Lf,
    Crlf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileDocument {
    pub repo_id: String,
    pub path: String,
    pub text: String,
    pub line_ending: LineEnding,
    pub has_utf8_bom: bool,
    pub content_hash: String,
    pub repo_generation: RepoGeneration,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConflictBlock {
    pub id: String,
    pub range_utf16: Utf16Range,
    pub replacements: ConflictReplacements,
    pub state: ConflictBlockState,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Utf16Range {
    pub from: u32,
    pub to: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConflictReplacements {
    pub current: String,
    pub incoming: String,
    pub both: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConflictEditResult {
    pub text: String,
    pub blocks: Vec<ConflictBlock>,
    pub document_revision: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConflictBlockState {
    Unresolved,
    Current,
    Incoming,
    Both,
    Manual,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConflictKind {
    Text,
    AddAdd,
    ModifyDelete,
    Binary,
    NonUtf8,
    Nul,
    Oversize,
    RenameRename,
    Symlink,
    Submodule,
    DirectoryFile,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConflictCapabilities {
    pub in_app_edit: bool,
    pub performance_view: bool,
    pub choose_current: bool,
    pub choose_incoming: bool,
    pub choose_both: bool,
    pub delete: bool,
    pub external_editor: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConflictChoice {
    Current,
    Incoming,
    Both,
    Delete,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConflictResultKind {
    File,
    Delete,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalEditor {
    pub kind: ExternalEditorKind,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExternalEditorKind {
    SystemDefault,
    TextEdit,
    VisualStudioCode,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceError {
    pub code: ErrorCode,
    pub message: String,
    pub localized_message: LocalizedMessage,
    #[serde(default)]
    pub details: BTreeMap<String, String>,
}

impl WorkspaceError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            localized_message: LocalizedMessage::new(code.message_id()),
            details: BTreeMap::new(),
        }
    }

    pub fn localized_message(mut self, message: LocalizedMessage) -> Self {
        self.localized_message = message;
        self
    }

    pub fn detail(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.details.insert(key.into(), value.into());
        self
    }
}

impl std::fmt::Display for WorkspaceError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for WorkspaceError {}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    InvalidRequest,
    RepoNotFound,
    UnsupportedRepository,
    StaleGeneration,
    StaleDiff,
    PreviewRequired,
    PreviewExpired,
    PreviewMismatch,
    PullDiverged,
    GitFailed,
    HookFailed,
    AuthenticationFailed,
    RemoteUnavailable,
    NetworkFailed,
    ConflictStateChanged,
    OperationInProgress,
    Cancelled,
    Io,
    Internal,
}

impl ErrorCode {
    fn message_id(self) -> &'static str {
        match self {
            Self::InvalidRequest => "errorInvalidRequest",
            Self::RepoNotFound => "errorRepoNotFound",
            Self::UnsupportedRepository => "errorUnsupportedRepository",
            Self::StaleGeneration => "errorStaleGeneration",
            Self::StaleDiff => "errorStaleDiff",
            Self::PreviewRequired => "errorPreviewRequired",
            Self::PreviewExpired => "errorPreviewExpired",
            Self::PreviewMismatch => "errorPreviewMismatch",
            Self::PullDiverged => "errorPullDiverged",
            Self::GitFailed => "errorGitFailed",
            Self::HookFailed => "errorHookFailed",
            Self::AuthenticationFailed => "errorAuthenticationFailed",
            Self::RemoteUnavailable => "errorRemoteUnavailable",
            Self::NetworkFailed => "errorNetworkFailed",
            Self::ConflictStateChanged => "errorConflictStateChanged",
            Self::OperationInProgress => "errorOperationInProgress",
            Self::Cancelled => "errorCancelled",
            Self::Io => "errorIo",
            Self::Internal => "errorInternal",
        }
    }
}

pub type WorkspaceResult<T> = Result<T, WorkspaceError>;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn localized_messages_and_errors_use_stable_wire_ids_without_losing_diagnostics() {
        let message = LocalizedMessage::new("previewMovePathToTrash")
            .arg("path", "src/app.ts")
            .number_arg("count", 2_u8);
        assert_eq!(
            serde_json::to_value(message).unwrap(),
            json!({
                "id": "previewMovePathToTrash",
                "args": { "count": 2, "path": "src/app.ts" }
            })
        );

        let error = WorkspaceError::new(ErrorCode::GitFailed, "Git operation failed")
            .detail("stderr", "fatal: rejected");
        assert_eq!(
            serde_json::to_value(error).unwrap(),
            json!({
                "code": "gitFailed",
                "message": "Git operation failed",
                "localizedMessage": { "id": "errorGitFailed" },
                "details": { "stderr": "fatal: rejected" }
            })
        );
    }

    #[test]
    fn open_request_struct_variant_fields_use_exact_camel_case_wire_names() {
        assert_eq!(
            serde_json::from_value::<OpenRequest>(json!({
                "kind": "open",
                "path": "/tmp/repo"
            }))
            .unwrap(),
            OpenRequest::Open {
                path: "/tmp/repo".into(),
            }
        );
        assert_eq!(
            serde_json::from_value::<OpenRequest>(json!({
                "kind": "openExisting",
                "path": "/tmp/repo"
            }))
            .unwrap(),
            OpenRequest::OpenExisting {
                path: "/tmp/repo".into(),
            }
        );
        assert_eq!(
            serde_json::from_value::<OpenRequest>(json!({
                "kind": "clone",
                "remote": "/tmp/remote.git",
                "destination": "/tmp/repo",
                "operationId": "clone-1"
            }))
            .unwrap(),
            OpenRequest::Clone {
                remote: "/tmp/remote.git".into(),
                destination: "/tmp/repo".into(),
                operation_id: "clone-1".into(),
            }
        );
    }

    #[test]
    fn history_search_uses_the_exact_optional_wire_field() {
        let query = Query::History {
            limit: 100,
            skip: 20,
            search: Some("origin/feature".into()),
        };
        assert_eq!(
            serde_json::to_value(query).unwrap(),
            json!({
                "kind": "history",
                "limit": 100,
                "skip": 20,
                "search": "origin/feature"
            })
        );
        assert_eq!(
            serde_json::from_value::<Query>(json!({
                "kind": "history",
                "limit": 100,
                "skip": 0
            }))
            .unwrap(),
            Query::History {
                limit: 100,
                skip: 0,
                search: None,
            }
        );
    }

    #[test]
    fn commit_activity_query_and_outcome_use_the_exact_wire_contract() {
        let query = Query::CommitActivity {
            operation_id: "activity-query-1".into(),
            bucket_boundaries_unix_seconds: vec![1_700_000_000, 1_700_086_400],
        };
        assert_eq!(
            serde_json::to_value(query).unwrap(),
            json!({
                "kind": "commitActivity",
                "operationId": "activity-query-1",
                "bucketBoundariesUnixSeconds": [1_700_000_000_i64, 1_700_086_400_i64]
            })
        );

        let outcome = QueryOutcome::CommitActivity(CommitActivityResult {
            repo_generation: 4,
            history_revision: "abc123".into(),
            time_basis: CommitActivityTimeBasis::Committed,
            totals: CommitActivityTotals {
                commits: 3,
                active_days: 1,
                contributors: 2,
                branches: 4,
            },
            buckets: vec![CommitActivityBucket {
                start_unix_seconds: 1_700_000_000,
                end_unix_seconds: 1_700_086_400,
                commit_count: 3,
                contributor_count: 2,
                branch_count: 1,
            }],
            coverage: CommitActivityCoverage::Truncated {
                scan_limit: 100_000,
            },
        });
        assert_eq!(
            serde_json::to_value(outcome).unwrap(),
            json!({
                "kind": "commitActivity",
                "data": {
                    "repoGeneration": 4,
                    "historyRevision": "abc123",
                    "timeBasis": "committed",
                    "totals": {
                        "commits": 3,
                        "activeDays": 1,
                        "contributors": 2,
                        "branches": 4
                    },
                    "buckets": [{
                        "startUnixSeconds": 1_700_000_000_i64,
                        "endUnixSeconds": 1_700_086_400_i64,
                        "commitCount": 3,
                        "contributorCount": 2,
                        "branchCount": 1
                    }],
                    "coverage": {
                        "kind": "truncated",
                        "scanLimit": 100_000
                    }
                }
            })
        );
    }

    #[test]
    fn action_and_operation_struct_variant_fields_use_exact_camel_case_wire_names() {
        let action = Action::ConflictChoice {
            session_id: "session".into(),
            conflict_generation: "generation".into(),
            content_hash: "content".into(),
            document_revision: "revision".into(),
            base_document_revision: "base-revision".into(),
            block_id: "block".into(),
            draft_text: "draft".into(),
            choice: ConflictChoice::Incoming,
        };
        assert_eq!(
            serde_json::to_value(action).unwrap(),
            json!({
                "kind": "conflictChoice",
                "sessionId": "session",
                "conflictGeneration": "generation",
                "contentHash": "content",
                "documentRevision": "revision",
                "baseDocumentRevision": "base-revision",
                "blockId": "block",
                "draftText": "draft",
                "choice": "incoming"
            })
        );
        assert_eq!(
            serde_json::to_value(OperationState::PendingStructuredCommit {
                operation: StructuredOperation::CherryPick,
                source_oid: "source".into(),
                pre_head_oid: "head".into(),
            })
            .unwrap(),
            json!({
                "kind": "pendingStructuredCommit",
                "operation": "cherryPick",
                "sourceOid": "source",
                "preHeadOid": "head"
            })
        );
        assert_eq!(
            serde_json::to_value(OperationState::StructuredAbortRecovery {
                operation: StructuredOperation::Revert,
                source_oid: "source".into(),
                pre_head_oid: "head".into(),
            })
            .unwrap(),
            json!({
                "kind": "structuredAbortRecovery",
                "operation": "revert",
                "sourceOid": "source",
                "preHeadOid": "head"
            })
        );
        assert_eq!(
            serde_json::to_value(Action::CreateBranch {
                name: "topic".into(),
                start_point: "HEAD".into(),
                checkout: true,
            })
            .unwrap(),
            json!({
                "kind": "createBranch",
                "name": "topic",
                "startPoint": "HEAD",
                "checkout": true
            })
        );
        assert_eq!(
            serde_json::to_value(Action::CreateTag {
                name: "v1.0.0".into(),
                target: "HEAD".into(),
            })
            .unwrap(),
            json!({
                "kind": "createTag",
                "name": "v1.0.0",
                "target": "HEAD"
            })
        );
        assert_eq!(
            serde_json::to_value(Action::CherryPick {
                commit: "merge-oid".into(),
                mainline: Some(2),
            })
            .unwrap(),
            json!({
                "kind": "cherryPick",
                "commit": "merge-oid",
                "mainline": 2
            })
        );
        assert_eq!(
            serde_json::to_value(Action::FileAction {
                paths: vec!["src/app.ts".into()],
                operation: FileOperation::RevealInFinder,
            })
            .unwrap(),
            json!({
                "kind": "fileAction",
                "paths": ["src/app.ts"],
                "operation": "revealInFinder"
            })
        );
        assert_eq!(
            serde_json::to_value(Action::Commit {
                input: CommitInput::Plain {
                    message: "ordinary message".into(),
                },
                include_all_changes: false,
            })
            .unwrap(),
            json!({
                "kind": "commit",
                "input": {
                    "format": "plain",
                    "message": "ordinary message"
                },
                "includeAllChanges": false
            })
        );
        assert_eq!(
            serde_json::to_value(Action::Commit {
                input: CommitInput::Conventional {
                    commit_type: "feat".into(),
                    scope: Some("ui".into()),
                    breaking: false,
                    description: "structured message".into(),
                    body: None,
                    footers: Vec::new(),
                },
                include_all_changes: true,
            })
            .unwrap(),
            json!({
                "kind": "commit",
                "input": {
                    "format": "conventional",
                    "type": "feat",
                    "scope": "ui",
                    "breaking": false,
                    "description": "structured message",
                    "body": null,
                    "footers": []
                },
                "includeAllChanges": true
            })
        );
    }
}
