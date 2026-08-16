use crate::git::GitExecutor;
use crate::model::{ErrorCode, WorkspaceError, WorkspaceResult};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::ffi::{OsStr, OsString};
use std::fs;
use std::io::Read;
use std::os::unix::ffi::OsStringExt;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

const SETTINGS_FILE: &str = "toolchain.json";
const EFFECTIVE_IGNORE_FILE: &str = "effective.gitignore";
const DEFAULT_IGNORE_PATTERNS: &str = ".DS_Store\n._*\nThumbs.db\n[Dd]esktop.ini";
const BUNDLED_DIRECTORY: &str = "toolchain";
const SEARCH_DIRECTORIES: [&str; 3] = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
const SYSTEM_FALLBACK_DIRECTORIES: [&str; 5] = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
];
const SHELL_PATH_TIMEOUT: Duration = Duration::from_secs(2);
const SHELL_OUTPUT_LIMIT: u64 = 64 * 1024;
const SHELL_PATH_START_MARKER: &[u8] = b"__STELLA_PATH_BEGIN_7CBAF26E__";
const SHELL_PATH_END_MARKER: &[u8] = b"__STELLA_PATH_END_7CBAF26E__";
const SHELL_PATH_COMMAND: &str = "/usr/bin/printf '%s' '__STELLA_PATH_BEGIN_7CBAF26E__'; /usr/bin/printenv PATH; /usr/bin/printf '%s' '__STELLA_PATH_END_7CBAF26E__'";

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
    pub ignore_patterns: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetToolchainModeRequest {
    pub mode: ToolchainMode,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetIgnorePatternsRequest {
    pub patterns: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct PersistedSettings {
    #[serde(default)]
    toolchain_mode: ToolchainMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    ignore_patterns: Option<String>,
}

impl PersistedSettings {
    fn ignore_patterns(&self) -> &str {
        self.ignore_patterns
            .as_deref()
            .unwrap_or(DEFAULT_IGNORE_PATTERNS)
    }
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
    fn environment(
        &self,
        active_system_path: Option<&OsStr>,
        effective_ignore_path: Option<&Path>,
    ) -> Vec<(OsString, OsString)> {
        let mut environment = Vec::<(OsString, OsString)>::new();
        let path = match &self.root {
            Some(root) => join_search_path(
                [
                    root.join("bin"),
                    PathBuf::from("/usr/bin"),
                    PathBuf::from("/bin"),
                    PathBuf::from("/usr/sbin"),
                    PathBuf::from("/sbin"),
                ]
                .into_iter(),
            ),
            None => active_system_path
                .map(OsStr::to_os_string)
                .unwrap_or_else(fixed_system_path),
        };
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
            // Git LFSのフィルターが未設定だと、Gitはポインターを通常ファイルとしてチェックアウトできてしまう。
            // 必須フィルターを失敗させ、接続時の診断をすり抜けたブランチ切り替えも安全に止める。
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
        let mut config_count = lfs_filter.len();
        if let Some(path) = effective_ignore_path {
            environment.push((
                format!("GIT_CONFIG_KEY_{config_count}").into(),
                "core.excludesFile".into(),
            ));
            environment.push((
                format!("GIT_CONFIG_VALUE_{config_count}").into(),
                path.as_os_str().to_owned(),
            ));
            config_count += 1;
        }
        environment.push(("GIT_CONFIG_COUNT".into(), config_count.to_string().into()));
        environment
    }

    fn executor(
        &self,
        active_system_path: Option<&OsStr>,
        effective_ignore_path: Option<&Path>,
    ) -> GitExecutor {
        let git_path = self
            .git
            .path_buf()
            .unwrap_or_else(|| PathBuf::from("/nonexistent/stella-git"));
        let environment = self.environment(active_system_path, effective_ignore_path);

        GitExecutor::configured(
            git_path,
            self.git_lfs.path_buf(),
            self.git_flow.path_buf(),
            environment,
            self.git.error.clone(),
        )
    }

    fn status(
        &self,
        active_mode: ToolchainMode,
        selected_mode: ToolchainMode,
        ignore_patterns: String,
    ) -> ToolchainStatus {
        ToolchainStatus {
            active_mode,
            selected_mode,
            restart_required: active_mode != selected_mode,
            git: self.git.clone(),
            git_lfs: self.git_lfs.clone(),
            git_flow: self.git_flow.clone(),
            gpg_available: self.gpg_available,
            ignore_patterns,
        }
    }
}

pub struct ToolchainManager {
    settings_path: PathBuf,
    effective_ignore_path: PathBuf,
    resource_directory: PathBuf,
    settings: Mutex<PersistedSettings>,
    active: ResolvedToolchain,
    active_system_path: Option<OsString>,
}

impl ToolchainManager {
    pub fn load(config_directory: PathBuf, resource_directory: PathBuf) -> WorkspaceResult<Self> {
        Self::load_with_system_path_resolver(
            config_directory,
            resource_directory,
            resolve_active_system_path,
        )
    }

    fn load_with_system_path_resolver(
        config_directory: PathBuf,
        resource_directory: PathBuf,
        system_path_resolver: impl FnOnce(&ResolvedToolchain) -> OsString,
    ) -> WorkspaceResult<Self> {
        let settings_path = config_directory.join(SETTINGS_FILE);
        let effective_ignore_path = config_directory.join(EFFECTIVE_IGNORE_FILE);
        let settings = read_settings(&settings_path);
        let selected_mode = settings.toolchain_mode;
        let (active, active_system_path) = match selected_mode {
            ToolchainMode::Bundled => (resolve_bundled(&resource_directory), None),
            ToolchainMode::System => {
                let active = resolve_system();
                let path = system_path_resolver(&active);
                (active, Some(path))
            }
        };
        let global_ignore_path =
            resolve_global_ignore_path(&active, active_system_path.as_deref())?;
        write_effective_ignore_file(
            &effective_ignore_path,
            global_ignore_path.as_deref(),
            settings.ignore_patterns(),
        )?;
        Ok(Self {
            settings_path,
            effective_ignore_path,
            resource_directory,
            settings: Mutex::new(settings),
            active,
            active_system_path,
        })
    }

    pub(crate) fn executor(&self) -> GitExecutor {
        self.active.executor(
            self.active_system_path.as_deref(),
            Some(&self.effective_ignore_path),
        )
    }

    pub fn status(&self) -> ToolchainStatus {
        let settings = self
            .settings
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        let selected_mode = settings.toolchain_mode;
        let ignore_patterns = settings.ignore_patterns().to_owned();
        if self.active.mode == selected_mode {
            return self
                .active
                .status(self.active.mode, selected_mode, ignore_patterns);
        }
        let selected = match selected_mode {
            ToolchainMode::Bundled => resolve_bundled(&self.resource_directory),
            ToolchainMode::System => resolve_system(),
        };
        selected.status(self.active.mode, selected_mode, ignore_patterns)
    }

    pub fn set_mode(&self, mode: ToolchainMode) -> WorkspaceResult<ToolchainStatus> {
        let candidate = match mode {
            ToolchainMode::Bundled => resolve_bundled(&self.resource_directory),
            ToolchainMode::System => resolve_system(),
        };
        if !candidate.git.available {
            return Err(WorkspaceError::new(
                ErrorCode::InvalidRequest,
                "選択したツールチェーンに利用可能なGitがありません。",
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
        let mut settings = self
            .settings
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut updated = settings.clone();
        updated.toolchain_mode = mode;
        write_settings(&self.settings_path, &updated)?;
        *settings = updated;
        drop(settings);
        Ok(self.status())
    }

    pub fn set_ignore_patterns(&self, patterns: String) -> WorkspaceResult<ToolchainStatus> {
        let global_ignore_path =
            resolve_global_ignore_path(&self.active, self.active_system_path.as_deref())?;
        let mut settings = self
            .settings
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let previous = settings.clone();
        let mut updated = previous.clone();
        updated.ignore_patterns = Some(patterns);
        write_settings(&self.settings_path, &updated)?;
        if let Err(error) = write_effective_ignore_file(
            &self.effective_ignore_path,
            global_ignore_path.as_deref(),
            updated.ignore_patterns(),
        ) {
            let _ = write_settings(&self.settings_path, &previous);
            return Err(error);
        }
        *settings = updated;
        drop(settings);
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
            .map_err(|error| format!("内蔵ツールチェーンのマーカーを読めません: {error}"))?,
    )
    .map_err(|error| format!("内蔵ツールチェーンのマーカーが不正です: {error}"))?;
    let expected_manifest = sha256_hex(include_bytes!("../../../toolchain.lock.json"));
    if marker.manifest_sha256 != expected_manifest {
        return Err("内蔵ツールチェーンのロックマニフェストがアプリと一致しません。".into());
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
            return Err(format!(
                "内蔵ツールチェーンの構成要素がありません: {required}"
            ));
        }
    }
    for required in required_files {
        if !marker.files.contains_key(required) {
            return Err(format!(
                "内蔵ツールチェーンのチェックサムが記録されていません: {required}"
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
                "内蔵ツールチェーンのチェックサムが一致しません: {relative_path}"
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
        format!("{name}の実行ファイルが標準の検索先に見つかりません。"),
    )
}

fn resolve_active_system_path(resolved: &ResolvedToolchain) -> OsString {
    let shell = configured_login_shell();
    resolve_system_path_for_shell(resolved, &shell, SHELL_PATH_TIMEOUT)
}

fn resolve_system_path_for_shell(
    resolved: &ResolvedToolchain,
    shell: &Path,
    timeout: Duration,
) -> OsString {
    resolve_login_shell_path(shell, timeout)
        .and_then(|shell_path| system_path_with_shell(resolved, &shell_path))
        .unwrap_or_else(fixed_system_path)
}

fn configured_login_shell() -> PathBuf {
    let configured = std::env::var_os("SHELL");
    select_login_shell(configured.as_deref())
}

fn select_login_shell(configured: Option<&OsStr>) -> PathBuf {
    configured
        .map(PathBuf::from)
        .filter(|path| path.is_absolute() && is_executable_file(path))
        .unwrap_or_else(|| PathBuf::from("/bin/zsh"))
}

fn is_executable_file(path: &Path) -> bool {
    fs::metadata(path)
        .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
}

fn resolve_login_shell_path(shell: &Path, timeout: Duration) -> Option<OsString> {
    if !shell.is_absolute() || !is_executable_file(shell) {
        return None;
    }
    let mut child = Command::new(shell)
        .args(["-l", "-i", "-c", SHELL_PATH_COMMAND])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .ok()?;
    let Some(stdout) = child.stdout.take() else {
        terminate_process_group(&mut child);
        return None;
    };
    let reader = thread::spawn(move || {
        let mut output = Vec::new();
        stdout
            .take(SHELL_OUTPUT_LIMIT)
            .read_to_end(&mut output)
            .ok()
            .map(|_| output)
    });
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                terminate_remaining_process_group(&child);
                break Some(status);
            }
            Ok(None) if started.elapsed() < timeout => thread::sleep(Duration::from_millis(10)),
            Ok(None) | Err(_) => {
                terminate_process_group(&mut child);
                break None;
            }
        }
    };
    let output = reader.join().ok().flatten()?;
    status
        .filter(|status| status.success())
        .and_then(|_| parse_shell_path_output(&output))
}

fn parse_shell_path_output(output: &[u8]) -> Option<OsString> {
    let start = find_bytes(output, SHELL_PATH_START_MARKER)? + SHELL_PATH_START_MARKER.len();
    let end = find_bytes(&output[start..], SHELL_PATH_END_MARKER)? + start;
    let path = output[start..end]
        .strip_suffix(b"\r\n")
        .or_else(|| output[start..end].strip_suffix(b"\n"))
        .or_else(|| output[start..end].strip_suffix(b"\r"))
        .unwrap_or(&output[start..end]);
    (!path.is_empty()).then(|| OsString::from_vec(path.to_vec()))
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn terminate_remaining_process_group(child: &std::process::Child) {
    let group = format!("-{}", child.id());
    let _ = Command::new("/bin/kill")
        .args(["-KILL", group.as_str()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

fn terminate_process_group(child: &mut std::process::Child) {
    let group = format!("-{}", child.id());
    let _ = Command::new("/bin/kill")
        .args(["-TERM", group.as_str()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    for _ in 0..10 {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => thread::sleep(Duration::from_millis(10)),
            Err(_) => break,
        }
    }
    terminate_remaining_process_group(child);
    let _ = child.kill();
    let _ = child.wait();
}

fn system_path_with_shell(resolved: &ResolvedToolchain, shell_path: &OsStr) -> Option<OsString> {
    let component_directories = [&resolved.git, &resolved.git_lfs, &resolved.git_flow]
        .into_iter()
        .filter_map(ToolchainComponentStatus::path_buf)
        .filter_map(|path| path.parent().map(Path::to_path_buf));
    let shell_directories = std::env::split_paths(shell_path)
        .filter(|path| path.is_absolute() && path.is_dir())
        .collect::<Vec<_>>();
    if shell_directories.is_empty() {
        return None;
    }
    let standard_directories = SYSTEM_FALLBACK_DIRECTORIES.into_iter().map(PathBuf::from);
    Some(join_search_path(
        component_directories
            .chain(shell_directories)
            .chain(standard_directories),
    ))
}

fn fixed_system_path() -> OsString {
    join_search_path(SYSTEM_FALLBACK_DIRECTORIES.into_iter().map(PathBuf::from))
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

fn write_settings(path: &Path, settings: &PersistedSettings) -> WorkspaceResult<()> {
    let parent = path.parent().ok_or_else(|| {
        WorkspaceError::new(
            ErrorCode::Internal,
            "ツールチェーン設定の保存先を解決できません。",
        )
    })?;
    fs::create_dir_all(parent).map_err(settings_io_error)?;
    let temporary = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(settings)
        .map_err(|error| WorkspaceError::new(ErrorCode::Internal, error.to_string()))?;
    fs::write(&temporary, bytes).map_err(settings_io_error)?;
    fs::rename(&temporary, path).map_err(settings_io_error)
}

fn resolve_global_ignore_path(
    toolchain: &ResolvedToolchain,
    active_system_path: Option<&OsStr>,
) -> WorkspaceResult<Option<PathBuf>> {
    if let Some(git_path) = toolchain.git.path_buf() {
        for scope in ["--global", "--system"] {
            let output = Command::new(&git_path)
                .args(["config", scope, "--path", "--get", "core.excludesFile"])
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .env("LC_ALL", "C")
                .env("LANG", "C")
                .envs(toolchain.environment(active_system_path, None))
                .output()
                .map_err(ignore_io_error)?;
            if output.status.success() {
                let mut path = output.stdout;
                while path
                    .last()
                    .is_some_and(|byte| matches!(byte, b'\n' | b'\r'))
                {
                    path.pop();
                }
                return Ok((!path.is_empty()).then(|| PathBuf::from(OsString::from_vec(path))));
            }
            if output.status.code() != Some(1) {
                return Err(WorkspaceError::new(
                    ErrorCode::Io,
                    format!(
                        "Git共通無視設定を確認できませんでした: {}",
                        String::from_utf8_lossy(&output.stderr).trim()
                    ),
                ));
            }
        }
    }
    Ok(default_global_ignore_path())
}

fn default_global_ignore_path() -> Option<PathBuf> {
    std::env::var_os("XDG_CONFIG_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
        .map(|directory| directory.join("git/ignore"))
}

fn effective_ignore_contents(
    global_ignore_path: Option<&Path>,
    ignore_patterns: &str,
) -> WorkspaceResult<Vec<u8>> {
    let mut contents = match global_ignore_path.map(fs::read).transpose() {
        Ok(Some(contents)) => contents,
        Ok(None) => Vec::new(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(error) => return Err(ignore_io_error(error)),
    };
    if !contents.is_empty() && !ignore_patterns.is_empty() && !contents.ends_with(b"\n") {
        contents.push(b'\n');
    }
    contents.extend_from_slice(ignore_patterns.as_bytes());
    Ok(contents)
}

fn write_effective_ignore_file(
    path: &Path,
    global_ignore_path: Option<&Path>,
    ignore_patterns: &str,
) -> WorkspaceResult<()> {
    let parent = path.parent().ok_or_else(|| {
        WorkspaceError::new(
            ErrorCode::Internal,
            "有効な無視リストのパスを解決できません。",
        )
    })?;
    fs::create_dir_all(parent).map_err(ignore_io_error)?;
    let contents = effective_ignore_contents(global_ignore_path, ignore_patterns)?;
    let temporary = path.with_extension("gitignore.tmp");
    fs::write(&temporary, contents).map_err(ignore_io_error)?;
    fs::rename(&temporary, path).map_err(ignore_io_error)
}

fn settings_io_error(error: std::io::Error) -> WorkspaceError {
    WorkspaceError::new(
        ErrorCode::Io,
        format!("ツールチェーン設定を保存できませんでした: {error}"),
    )
}

fn ignore_io_error(error: std::io::Error) -> WorkspaceError {
    WorkspaceError::new(
        ErrorCode::Io,
        format!("グローバル無視リストを処理できませんでした: {error}"),
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

#[tauri::command(rename_all = "camelCase")]
pub fn toolchain_set_ignore_patterns(
    manager: tauri::State<'_, ToolchainManager>,
    request: SetIgnorePatternsRequest,
) -> WorkspaceResult<ToolchainStatus> {
    manager.set_ignore_patterns(request.patterns)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use tempfile::TempDir;

    fn write_executable(path: &Path, contents: impl AsRef<[u8]>) {
        fs::write(path, contents).unwrap();
        let mut permissions = fs::metadata(path).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).unwrap();
    }

    fn available_component(path: &Path) -> ToolchainComponentStatus {
        ToolchainComponentStatus {
            available: true,
            path: Some(path.display().to_string()),
            version: Some("test version".into()),
            error: None,
        }
    }

    fn system_toolchain(git_path: &Path) -> ResolvedToolchain {
        let unavailable = ToolchainComponentStatus::missing(None, "missing");
        ResolvedToolchain {
            mode: ToolchainMode::System,
            root: None,
            git: available_component(git_path),
            git_lfs: unavailable.clone(),
            git_flow: unavailable,
            gpg_available: false,
        }
    }

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
        let settings = read_settings(&directory.path().join(SETTINGS_FILE));
        assert_eq!(settings.toolchain_mode, ToolchainMode::Bundled);
        assert_eq!(settings.ignore_patterns(), DEFAULT_IGNORE_PATTERNS);
    }

    #[test]
    fn saved_empty_ignore_patterns_are_not_replaced_with_defaults() {
        let directory = TempDir::new().unwrap();
        let path = directory.path().join(SETTINGS_FILE);
        let settings = PersistedSettings {
            ignore_patterns: Some(String::new()),
            ..PersistedSettings::default()
        };
        write_settings(&path, &settings).unwrap();

        assert_eq!(read_settings(&path).ignore_patterns(), "");
    }

    #[test]
    fn selected_mode_is_saved_without_changing_active_mode() {
        let directory = TempDir::new().unwrap();
        let settings_path = directory.path().join(SETTINGS_FILE);
        write_settings(
            &settings_path,
            &PersistedSettings {
                toolchain_mode: ToolchainMode::System,
                ..PersistedSettings::default()
            },
        )
        .unwrap();
        assert_eq!(
            read_settings(&settings_path).toolchain_mode,
            ToolchainMode::System
        );
    }

    #[test]
    fn persisted_settings_keep_mode_and_ignore_patterns_together() {
        let directory = TempDir::new().unwrap();
        let path = directory.path().join(SETTINGS_FILE);
        let settings = PersistedSettings {
            toolchain_mode: ToolchainMode::System,
            ignore_patterns: Some("custom.tmp\n!keep.tmp".into()),
        };
        write_settings(&path, &settings).unwrap();

        assert_eq!(read_settings(&path), settings);
    }

    #[test]
    fn manager_updates_keep_mode_and_ignore_patterns_together() {
        let directory = TempDir::new().unwrap();
        let settings_path = directory.path().join(SETTINGS_FILE);
        let effective_ignore_path = directory.path().join(EFFECTIVE_IGNORE_FILE);
        let missing_global_ignore = directory.path().join("missing-global-ignore");
        let git = directory.path().join("git");
        write_executable(
            &git,
            format!(
                "#!/bin/sh\nprintf '%s\\n' '{}'\n",
                missing_global_ignore.display()
            ),
        );
        let persisted = PersistedSettings {
            toolchain_mode: ToolchainMode::System,
            ignore_patterns: None,
        };
        write_settings(&settings_path, &persisted).unwrap();
        let manager = ToolchainManager {
            settings_path: settings_path.clone(),
            effective_ignore_path,
            resource_directory: directory.path().join("resources"),
            settings: Mutex::new(persisted),
            active: system_toolchain(&git),
            active_system_path: Some(fixed_system_path()),
        };

        manager.set_ignore_patterns("custom.tmp".into()).unwrap();
        assert_eq!(
            read_settings(&settings_path),
            PersistedSettings {
                toolchain_mode: ToolchainMode::System,
                ignore_patterns: Some("custom.tmp".into()),
            }
        );
        manager.set_mode(ToolchainMode::System).unwrap();
        assert_eq!(
            read_settings(&settings_path).ignore_patterns(),
            "custom.tmp"
        );
    }

    #[test]
    fn effective_ignore_joins_global_and_stella_patterns_without_normalizing_them() {
        let directory = TempDir::new().unwrap();
        let global = directory.path().join("global-ignore");
        fs::write(&global, b"# global\nglobal-only.tmp").unwrap();

        let contents =
            effective_ignore_contents(Some(&global), "# stella\n!keep.tmp\nstella-only.tmp\n")
                .unwrap();

        assert_eq!(
            contents,
            b"# global\nglobal-only.tmp\n# stella\n!keep.tmp\nstella-only.tmp\n"
        );
        assert_eq!(
            effective_ignore_contents(Some(&global), "").unwrap(),
            b"# global\nglobal-only.tmp"
        );
    }

    #[test]
    fn global_ignore_resolution_uses_only_global_and_system_scopes() {
        let directory = TempDir::new().unwrap();
        let git = directory.path().join("git");
        let system_ignore = directory.path().join("system-ignore");
        write_executable(
            &git,
            format!(
                "#!/bin/sh\ncase \"$2\" in\n  --global) exit 1 ;;\n  --system) printf '%s\\n' '{}' ;;\n  *) printf '%s\\n' '/repo-local-ignore' ;;\nesac\n",
                system_ignore.display()
            ),
        );

        assert_eq!(
            resolve_global_ignore_path(&system_toolchain(&git), None).unwrap(),
            Some(system_ignore)
        );
    }

    #[test]
    fn configured_empty_global_ignore_disables_the_xdg_fallback() {
        let directory = TempDir::new().unwrap();
        let git = directory.path().join("git");
        write_executable(
            &git,
            "#!/bin/sh\ncase \"$2\" in\n  --global) printf '\\n' ;;\n  --system) printf '%s\\n' '/system-ignore' ;;\nesac\n",
        );

        assert_eq!(
            resolve_global_ignore_path(&system_toolchain(&git), None).unwrap(),
            None
        );
    }

    #[test]
    fn failed_effective_ignore_write_keeps_the_previous_file() {
        let directory = TempDir::new().unwrap();
        let path = directory.path().join(EFFECTIVE_IGNORE_FILE);
        fs::write(&path, b"previous\n").unwrap();
        fs::create_dir(path.with_extension("gitignore.tmp")).unwrap();

        assert!(write_effective_ignore_file(&path, None, "replacement").is_err());
        assert_eq!(fs::read(&path).unwrap(), b"previous\n");
    }

    #[test]
    fn effective_ignore_applies_only_to_the_configured_executor() {
        let directory = TempDir::new().unwrap();
        let repo = directory.path().join("repo");
        let effective = directory.path().join(EFFECTIVE_IGNORE_FILE);
        fs::write(&effective, b"global-only.tmp\nstella-only.tmp\n").unwrap();
        let resolved = system_toolchain(Path::new("/usr/bin/git"));
        let executor = resolved.executor(None, Some(&effective));
        executor
            .run(
                None,
                crate::git::GitCommand::Init {
                    path: repo.clone(),
                    initial_branch: "main".into(),
                },
                None,
                None,
            )
            .unwrap()
            .ensure_success()
            .unwrap();
        fs::write(repo.join(".gitignore"), b"repository-only.tmp\n").unwrap();
        fs::write(repo.join(".git/info/exclude"), b"info-only.tmp\n").unwrap();
        for path in [
            "global-only.tmp",
            "stella-only.tmp",
            "repository-only.tmp",
            "info-only.tmp",
        ] {
            fs::write(repo.join(path), b"content\n").unwrap();
        }

        let stella_status = executor
            .run(Some(&repo), crate::git::GitCommand::Status, None, None)
            .unwrap()
            .ensure_success()
            .unwrap()
            .stdout_text();
        for ignored in [
            "global-only.tmp",
            "stella-only.tmp",
            "repository-only.tmp",
            "info-only.tmp",
        ] {
            assert!(!stella_status.contains(ignored));
        }

        let plain_status = Command::new("/usr/bin/git")
            .args(["status", "--porcelain", "--untracked-files=all"])
            .current_dir(&repo)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .output()
            .unwrap();
        assert!(plain_status.status.success());
        let plain_status = String::from_utf8_lossy(&plain_status.stdout);
        assert!(plain_status.contains("global-only.tmp"));
        assert!(plain_status.contains("stella-only.tmp"));

        executor
            .run(Some(&repo), crate::git::GitCommand::AddAll, None, None)
            .unwrap()
            .ensure_success()
            .unwrap();
        let staged = Command::new("/usr/bin/git")
            .args(["diff", "--cached", "--name-only"])
            .current_dir(&repo)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .output()
            .unwrap();
        assert!(staged.status.success());
        let staged = String::from_utf8_lossy(&staged.stdout);
        assert!(!staged.contains("global-only.tmp"));
        assert!(!staged.contains("stella-only.tmp"));

        let forced = Command::new("/usr/bin/git")
            .args(["add", "--force", "--", "stella-only.tmp"])
            .current_dir(&repo)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .status()
            .unwrap();
        assert!(forced.success());
        fs::write(repo.join("stella-only.tmp"), b"updated\n").unwrap();
        let tracked_status = executor
            .run(Some(&repo), crate::git::GitCommand::Status, None, None)
            .unwrap()
            .ensure_success()
            .unwrap()
            .stdout_text();
        assert!(tracked_status.contains("stella-only.tmp"));
    }

    #[test]
    fn existing_executor_observes_saved_ignore_patterns() {
        let directory = TempDir::new().unwrap();
        let git = directory.path().join("git");
        write_executable(
            &git,
            "#!/bin/sh\nif [ \"$1\" = config ]; then printf '\\n'; exit 0; fi\nexec /usr/bin/git \"$@\"\n",
        );
        let settings_path = directory.path().join(SETTINGS_FILE);
        let effective_ignore_path = directory.path().join(EFFECTIVE_IGNORE_FILE);
        let settings = PersistedSettings {
            toolchain_mode: ToolchainMode::System,
            ignore_patterns: Some(String::new()),
        };
        write_settings(&settings_path, &settings).unwrap();
        write_effective_ignore_file(&effective_ignore_path, None, "").unwrap();
        let manager = ToolchainManager {
            settings_path,
            effective_ignore_path,
            resource_directory: directory.path().join("resources"),
            settings: Mutex::new(settings),
            active: system_toolchain(&git),
            active_system_path: Some(fixed_system_path()),
        };
        let executor = manager.executor();
        let repo = directory.path().join("repo");
        executor
            .run(
                None,
                crate::git::GitCommand::Init {
                    path: repo.clone(),
                    initial_branch: "main".into(),
                },
                None,
                None,
            )
            .unwrap()
            .ensure_success()
            .unwrap();
        fs::write(repo.join("saved.ignore"), b"content\n").unwrap();
        assert!(
            executor
                .run(Some(&repo), crate::git::GitCommand::Status, None, None)
                .unwrap()
                .ensure_success()
                .unwrap()
                .stdout_text()
                .contains("saved.ignore")
        );

        manager.set_ignore_patterns("saved.ignore".into()).unwrap();

        assert!(
            !executor
                .run(Some(&repo), crate::git::GitCommand::Status, None, None)
                .unwrap()
                .ensure_success()
                .unwrap()
                .stdout_text()
                .contains("saved.ignore")
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
        let status = selected.status(
            ToolchainMode::Bundled,
            ToolchainMode::System,
            DEFAULT_IGNORE_PATTERNS.into(),
        );
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
    fn shell_path_is_extracted_between_markers_despite_startup_output() {
        let mut output = b"startup output\n".to_vec();
        output.extend_from_slice(SHELL_PATH_START_MARKER);
        output.extend_from_slice(b"/custom/bin:/usr/bin\r\n");
        output.extend_from_slice(SHELL_PATH_END_MARKER);
        output.extend_from_slice(b"\nafter output\n");

        assert_eq!(
            parse_shell_path_output(&output),
            Some(OsString::from("/custom/bin:/usr/bin"))
        );
        assert!(parse_shell_path_output(b"startup output only").is_none());
    }

    #[test]
    fn system_path_prioritizes_components_then_normalized_shell_directories() {
        let directory = TempDir::new().unwrap();
        let git_directory = directory.path().join("selected-git");
        let shell_directory = directory.path().join("shell-bin");
        fs::create_dir_all(&git_directory).unwrap();
        fs::create_dir_all(&shell_directory).unwrap();
        let resolved = system_toolchain(&git_directory.join("git"));
        let shell_path = OsString::from(format!(
            ":relative:{}:{}:{}",
            shell_directory.display(),
            git_directory.display(),
            shell_directory.display()
        ));

        let path = system_path_with_shell(&resolved, &shell_path).unwrap();
        let parts = std::env::split_paths(&path).collect::<Vec<_>>();
        assert_eq!(parts[0], git_directory);
        assert_eq!(parts[1], shell_directory);
        assert_eq!(parts.iter().filter(|path| *path == &parts[0]).count(), 1);
        assert!(parts.iter().all(|path| path.is_absolute()));
        assert!(parts.contains(&PathBuf::from("/usr/bin")));
    }

    #[test]
    fn login_shell_path_resolution_uses_markers_and_login_interactive_flags() {
        let directory = TempDir::new().unwrap();
        let expected = directory.path().join("shell-bin");
        fs::create_dir_all(&expected).unwrap();
        let shell = directory.path().join("fake-shell");
        write_executable(
            &shell,
            format!(
                "#!/bin/sh\n[ \"$1\" = -l ] || exit 10\n[ \"$2\" = -i ] || exit 11\n[ \"$3\" = -c ] || exit 12\nprintf 'startup output\\n'\nPATH='{}:/usr/bin:/bin'\nexport PATH\nexec /bin/sh -c \"$4\"\n",
                expected.display()
            ),
        );

        let path = resolve_login_shell_path(&shell, Duration::from_secs(5)).unwrap();
        assert_eq!(
            std::env::split_paths(&path).next().as_deref(),
            Some(expected.as_path())
        );
    }

    #[test]
    fn login_shell_selection_requires_an_absolute_executable() {
        let directory = TempDir::new().unwrap();
        let executable = directory.path().join("shell");
        let non_executable = directory.path().join("not-executable");
        write_executable(&executable, "#!/bin/sh\n");
        fs::write(&non_executable, "#!/bin/sh\n").unwrap();

        assert_eq!(select_login_shell(Some(executable.as_os_str())), executable);
        assert_eq!(
            select_login_shell(Some(non_executable.as_os_str())),
            Path::new("/bin/zsh")
        );
        assert_eq!(
            select_login_shell(Some(OsStr::new("relative-shell"))),
            Path::new("/bin/zsh")
        );
        assert_eq!(select_login_shell(None), Path::new("/bin/zsh"));
    }

    #[test]
    fn failed_shell_path_resolution_uses_the_fixed_system_path() {
        let directory = TempDir::new().unwrap();
        let shell = directory.path().join("fake-shell");
        write_executable(
            &shell,
            "#!/bin/sh\nPATH='relative'\nexport PATH\nexec /bin/sh -c \"$4\"\n",
        );
        let resolved = system_toolchain(Path::new("/usr/bin/git"));

        assert_eq!(
            resolve_system_path_for_shell(&resolved, &shell, Duration::from_secs(1)),
            fixed_system_path()
        );

        write_executable(&shell, "#!/bin/sh\nexit 1\n");
        assert_eq!(
            resolve_system_path_for_shell(&resolved, &shell, Duration::from_secs(1)),
            fixed_system_path()
        );
    }

    #[test]
    fn shell_path_timeout_terminates_its_process_group() {
        let directory = TempDir::new().unwrap();
        let child_pid = directory.path().join("child.pid");
        let shell = directory.path().join("fake-shell");
        write_executable(
            &shell,
            format!(
                "#!/bin/sh\n/bin/sleep 30 &\nprintf '%s' \"$!\" > '{}'\nwait\n",
                child_pid.display()
            ),
        );

        // 製品用の2秒では全テスト実行時に子プロセスの起動前に達してフレーキーになるため、
        // ここではプロセスグループの終了だけを検証できるよう、テスト専用の猶予を設ける。
        assert!(resolve_login_shell_path(&shell, Duration::from_secs(10)).is_none());
        assert!(child_pid.is_file());
        let pid = fs::read_to_string(child_pid).unwrap();
        let mut alive = true;
        for _ in 0..100 {
            alive = Command::new("/bin/kill")
                .args(["-0", pid.trim()])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .is_ok_and(|status| status.success());
            if !alive {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        assert!(!alive, "login shell child survived timeout");
    }

    #[test]
    fn bundled_mode_does_not_resolve_the_login_shell_path() {
        let directory = TempDir::new().unwrap();
        ToolchainManager::load_with_system_path_resolver(
            directory.path().join("config"),
            directory.path().join("resources"),
            |_| panic!("System PATH resolver must not run in bundled mode"),
        )
        .unwrap();
    }

    #[test]
    fn system_mode_resolves_its_path_once_during_load() {
        let directory = TempDir::new().unwrap();
        let config = directory.path().join("config");
        let settings = config.join(SETTINGS_FILE);
        write_settings(
            &settings,
            &PersistedSettings {
                toolchain_mode: ToolchainMode::System,
                ..PersistedSettings::default()
            },
        )
        .unwrap();
        let calls = Cell::new(0);
        let manager = ToolchainManager::load_with_system_path_resolver(
            config,
            directory.path().join("resources"),
            |_| {
                calls.set(calls.get() + 1);
                fixed_system_path()
            },
        )
        .unwrap();
        let _ = manager.executor();
        let _ = manager.executor();

        assert_eq!(calls.get(), 1);
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
        let executor = resolved.executor(None, None);
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
    fn git_hook_can_resolve_a_command_from_the_login_shell_path() {
        let directory = TempDir::new().unwrap();
        let bin = directory.path().join("shell-bin");
        fs::create_dir_all(&bin).unwrap();
        write_executable(
            &bin.join("stella-hook-tool"),
            "#!/bin/sh\nprintf 'hook reached shell PATH\\n'\n",
        );
        let shell = directory.path().join("fake-shell");
        write_executable(
            &shell,
            format!(
                "#!/bin/sh\nprintf 'startup output\\n'\nPATH='{}:/usr/bin:/bin'\nexport PATH\nexec /bin/sh -c \"$4\"\n",
                bin.display()
            ),
        );
        let resolved = system_toolchain(Path::new("/usr/bin/git"));
        let active_path = resolve_system_path_for_shell(&resolved, &shell, Duration::from_secs(5));
        let executor = resolved.executor(Some(&active_path), None);
        let repo = directory.path().join("repo");
        executor
            .run(
                None,
                crate::git::GitCommand::Init {
                    path: repo.clone(),
                    initial_branch: "main".into(),
                },
                None,
                None,
            )
            .unwrap()
            .ensure_success()
            .unwrap();
        for (key, value) in [
            ("user.name", "Stella Test"),
            ("user.email", "test@localhost"),
        ] {
            assert!(
                Command::new("/usr/bin/git")
                    .args(["config", key, value])
                    .current_dir(&repo)
                    .status()
                    .unwrap()
                    .success()
            );
        }
        let hook = repo.join(".git/hooks/commit-msg");
        write_executable(
            &hook,
            "#!/bin/sh\nstella-hook-tool > hook-path-result.txt\n",
        );
        fs::write(repo.join("file.txt"), "content\n").unwrap();
        executor
            .run(
                Some(&repo),
                crate::git::GitCommand::Add {
                    paths: vec!["file.txt".into()],
                },
                None,
                None,
            )
            .unwrap()
            .ensure_success()
            .unwrap();
        let message = directory.path().join("message.txt");
        fs::write(&message, "test: shell path\n").unwrap();
        executor
            .run(
                Some(&repo),
                crate::git::GitCommand::Commit {
                    message_file: message,
                },
                None,
                None,
            )
            .unwrap()
            .ensure_success()
            .unwrap();

        assert_eq!(
            fs::read_to_string(repo.join("hook-path-result.txt")).unwrap(),
            "hook reached shell PATH\n"
        );
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
        assert!(error.contains("ロックマニフェスト"));
    }

    #[test]
    fn bundled_component_checksum_mismatch_is_rejected() {
        let directory = TempDir::new().unwrap();
        write_required_bundled_components(directory.path());
        let marker = serde_json::json!({
            "manifestSha256": sha256_hex(include_bytes!("../../../toolchain.lock.json")),
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
        assert!(error.contains("チェックサム"));
        assert!(error.contains("bin/git"));
    }

    #[test]
    fn bundled_component_without_checksum_is_rejected() {
        let directory = TempDir::new().unwrap();
        write_required_bundled_components(directory.path());
        let marker = serde_json::json!({
            "manifestSha256": sha256_hex(include_bytes!("../../../toolchain.lock.json")),
            "files": {}
        });
        fs::write(
            directory.path().join(".stella-toolchain.json"),
            serde_json::to_vec(&marker).unwrap(),
        )
        .unwrap();

        let error = validate_bundled_root(directory.path()).unwrap_err();
        assert!(error.contains("チェックサム"));
        assert!(error.contains("bin/git"));
    }
}
