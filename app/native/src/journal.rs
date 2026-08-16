use crate::model::{ErrorCode, StructuredOperation, WorkspaceError, WorkspaceResult};
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
#[cfg(test)]
use std::path::Path;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OperationJournal {
    pub(crate) worktree_id: String,
    pub(crate) operation: StructuredOperation,
    pub(crate) source_oid: String,
    pub(crate) pre_head_oid: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) phase: Option<JournalPhase>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) effect_digest: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) state_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum JournalPhase {
    Preparing,
    Applied,
    AbortRecovery,
}

impl OperationJournal {
    pub(crate) fn effective_phase(&self) -> JournalPhase {
        self.phase.unwrap_or_else(|| {
            if self.effect_digest.is_some() && self.state_fingerprint.is_some() {
                JournalPhase::Applied
            } else {
                JournalPhase::Preparing
            }
        })
    }
}

#[derive(Debug, Clone)]
pub(crate) struct JournalStore {
    directory: PathBuf,
}

impl JournalStore {
    pub(crate) fn new(directory: PathBuf) -> WorkspaceResult<Self> {
        fs::create_dir_all(&directory).map_err(io_error)?;
        Ok(Self { directory })
    }

    pub(crate) fn load(&self, worktree_id: &str) -> WorkspaceResult<Option<OperationJournal>> {
        let path = self.path(worktree_id);
        match fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map(Some)
                .map_err(|error| WorkspaceError::new(ErrorCode::Io, error.to_string())),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(io_error(error)),
        }
    }

    pub(crate) fn save(&self, journal: &OperationJournal) -> WorkspaceResult<()> {
        let final_path = self.path(&journal.worktree_id);
        let temporary_path = final_path.with_extension("tmp");
        let bytes = serde_json::to_vec(journal)
            .map_err(|error| WorkspaceError::new(ErrorCode::Internal, error.to_string()))?;
        let mut file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&temporary_path)
            .map_err(io_error)?;
        file.write_all(&bytes).map_err(io_error)?;
        file.sync_all().map_err(io_error)?;
        fs::rename(&temporary_path, final_path).map_err(io_error)?;
        sync_directory(&self.directory)
    }

    pub(crate) fn clear(&self, worktree_id: &str) -> WorkspaceResult<()> {
        match fs::remove_file(self.path(worktree_id)) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(io_error(error)),
        }
    }

    fn path(&self, worktree_id: &str) -> PathBuf {
        self.directory.join(format!("{worktree_id}.json"))
    }
}

pub(crate) fn default_journal_directory() -> WorkspaceResult<PathBuf> {
    let base = std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|path| path.join("Library/Application Support"))
        .or_else(|| std::env::var_os("XDG_STATE_HOME").map(PathBuf::from))
        .unwrap_or_else(std::env::temp_dir);
    Ok(base.join("Stella/operations"))
}

#[cfg(test)]
pub(crate) fn test_journal_store(path: &Path) -> WorkspaceResult<JournalStore> {
    JournalStore::new(path.to_path_buf())
}

fn io_error(error: std::io::Error) -> WorkspaceError {
    WorkspaceError::new(ErrorCode::Io, error.to_string())
}

fn sync_directory(path: &std::path::Path) -> WorkspaceResult<()> {
    fs::File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(io_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_journal_phase_is_inferred_without_weakening_recovery() {
        let preparing: OperationJournal = serde_json::from_str(
            r#"{"worktreeId":"repo","operation":"cherryPick","sourceOid":"source","preHeadOid":"head"}"#,
        )
        .unwrap();
        assert_eq!(preparing.phase, None);
        assert_eq!(preparing.effective_phase(), JournalPhase::Preparing);

        let applied: OperationJournal = serde_json::from_str(
            r#"{"worktreeId":"repo","operation":"revert","sourceOid":"source","preHeadOid":"head","effectDigest":"effect","stateFingerprint":"state"}"#,
        )
        .unwrap();
        assert_eq!(applied.phase, None);
        assert_eq!(applied.effective_phase(), JournalPhase::Applied);
    }

    #[test]
    fn phase_is_saved_atomically_with_the_effect() {
        let temporary = tempfile::tempdir().unwrap();
        let store = JournalStore::new(temporary.path().to_path_buf()).unwrap();
        let journal = OperationJournal {
            worktree_id: "repo".into(),
            operation: StructuredOperation::CherryPick,
            source_oid: "source".into(),
            pre_head_oid: "head".into(),
            phase: Some(JournalPhase::Applied),
            effect_digest: Some("effect".into()),
            state_fingerprint: Some("state".into()),
        };

        store.save(&journal).unwrap();

        assert_eq!(store.load("repo").unwrap(), Some(journal));
        assert!(!temporary.path().join("repo.tmp").exists());
    }
}
