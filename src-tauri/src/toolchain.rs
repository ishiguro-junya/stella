use crate::git::GitExecutor;
use crate::model::{ErrorCode, WorkspaceError, WorkspaceResult};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;

const SETTINGS_FILE: &str = "toolchain.json";
const BUNDLED_DIRECTORY: &str = "toolchain";
const SEARCH_DIRECTORIES: [&str; 3] = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ToolchainMode {
    #[default]
    Bundled,
    System,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolchainComponentStatus {
    pub available: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub error: Option<String>,
}

impl ToolchainComponentStatus {
    fn missing(path: Option<&Path>, message: impl Into<String>) -> Self {
        Self {
            available: false,
            path: path.map(|value| value.display().to_string()),
            version: None,
            error: Some(message.into()),
        }
    }

    fn probe(path: PathBuf, args: &[&str]) -> Self {
        if !path.is_file() {
            return Self::missing(Some(&path), "実行ファイルが見つかりません。");
        }
        let output = Command::new(&path)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("LC_ALL", "C")
            .env("LANG", "C")
            .output();
        match output {
            Ok(output) if output.status.success() => {
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
                Self {
                    available: true,
                    path: Some(path.display().to_string()),
                    version: Some(if stdout.is_empty() { stderr } else { stdout }),
                    error: None,
                }
            }
            Ok(output) => Self::missing(
                Some(&path),
                String::from_utf8_lossy(&output.stderr).trim().to_owned(),
            ),
            Err(error) => Self::missing(Some(&path), format!("起動できませんでした: {error}")),
        }
    }

    fn path_buf(&self) -> Option<PathBuf> {
        self.available
            .then(|| self.path.as_ref().map(PathBuf::from))
            .flatten()
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolchainStatus {
    pub active_mode: ToolchainMode,
    pub selected_mode: ToolchainMode,
    pub restart_required: bool,
    pub git: ToolchainComponentStatus,
    pub git_lfs: ToolchainComponentStatus,
    pub git_flow: ToolchainComponentStatus,
    pub gpg_available: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetToolchainModeRequest {
    pub mode: ToolchainMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PersistedSettings {
    #[serde(default)]
    toolchain_mode: ToolchainMode,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BundledMarker {
    manifest_sha256: String,
    files: BTreeMap<String, String>,
}

#[derive(Debug, Clone)]
struct ResolvedToolchain {
    mode: ToolchainMode,
    root: Option<PathBuf>,
    git: ToolchainComponentStatus,
    git_lfs: ToolchainComponentStatus,
    git_flow: ToolchainComponentStatus,
    gpg_available: bool,
}

impl ResolvedToolchain {
    fn executor(&self) -> GitExecutor {
        let git_path = self
            .git
            .path_buf()
            .unwrap_or_else(|| PathBuf::from("/nonexistent/stella-git"));
        let mut environment = Vec::<(OsString, OsString)>::new();
        let executable_directories = match &self.root {
            Some(root) => vec![
                root.join("bin"),
                PathBuf::from("/usr/bin"),
                PathBuf::from("/bin"),
                PathBuf::from("/usr/sbin"),
                PathBuf::from("/sbin"),
            ],
            None => SEARCH_DIRECTORIES
                .into_iter()
                .map(PathBuf::from)
                .chain([PathBuf::from("/bin"), PathBuf::from("/usr/sbin")])
                .collect(),
        };
        let path = join_search_path(executable_directories.into_iter());
        environment.push(("PATH".into(), path));

        if let Some(root) = &self.root {
            environment.push((
                "GIT_EXEC_PATH".into(),
                root.join("libexec/git-core").into_os_string(),
            ));
            environment.push((
                "GIT_TEMPLATE_DIR".into(),
                root.join("share/git-core/templates").into_os_string(),
            ));
        }
        let lfs_filter = if self.git_lfs.available {
            [
                ("filter.lfs.clean", "git-lfs clean -- %f"),
                ("filter.lfs.smudge", "git-lfs smudge -- %f"),
                ("filter.lfs.process", "git-lfs filter-process"),
                ("filter.lfs.required", "true"),
            ]
        } else {
            // LFS filterが未設定だとGitはpointerを通常fileとしてcheckoutできてしまう。
            // required filterを失敗させ、attach時の診断をすり抜けたBranch切替も安全に止める。
            [
                ("filter.lfs.clean", "/usr/bin/false"),
                ("filter.lfs.smudge", "/usr/bin/false"),
                ("filter.lfs.process", "/usr/bin/false"),
                ("filter.lfs.required", "true"),
            ]
        };
        for (index, (key, value)) in lfs_filter.into_iter().enumerate() {
            environment.push((format!("GIT_CONFIG_KEY_{index}").into(), key.into()));
            environment.push((format!("GIT_CONFIG_VALUE_{index}").into(), value.into()));
        }
        environment.push(("GIT_CONFIG_COUNT".into(), "4".into()));

        GitExecutor::configured(
            git_path,
            self.git_lfs.path_buf(),
            self.git_flow.path_buf(),
            environment,
            self.git.error.clone(),
        )
    }

    fn status(&self, active_mode: ToolchainMode, selected_mode: ToolchainMode) -> ToolchainStatus {
        ToolchainStatus {
            active_mode,
            selected_mode,
            restart_required: active_mode != selected_mode,
            git: self.git.clone(),
            git_lfs: self.git_lfs.clone(),
            git_flow: self.git_flow.clone(),
            gpg_available: self.gpg_available,
        }
    }
}

pub struct ToolchainManager {
    settings_path: PathBuf,
    resource_directory: PathBuf,
    selected_mode: Mutex<ToolchainMode>,
    active: ResolvedToolchain,
}

impl ToolchainManager {
    pub fn load(config_directory: PathBuf, resource_directory: PathBuf) -> Self {
        let settings_path = config_directory.join(SETTINGS_FILE);
        let selected_mode = read_settings(&settings_path).toolchain_mode;
        let active = match selected_mode {
            ToolchainMode::Bundled => resolve_bundled(&resource_directory),
            ToolchainMode::System => resolve_system(),
        };
        Self {
            settings_path,
            resource_directory,
            selected_mode: Mutex::new(selected_mode),
            active,
        }
    }

    pub(crate) fn executor(&self) -> GitExecutor {
        self.active.executor()
    }

    pub fn status(&self) -> ToolchainStatus {
        let selected_mode = *self
            .selected_mode
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if self.active.mode == selected_mode {
            return self.active.status(self.active.mode, selected_mode);
        }
        let selected = match selected_mode {
            ToolchainMode::Bundled => resolve_bundled(&self.resource_directory),
            ToolchainMode::System => resolve_system(),
        };
        selected.status(self.active.mode, selected_mode)
    }

    pub fn set_mode(&self, mode: ToolchainMode) -> WorkspaceResult<ToolchainStatus> {
        let candidate = match mode {
            ToolchainMode::Bundled => resolve_bundled(&self.resource_directory),
            ToolchainMode::System => resolve_system(),
        };
        if !candidate.git.available {
            return Err(WorkspaceError::new(
                ErrorCode::InvalidRequest,
                "選択したtoolchainに利用可能なGitがありません。",
            )
            .detail("mode", format!("{mode:?}"))
            .detail(
                "reason",
                candidate
                    .git
                    .error
                    .unwrap_or_else(|| "Git unavailable".into()),
            ));
        }
        write_settings(&self.settings_path, mode)?;
        *self
            .selected_mode
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = mode;
        Ok(self.status())
    }
}

fn resolve_bundled(resource_directory: &Path) -> ResolvedToolchain {
    let root = resource_directory.join(BUNDLED_DIRECTORY);
    resolve_bundled_root(root)
}

fn resolve_bundled_root(root: PathBuf) -> ResolvedToolchain {
    let validation_error = validate_bundled_root(&root).err();
    let status = |path: PathBuf, args: &[&str]| {
        if let Some(error) = &validation_error {
            ToolchainComponentStatus::missing(Some(&path), error.clone())
        } else {
            ToolchainComponentStatus::probe(path, args)
        }
    };
    ResolvedToolchain {
        mode: ToolchainMode::Bundled,
        git: status(root.join("bin/git"), &["--version"]),
        git_lfs: status(root.join("bin/git-lfs"), &["version"]),
        git_flow: status(root.join("bin/git-flow"), &["version"]),
        gpg_available: find_component("gpg", &["--version"]).available,
        root: Some(root),
    }
}

fn validate_bundled_root(root: &Path) -> Result<(), String> {
    let marker_path = root.join(".stella-toolchain.json");
    let marker: BundledMarker = serde_json::from_slice(
        &fs::read(&marker_path)
            .map_err(|error| format!("内蔵toolchain markerを読めません: {error}"))?,
    )
    .map_err(|error| format!("内蔵toolchain markerが不正です: {error}"))?;
    let expected_manifest = sha256_hex(include_bytes!("../../toolchain.lock.json"));
    if marker.manifest_sha256 != expected_manifest {
        return Err("内蔵toolchainのlock manifestがApplicationと一致しません。".into());
    }
    let required_files = [
        "bin/git",
        "bin/git-lfs",
        "bin/git-flow",
        "libexec/git-core/git-remote-https",
        "libexec/git-core/git-credential-osxkeychain",
    ];
    for required in required_files
        .iter()
        .copied()
        .chain(["share/git-core/templates"])
    {
        if !root.join(required).exists() {
            return Err(format!("内蔵toolchain componentがありません: {required}"));
        }
    }
    for required in required_files {
        if !marker.files.contains_key(required) {
            return Err(format!(
                "内蔵toolchain checksumが記録されていません: {required}"
            ));
        }
    }
    for (relative_path, expected) in &marker.files {
        let path = root.join(relative_path);
        let actual = sha256_hex(
            &fs::read(&path)
                .map_err(|error| format!("{relative_path}を検証できません: {error}"))?,
        );
        if &actual != expected {
            return Err(format!(
                "内蔵toolchain checksumが一致しません: {relative_path}"
            ));
        }
    }
    Ok(())
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn resolve_system() -> ResolvedToolchain {
    let git = find_component("git", &["--version"]);
    let git_lfs = find_component("git-lfs", &["version"]);
    let git_flow = find_component("git-flow", &["version"]);
    ResolvedToolchain {
        mode: ToolchainMode::System,
        root: None,
        git,
        git_lfs,
        git_flow,
        gpg_available: find_component("gpg", &["--version"]).available,
    }
}

fn find_component(name: &str, args: &[&str]) -> ToolchainComponentStatus {
    for directory in SEARCH_DIRECTORIES {
        let path = Path::new(directory).join(name);
        if path.is_file() {
            return ToolchainComponentStatus::probe(path, args);
        }
    }
    ToolchainComponentStatus::missing(
        None,
        format!("{name}は標準の実行ファイルpathに見つかりません。"),
    )
}

fn join_search_path(directories: impl Iterator<Item = PathBuf>) -> OsString {
    let mut values = Vec::new();
    for directory in directories {
        if !values.contains(&directory) {
            values.push(directory);
        }
    }
    std::env::join_paths(values).unwrap_or_else(|_| OsString::from("/usr/bin:/bin"))
}

fn read_settings(path: &Path) -> PersistedSettings {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write_settings(path: &Path, mode: ToolchainMode) -> WorkspaceResult<()> {
    let parent = path.parent().ok_or_else(|| {
        WorkspaceError::new(ErrorCode::Internal, "toolchain設定pathを解決できません。")
    })?;
    fs::create_dir_all(parent).map_err(settings_io_error)?;
    let temporary = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(&PersistedSettings {
        toolchain_mode: mode,
    })
    .map_err(|error| WorkspaceError::new(ErrorCode::Internal, error.to_string()))?;
    fs::write(&temporary, bytes).map_err(settings_io_error)?;
    fs::rename(&temporary, path).map_err(settings_io_error)
}

fn settings_io_error(error: std::io::Error) -> WorkspaceError {
    WorkspaceError::new(
        ErrorCode::Io,
        format!("toolchain設定を保存できませんでした: {error}"),
    )
}

#[tauri::command]
pub fn toolchain_status(manager: tauri::State<'_, ToolchainManager>) -> ToolchainStatus {
    manager.status()
}

#[tauri::command(rename_all = "camelCase")]
pub fn toolchain_set_mode(
    manager: tauri::State<'_, ToolchainManager>,
    request: SetToolchainModeRequest,
) -> WorkspaceResult<ToolchainStatus> {
    manager.set_mode(request.mode)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write_required_bundled_components(directory: &Path) {
        for required in [
            "bin/git",
            "bin/git-lfs",
            "bin/git-flow",
            "libexec/git-core/git-remote-https",
            "libexec/git-core/git-credential-osxkeychain",
        ] {
            let path = directory.join(required);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, b"component").unwrap();
        }
        fs::create_dir_all(directory.join("share/git-core/templates")).unwrap();
    }

    #[test]
    fn missing_setting_defaults_to_bundled() {
        let directory = TempDir::new().unwrap();
        assert_eq!(
            read_settings(&directory.path().join(SETTINGS_FILE)).toolchain_mode,
            ToolchainMode::Bundled
        );
    }

    #[test]
    fn selected_mode_is_saved_without_changing_active_mode() {
        let directory = TempDir::new().unwrap();
        let settings_path = directory.path().join(SETTINGS_FILE);
        write_settings(&settings_path, ToolchainMode::System).unwrap();
        assert_eq!(
            read_settings(&settings_path).toolchain_mode,
            ToolchainMode::System
        );
    }

    #[test]
    fn status_requires_restart_when_the_next_mode_differs_from_the_active_mode() {
        let component = ToolchainComponentStatus::missing(None, "not needed");
        let selected = ResolvedToolchain {
            mode: ToolchainMode::System,
            root: None,
            git: component.clone(),
            git_lfs: component.clone(),
            git_flow: component,
            gpg_available: false,
        };
        let status = selected.status(ToolchainMode::Bundled, ToolchainMode::System);
        assert!(status.restart_required);
        assert_eq!(status.active_mode, ToolchainMode::Bundled);
        assert_eq!(status.selected_mode, ToolchainMode::System);
    }

    #[test]
    fn search_path_keeps_each_tool_directory_once() {
        let joined = join_search_path(
            [
                PathBuf::from("/one"),
                PathBuf::from("/one"),
                PathBuf::from("/two"),
            ]
            .into_iter(),
        );
        let parts = std::env::split_paths(&joined).collect::<Vec<_>>();
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0], Path::new("/one"));
        assert_eq!(parts[1], Path::new("/two"));
    }

    #[test]
    fn component_probe_reports_a_missing_executable() {
        let status = ToolchainComponentStatus::probe(
            PathBuf::from("/definitely/missing/stella-git"),
            &["--version"],
        );
        assert!(!status.available);
        assert!(status.error.is_some());
    }

    #[test]
    fn missing_lfs_installs_a_required_failing_process_filter() {
        let unavailable = ToolchainComponentStatus::missing(None, "missing");
        let resolved = ResolvedToolchain {
            mode: ToolchainMode::System,
            root: None,
            git: ToolchainComponentStatus {
                available: true,
                path: Some("/usr/bin/git".into()),
                version: Some("git version test".into()),
                error: None,
            },
            git_lfs: unavailable.clone(),
            git_flow: unavailable,
            gpg_available: false,
        };
        let executor = resolved.executor();
        let directory = TempDir::new().unwrap();
        executor
            .run(
                None,
                crate::git::GitCommand::Init {
                    path: directory.path().to_path_buf(),
                    initial_branch: "main".into(),
                },
                None,
                None,
            )
            .unwrap()
            .ensure_success()
            .unwrap();
        fs::write(
            directory.path().join(".gitattributes"),
            "*.bin filter=lfs diff=lfs merge=lfs -text\n",
        )
        .unwrap();
        fs::write(directory.path().join("payload.bin"), b"payload").unwrap();
        let output = executor
            .run(
                Some(directory.path()),
                crate::git::GitCommand::Add {
                    paths: vec![".gitattributes".into(), "payload.bin".into()],
                },
                None,
                None,
            )
            .unwrap();
        assert!(!output.success());
    }

    #[test]
    fn bundled_manifest_mismatch_is_reported_before_component_probe() {
        let directory = TempDir::new().unwrap();
        fs::write(
            directory.path().join(".stella-toolchain.json"),
            br#"{"manifestSha256":"wrong","files":{}}"#,
        )
        .unwrap();
        let error = validate_bundled_root(directory.path()).unwrap_err();
        assert!(error.contains("lock manifest"));
    }

    #[test]
    fn bundled_component_checksum_mismatch_is_rejected() {
        let directory = TempDir::new().unwrap();
        write_required_bundled_components(directory.path());
        let marker = serde_json::json!({
            "manifestSha256": sha256_hex(include_bytes!("../../toolchain.lock.json")),
            "files": {
                "bin/git": "incorrect",
                "bin/git-lfs": sha256_hex(b"component"),
                "bin/git-flow": sha256_hex(b"component"),
                "libexec/git-core/git-remote-https": sha256_hex(b"component"),
                "libexec/git-core/git-credential-osxkeychain": sha256_hex(b"component")
            }
        });
        fs::write(
            directory.path().join(".stella-toolchain.json"),
            serde_json::to_vec(&marker).unwrap(),
        )
        .unwrap();
        let error = validate_bundled_root(directory.path()).unwrap_err();
        assert!(error.contains("checksum"));
        assert!(error.contains("bin/git"));
    }

    #[test]
    fn bundled_component_without_checksum_is_rejected() {
        let directory = TempDir::new().unwrap();
        write_required_bundled_components(directory.path());
        let marker = serde_json::json!({
            "manifestSha256": sha256_hex(include_bytes!("../../toolchain.lock.json")),
            "files": {}
        });
        fs::write(
            directory.path().join(".stella-toolchain.json"),
            serde_json::to_vec(&marker).unwrap(),
        )
        .unwrap();

        let error = validate_bundled_root(directory.path()).unwrap_err();
        assert!(error.contains("checksum"));
        assert!(error.contains("bin/git"));
    }
}
