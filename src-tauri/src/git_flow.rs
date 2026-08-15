use crate::git::{GitCommand, GitExecutor, GitOutput, RunControl};
use crate::model::{
    ErrorCode, GitFlowCommand, GitFlowOverview, GitFlowPreset, GitFlowRequest, GitFlowStrategy,
    RepoGeneration, WorkspaceError, WorkspaceResult,
};
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub(crate) fn overview(
    git: &GitExecutor,
    root: &Path,
    repo_generation: RepoGeneration,
) -> WorkspaceResult<GitFlowOverview> {
    if !git.has_flow() {
        return Ok(GitFlowOverview {
            initialized: false,
            available: false,
            raw: serde_json::Value::Null,
            output: "Git Flow is not available in the selected toolchain".into(),
            repo_generation,
        });
    }
    let mut output = git.run_flow(
        root,
        strings(["overview", "--format=json", "--no-color"]),
        None,
        true,
    )?;
    if !output.success()
        && output
            .stderr_text()
            .to_ascii_lowercase()
            .contains("unknown flag")
    {
        // git-flow-next 1.2.0にはJSON出力用のフラグがないため、同じ概要をプレーンテキストで取得する。
        output = git.run_flow(root, strings(["overview"]), None, true)?;
    }
    let text = output.stdout_text().trim().to_owned();
    if output.success() {
        let raw = serde_json::from_str(&text).unwrap_or_else(|_| plain_overview(&text));
        return Ok(GitFlowOverview {
            initialized: true,
            available: true,
            raw,
            output: text,
            repo_generation,
        });
    }
    let stderr = output.stderr_text().trim().to_owned();
    let uninitialized = stderr.to_ascii_lowercase().contains("not initialized")
        || stderr.to_ascii_lowercase().contains("initialize")
        || stderr.to_ascii_lowercase().contains("configuration");
    if uninitialized {
        return Ok(GitFlowOverview {
            initialized: false,
            available: true,
            raw: serde_json::Value::Null,
            output: stderr,
            repo_generation,
        });
    }
    Err(output
        .ensure_success()
        .expect_err("failed Git Flow overview"))
}

pub(crate) fn execute(
    git: &GitExecutor,
    root: &Path,
    request: &GitFlowRequest,
    control: Option<&RunControl>,
) -> WorkspaceResult<GitOutput> {
    validate(request)?;
    if !git.has_flow() {
        return Err(WorkspaceError::new(
            ErrorCode::UnsupportedRepository,
            "Git Flow is not available in the selected toolchain",
        ));
    }
    if request.command == GitFlowCommand::ConfigStatus {
        return config_status(git, root, control);
    }
    if request.command == GitFlowCommand::ConfigSync {
        return sync_shared_to_local(git, root, control);
    }
    if request.uploads_lfs_objects() && git.has_lfs() {
        let reference = lfs_reference(git, root, request, control)?;
        git.run_lfs(
            root,
            vec!["push".into(), "origin".into(), reference.into()],
            control,
        )?
        .ensure_success()?;
    }
    let output = git
        .run_flow(root, build_args(request)?, control, false)?
        .ensure_success()?;
    if request.shared && writes_configuration(request.command) {
        sync_local_to_shared(git, root, control)?;
    }
    Ok(output)
}

fn lfs_reference(
    git: &GitExecutor,
    root: &Path,
    request: &GitFlowRequest,
    control: Option<&RunControl>,
) -> WorkspaceResult<String> {
    let Some(branch) = topic_branch_name(git, root, request, control)? else {
        return Ok("HEAD".into());
    };
    Ok(format!("refs/heads/{branch}"))
}

pub(crate) fn topic_branch_name(
    git: &GitExecutor,
    root: &Path,
    request: &GitFlowRequest,
    control: Option<&RunControl>,
) -> WorkspaceResult<Option<String>> {
    let (Some(topic_type), Some(name)) = (&request.topic_type, &request.name) else {
        return Ok(None);
    };
    let (entries, _) = read_config(git, root, None, control)?;
    let prefix_key = format!("gitflow.branch.{topic_type}.prefix");
    let prefix = entries
        .iter()
        .find_map(|(key, value)| (key == &prefix_key).then_some(value))
        .ok_or_else(|| {
            invalid(format!(
                "Git Flow prefix is not configured for {topic_type}"
            ))
        })?;
    Ok(Some(format!("{prefix}{name}")))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingOperation {
    action: String,
    branch_type: String,
    branch_name: String,
    full_branch_name: String,
}

fn pending_state(git_dir: &Path) -> Option<PendingOperation> {
    let bytes = fs::read(git_dir.join("gitflow/state/merge.json")).ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub(crate) fn pending_operation(git_dir: &Path) -> Option<&'static str> {
    match pending_state(git_dir)?.action.as_str() {
        "finish" => Some("finish"),
        "update" => Some("update"),
        "integrate" => Some("integrate"),
        _ => None,
    }
}

pub(crate) fn recover(
    git: &GitExecutor,
    root: &Path,
    git_dir: &Path,
    command: GitFlowCommand,
    control: Option<&RunControl>,
) -> WorkspaceResult<Option<GitOutput>> {
    if !matches!(command, GitFlowCommand::Continue | GitFlowCommand::Abort) {
        return Err(invalid("recovery command must be continue or abort"));
    }
    let Some(state) = pending_state(git_dir) else {
        return Ok(None);
    };
    if !matches!(state.action.as_str(), "finish" | "update" | "integrate") {
        return Ok(None);
    }
    let flag = match command {
        GitFlowCommand::Continue => "--continue",
        GitFlowCommand::Abort => "--abort",
        _ => unreachable!("recovery command was validated"),
    };
    let is_topic = state
        .full_branch_name
        .strip_prefix(&state.branch_type)
        .is_some_and(|suffix| suffix.starts_with('/'));
    let is_integrate = state.action == "integrate";
    let mut args = Vec::new();
    if is_topic {
        args.push(state.branch_type.into());
    }
    args.push(state.action.into());
    args.push(flag.into());
    if !is_integrate && !state.branch_name.is_empty() {
        args.push(state.branch_name.into());
    }
    git.run_flow(root, args, control, false)?
        .ensure_success()
        .map(Some)
}

#[cfg(test)]
fn empty_request(command: GitFlowCommand) -> GitFlowRequest {
    GitFlowRequest {
        command,
        topic_type: None,
        name: None,
        secondary_name: None,
        parent: None,
        base: None,
        preset: None,
        shared: false,
        fetch: false,
        remote: false,
        tag_name: None,
        tag_message: None,
        sign: false,
        signing_key: None,
        keep: false,
        push: false,
        strategy: None,
        downstream_strategy: None,
        prefix: None,
        starting_point: None,
        auto_update: None,
        tag: None,
    }
}

fn build_args(request: &GitFlowRequest) -> WorkspaceResult<Vec<OsString>> {
    let mut args = match request.command {
        GitFlowCommand::Init => {
            let mut args = strings(["init", "--defaults"]);
            if let Some(preset) = request.preset
                && preset != GitFlowPreset::Custom
            {
                args.push(format!("--preset={}", preset_name(preset)).into());
            }
            args.push("--local".into());
            args
        }
        GitFlowCommand::Start => {
            let mut args = topic_args(request, "start")?;
            args.push(required(&request.name, "name")?.into());
            if let Some(base) = &request.base {
                args.push(base.into());
            }
            args.push(
                if request.fetch {
                    "--fetch"
                } else {
                    "--no-fetch"
                }
                .into(),
            );
            args
        }
        GitFlowCommand::List => topic_args(request, "list")?,
        GitFlowCommand::Checkout => {
            let mut args = topic_args(request, "checkout")?;
            args.push(required(&request.name, "name")?.into());
            args
        }
        GitFlowCommand::Update => {
            let mut args = optional_topic_args(request, "update");
            if let Some(name) = &request.name {
                args.push(name.into());
            }
            if request.strategy == Some(GitFlowStrategy::Rebase) {
                args.push("--rebase".into());
            }
            args
        }
        GitFlowCommand::Publish => {
            let mut args = topic_args(request, "publish")?;
            if let Some(name) = &request.name {
                args.push(name.into());
            }
            args.push("--no-push-option".into());
            args
        }
        GitFlowCommand::Track => {
            let mut args = topic_args(request, "track")?;
            args.push(required(&request.name, "name")?.into());
            args
        }
        GitFlowCommand::Rename => {
            let mut args = topic_args(request, "rename")?;
            args.push(required(&request.name, "name")?.into());
            args.push(required(&request.secondary_name, "secondaryName")?.into());
            args
        }
        GitFlowCommand::Delete => {
            let mut args = topic_args(request, "delete")?;
            args.push(required(&request.name, "name")?.into());
            args.push("--no-force".into());
            args.push(
                if request.remote {
                    "--remote"
                } else {
                    "--no-remote"
                }
                .into(),
            );
            args.push(
                if request.fetch {
                    "--fetch"
                } else {
                    "--no-fetch"
                }
                .into(),
            );
            args
        }
        GitFlowCommand::Finish => {
            let mut args = optional_topic_args(request, "finish");
            if let Some(name) = &request.name {
                args.push(name.into());
            }
            finish_options(request, &mut args);
            args
        }
        GitFlowCommand::Integrate => {
            let mut args = strings(["integrate"]);
            if let Some(name) = &request.name {
                args.push(name.into());
            }
            integrate_options(request, &mut args);
            args
        }
        GitFlowCommand::ConfigList => strings(["config", "list"]),
        GitFlowCommand::ConfigAddBase => config_mutation(request, "add", "base")?,
        GitFlowCommand::ConfigAddTopic => config_mutation(request, "add", "topic")?,
        GitFlowCommand::ConfigEditBase => config_mutation(request, "edit", "base")?,
        GitFlowCommand::ConfigEditTopic => config_mutation(request, "edit", "topic")?,
        GitFlowCommand::ConfigRenameBase => config_rename(request, "base")?,
        GitFlowCommand::ConfigRenameTopic => config_rename(request, "topic")?,
        GitFlowCommand::ConfigDeleteBase => config_delete(request, "base")?,
        GitFlowCommand::ConfigDeleteTopic => config_delete(request, "topic")?,
        GitFlowCommand::ConfigStatus => strings(["config", "status"]),
        GitFlowCommand::ConfigSync => strings(["config", "sync"]),
        GitFlowCommand::Continue => {
            let mut args = optional_topic_args(request, resumable_name(request)?);
            args.push("--continue".into());
            if let Some(name) = &request.secondary_name {
                args.push(name.into());
            }
            args
        }
        GitFlowCommand::Abort => {
            let mut args = optional_topic_args(request, resumable_name(request)?);
            args.push("--abort".into());
            if let Some(name) = &request.secondary_name {
                args.push(name.into());
            }
            args
        }
    };
    args.shrink_to_fit();
    Ok(args)
}

fn topic_args(request: &GitFlowRequest, command: &str) -> WorkspaceResult<Vec<OsString>> {
    Ok(vec![
        required(&request.topic_type, "topicType")?.into(),
        command.into(),
    ])
}

fn optional_topic_args(request: &GitFlowRequest, command: &str) -> Vec<OsString> {
    let mut args = Vec::new();
    if let Some(topic) = &request.topic_type {
        args.push(topic.into());
    }
    args.push(command.into());
    args
}

fn finish_options(request: &GitFlowRequest, args: &mut Vec<OsString>) {
    args.push("--no-force-delete".into());
    args.push(if request.keep { "--keep" } else { "--no-keep" }.into());
    args.push(
        if request.fetch {
            "--fetch"
        } else {
            "--no-fetch"
        }
        .into(),
    );
    args.push(if request.push { "--push" } else { "--no-push" }.into());
    match request.strategy {
        Some(GitFlowStrategy::Merge) => args.push("--no-rebase".into()),
        Some(GitFlowStrategy::Rebase) => args.push("--rebase".into()),
        Some(GitFlowStrategy::Squash) => args.push("--squash".into()),
        None => {}
    }
    if let Some(tag) = &request.tag_name {
        args.push("--tag".into());
        args.push("--tagname".into());
        args.push(tag.into());
    } else {
        args.push("--notag".into());
    }
    if let Some(message) = &request.tag_message {
        args.push("--message".into());
        args.push(message.into());
    }
    if request.sign {
        args.push("--sign".into());
        if let Some(key) = &request.signing_key {
            args.push("--signingkey".into());
            args.push(key.into());
        }
    } else {
        args.push("--no-sign".into());
    }
}

fn integrate_options(request: &GitFlowRequest, args: &mut Vec<OsString>) {
    args.push(
        if request.fetch {
            "--fetch"
        } else {
            "--no-fetch"
        }
        .into(),
    );
    match request.strategy {
        Some(GitFlowStrategy::Merge) => args.push("--no-rebase".into()),
        Some(GitFlowStrategy::Rebase) => args.push("--rebase".into()),
        Some(GitFlowStrategy::Squash) => args.push("--squash".into()),
        None => {}
    }
    if let Some(tag) = &request.tag_name {
        args.push("--tag".into());
        args.push(tag.into());
    } else {
        args.push("--notag".into());
    }
    if let Some(message) = &request.tag_message {
        args.push("--message".into());
        args.push(message.into());
    }
    if request.sign {
        args.push("--sign".into());
        if let Some(key) = &request.signing_key {
            args.push("--signingkey".into());
            args.push(key.into());
        }
    } else {
        args.push("--no-sign".into());
    }
}

fn config_mutation(
    request: &GitFlowRequest,
    operation: &str,
    kind: &str,
) -> WorkspaceResult<Vec<OsString>> {
    let mut args = vec![
        "config".into(),
        operation.into(),
        kind.into(),
        required(&request.name, "name")?.into(),
    ];
    if operation == "add" {
        if kind == "topic" {
            args.push(required(&request.parent, "parent")?.into());
        } else if let Some(parent) = &request.parent {
            args.push(parent.into());
        }
    }
    if kind == "topic" {
        if let Some(prefix) = &request.prefix {
            args.push(format!("--prefix={prefix}").into());
        }
        if let Some(starting_point) = &request.starting_point {
            args.push(format!("--starting-point={starting_point}").into());
        }
    }
    if let Some(strategy) = request.strategy {
        args.push(format!("--upstream-strategy={}", strategy_name(strategy)).into());
    }
    if let Some(strategy) = request.downstream_strategy {
        if strategy == GitFlowStrategy::Squash {
            return Err(invalid("downstreamStrategy does not support squash"));
        }
        args.push(format!("--downstream-strategy={}", strategy_name(strategy)).into());
    }
    if kind == "base"
        && let Some(auto_update) = request.auto_update
    {
        args.push(format!("--auto-update={auto_update}").into());
    }
    if kind == "topic"
        && let Some(tag) = request.tag
    {
        args.push(format!("--tag={tag}").into());
    }
    Ok(args)
}

fn config_rename(request: &GitFlowRequest, kind: &str) -> WorkspaceResult<Vec<OsString>> {
    let args = vec![
        "config".into(),
        "rename".into(),
        kind.into(),
        required(&request.name, "name")?.into(),
        required(&request.secondary_name, "secondaryName")?.into(),
    ];
    Ok(args)
}

fn config_delete(request: &GitFlowRequest, kind: &str) -> WorkspaceResult<Vec<OsString>> {
    let args = vec![
        "config".into(),
        "delete".into(),
        kind.into(),
        required(&request.name, "name")?.into(),
    ];
    Ok(args)
}

fn writes_configuration(command: GitFlowCommand) -> bool {
    matches!(
        command,
        GitFlowCommand::Init
            | GitFlowCommand::ConfigAddBase
            | GitFlowCommand::ConfigAddTopic
            | GitFlowCommand::ConfigEditBase
            | GitFlowCommand::ConfigEditTopic
            | GitFlowCommand::ConfigRenameBase
            | GitFlowCommand::ConfigRenameTopic
            | GitFlowCommand::ConfigDeleteBase
            | GitFlowCommand::ConfigDeleteTopic
    )
}

fn read_config(
    git: &GitExecutor,
    root: &Path,
    file: Option<PathBuf>,
    control: Option<&RunControl>,
) -> WorkspaceResult<(Vec<(String, String)>, GitOutput)> {
    let output = git.run(
        Some(root),
        GitCommand::GitFlowConfigList { file },
        None,
        control,
    )?;
    if output.status == Some(1) && output.stdout.is_empty() {
        return Ok((Vec::new(), output));
    }
    let output = output.ensure_success()?;
    let mut entries = Vec::new();
    for entry in output.stdout.split(|byte| *byte == 0) {
        if entry.is_empty() {
            continue;
        }
        let text = String::from_utf8_lossy(entry);
        let (key, value) = text.split_once('\n').ok_or_else(|| {
            WorkspaceError::new(
                ErrorCode::GitFailed,
                "Git Flow configを解析できませんでした。",
            )
        })?;
        if !key.starts_with("gitflow.") || key.chars().any(char::is_control) {
            return Err(invalid("invalid Git Flow config key"));
        }
        entries.push((key.to_owned(), value.to_owned()));
    }
    entries.sort();
    Ok((entries, output))
}

fn replace_local_config(
    git: &GitExecutor,
    root: &Path,
    current: &[(String, String)],
    replacement: &[(String, String)],
    control: Option<&RunControl>,
) -> WorkspaceResult<GitOutput> {
    let mut keys = current.iter().map(|(key, _)| key).collect::<Vec<_>>();
    keys.sort();
    keys.dedup();
    let mut last = None;
    for key in keys {
        last = Some(
            git.run(
                Some(root),
                GitCommand::GitFlowConfigUnset { key: key.clone() },
                None,
                control,
            )?
            .ensure_success()?,
        );
    }
    for (key, value) in replacement {
        last = Some(
            git.run(
                Some(root),
                GitCommand::GitFlowConfigAdd {
                    file: None,
                    key: key.clone(),
                    value: value.clone(),
                },
                None,
                control,
            )?
            .ensure_success()?,
        );
    }
    last.ok_or_else(|| invalid("shared Git Flow config is empty"))
}

fn sync_local_to_shared(
    git: &GitExecutor,
    root: &Path,
    control: Option<&RunControl>,
) -> WorkspaceResult<()> {
    let (entries, _) = read_config(git, root, None, control)?;
    if entries.is_empty() {
        return Err(invalid("local Git Flow config is empty"));
    }
    let temporary = root.join(format!(".gitflow.stella-{}.tmp", Uuid::new_v4()));
    for (key, value) in &entries {
        let result = git
            .run(
                Some(root),
                GitCommand::GitFlowConfigAdd {
                    file: Some(temporary.clone()),
                    key: key.clone(),
                    value: value.clone(),
                },
                None,
                control,
            )?
            .ensure_success();
        if let Err(error) = result {
            let _ = fs::remove_file(&temporary);
            return Err(error);
        }
    }
    fs::rename(&temporary, root.join(".gitflow"))
        .map_err(|error| WorkspaceError::new(ErrorCode::Io, error.to_string()))
}

fn sync_shared_to_local(
    git: &GitExecutor,
    root: &Path,
    control: Option<&RunControl>,
) -> WorkspaceResult<GitOutput> {
    let shared_path = root.join(".gitflow");
    if !shared_path.is_file() {
        return Err(invalid("shared .gitflow config does not exist"));
    }
    let (current, _) = read_config(git, root, None, control)?;
    let (shared, _) = read_config(git, root, Some(shared_path), control)?;
    match replace_local_config(git, root, &current, &shared, control) {
        Ok(output) => Ok(output),
        Err(error) => {
            let partial = read_config(git, root, None, control)
                .map(|(entries, _)| entries)
                .unwrap_or_default();
            let _ = replace_local_config(git, root, &partial, &current, control);
            Err(error)
        }
    }
}

fn config_status(
    git: &GitExecutor,
    root: &Path,
    control: Option<&RunControl>,
) -> WorkspaceResult<GitOutput> {
    let (local, mut output) = read_config(git, root, None, control)?;
    let shared_path = root.join(".gitflow");
    let shared = if shared_path.is_file() {
        read_config(git, root, Some(shared_path.clone()), control)?.0
    } else {
        Vec::new()
    };
    output.status = Some(0);
    output.stdout = serde_json::to_vec(&serde_json::json!({
        "sharedExists": shared_path.is_file(),
        "inSync": !shared.is_empty() && local == shared,
        "localEntryCount": local.len(),
        "sharedEntryCount": shared.len(),
    }))
    .map_err(|error| WorkspaceError::new(ErrorCode::Internal, error.to_string()))?;
    output.stderr.clear();
    Ok(output)
}

fn resumable_name(request: &GitFlowRequest) -> WorkspaceResult<&'static str> {
    match request.name.as_deref() {
        Some("finish") => Ok("finish"),
        Some("update") => Ok("update"),
        Some("integrate") => Ok("integrate"),
        _ => Err(invalid("name must identify finish, update, or integrate")),
    }
}

pub(crate) fn validate(request: &GitFlowRequest) -> WorkspaceResult<()> {
    for (field, value) in [
        ("topicType", request.topic_type.as_deref()),
        ("name", request.name.as_deref()),
        ("secondaryName", request.secondary_name.as_deref()),
        ("parent", request.parent.as_deref()),
        ("base", request.base.as_deref()),
        ("tagName", request.tag_name.as_deref()),
        ("signingKey", request.signing_key.as_deref()),
        ("prefix", request.prefix.as_deref()),
        ("startingPoint", request.starting_point.as_deref()),
    ] {
        if let Some(value) = value
            && (value.is_empty()
                || value.starts_with('-')
                || value.contains('\0')
                || value.chars().any(char::is_whitespace)
                || value.chars().any(char::is_control))
        {
            return Err(invalid(format!("invalid {field}")));
        }
    }
    if let Some(message) = &request.tag_message
        && (message.contains('\0') || message.len() > 16 * 1024)
    {
        return Err(invalid("invalid tagMessage"));
    }
    if request.sign && request.tag_name.is_none() {
        return Err(invalid("tag signing requires tagName"));
    }
    Ok(())
}

fn required<'a>(value: &'a Option<String>, field: &str) -> WorkspaceResult<&'a str> {
    value
        .as_deref()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| invalid(format!("{field} is required")))
}

fn preset_name(value: GitFlowPreset) -> &'static str {
    match value {
        GitFlowPreset::Classic => "classic",
        GitFlowPreset::Github => "github",
        GitFlowPreset::Gitlab => "gitlab",
        GitFlowPreset::Custom => "custom",
    }
}

fn strategy_name(value: GitFlowStrategy) -> &'static str {
    match value {
        GitFlowStrategy::Merge => "merge",
        GitFlowStrategy::Rebase => "rebase",
        GitFlowStrategy::Squash => "squash",
    }
}

fn invalid(message: impl Into<String>) -> WorkspaceError {
    WorkspaceError::new(ErrorCode::InvalidRequest, message)
}

fn plain_overview(text: &str) -> serde_json::Value {
    let mut section = "";
    let mut base_branch = None;
    let mut topic_type = None;
    let mut active_branch = None;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed == "Base branches:" {
            section = "base";
        } else if trimmed == "Topic branch types:" {
            section = "topic";
        } else if trimmed == "Active topic branches:" {
            section = "active";
        } else if !trimmed.is_empty() && !trimmed.chars().all(|value| value == '=') {
            if section == "base" && base_branch.is_none() {
                base_branch = trimmed.split_whitespace().next().map(str::to_owned);
            } else if section == "topic" && topic_type.is_none() && trimmed.ends_with("/*:") {
                topic_type = Some(trimmed.trim_end_matches("/*:").to_owned());
            } else if section == "active" && active_branch.is_none() && !trimmed.starts_with("No ")
            {
                let active = trimmed.strip_prefix("* ").unwrap_or(trimmed);
                active_branch = active.split_whitespace().next().map(str::to_owned);
                if let Some((_, suffix)) = active.rsplit_once('(') {
                    topic_type = Some(suffix.trim_end_matches(')').to_owned());
                }
            }
        }
    }
    serde_json::json!({
        "health": "initialized",
        "baseBranch": base_branch,
        "topicType": topic_type,
        "activeBranch": active_branch,
        "text": text,
    })
}

fn strings<const N: usize>(values: [&str; N]) -> Vec<OsString> {
    values.into_iter().map(OsString::from).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(command: GitFlowCommand) -> GitFlowRequest {
        empty_request(command)
    }

    #[test]
    fn init_is_non_interactive_and_repository_scoped() {
        let mut value = request(GitFlowCommand::Init);
        value.preset = Some(GitFlowPreset::Classic);
        value.shared = true;
        assert_eq!(
            build_args(&value).unwrap(),
            strings(["init", "--defaults", "--preset=classic", "--local"])
        );
    }

    #[test]
    fn delete_never_enables_force() {
        let mut value = request(GitFlowCommand::Delete);
        value.topic_type = Some("feature".into());
        value.name = Some("safe-name".into());
        value.remote = true;
        assert_eq!(
            build_args(&value).unwrap(),
            strings([
                "feature",
                "delete",
                "safe-name",
                "--no-force",
                "--remote",
                "--no-fetch"
            ])
        );
    }

    #[test]
    fn finish_disables_hook_and_force_bypasses_by_omission() {
        let mut value = request(GitFlowCommand::Finish);
        value.topic_type = Some("release".into());
        value.name = Some("1.0.0".into());
        value.tag_name = Some("v1.0.0".into());
        value.push = true;
        let args = build_args(&value).unwrap();
        assert!(!args.contains(&OsString::from("--force")));
        assert!(!args.contains(&OsString::from("--no-verify")));
        assert!(args.contains(&OsString::from("--push")));
        assert!(args.contains(&OsString::from("--tagname")));
    }

    #[test]
    fn option_like_values_are_rejected() {
        let mut value = request(GitFlowCommand::Start);
        value.topic_type = Some("feature".into());
        value.name = Some("--force".into());
        assert!(validate(&value).is_err());
    }

    #[test]
    fn config_fields_are_scoped_to_the_supported_branch_kind() {
        let mut topic = request(GitFlowCommand::ConfigAddTopic);
        topic.name = Some("experiment".into());
        topic.parent = Some("develop".into());
        topic.prefix = Some("exp/".into());
        topic.starting_point = Some("develop".into());
        topic.strategy = Some(GitFlowStrategy::Squash);
        topic.downstream_strategy = Some(GitFlowStrategy::Rebase);
        topic.auto_update = Some(true);
        topic.tag = Some(false);
        let topic_args = build_args(&topic).unwrap();
        assert!(topic_args.contains(&OsString::from("--prefix=exp/")));
        assert!(topic_args.contains(&OsString::from("--downstream-strategy=rebase")));
        assert!(topic_args.contains(&OsString::from("--tag=false")));
        assert!(!topic_args.contains(&OsString::from("--auto-update=true")));

        let mut base = request(GitFlowCommand::ConfigAddBase);
        base.name = Some("staging".into());
        base.parent = Some("develop".into());
        base.prefix = Some("ignored/".into());
        base.auto_update = Some(false);
        base.tag = Some(true);
        let base_args = build_args(&base).unwrap();
        assert!(base_args.contains(&OsString::from("--auto-update=false")));
        assert!(!base_args.contains(&OsString::from("--prefix=ignored/")));
        assert!(!base_args.contains(&OsString::from("--tag=true")));
    }

    #[test]
    fn shared_config_status_and_sync_round_trip_repository_local_values() {
        let directory = tempfile::TempDir::new().unwrap();
        let git = GitExecutor::system().unwrap();
        git.run(
            None,
            GitCommand::Init {
                path: directory.path().to_path_buf(),
                initial_branch: "main".into(),
            },
            None,
            None,
        )
        .unwrap()
        .ensure_success()
        .unwrap();
        for (key, value) in [
            ("gitflow.initialized", "true"),
            ("gitflow.branch.main.type", "base"),
            ("gitflow.branch.feature.prefix", "feat/"),
        ] {
            git.run(
                Some(directory.path()),
                GitCommand::GitFlowConfigAdd {
                    file: None,
                    key: key.into(),
                    value: value.into(),
                },
                None,
                None,
            )
            .unwrap()
            .ensure_success()
            .unwrap();
        }
        let mut request = request(GitFlowCommand::Publish);
        request.topic_type = Some("feature".into());
        request.name = Some("demo".into());
        assert_eq!(
            topic_branch_name(&git, directory.path(), &request, None).unwrap(),
            Some("feat/demo".into())
        );
        sync_local_to_shared(&git, directory.path(), None).unwrap();
        git.run(
            Some(directory.path()),
            GitCommand::GitFlowConfigAdd {
                file: None,
                key: "gitflow.branch.main.type".into(),
                value: "changed".into(),
            },
            None,
            None,
        )
        .unwrap()
        .ensure_success()
        .unwrap();
        let status = config_status(&git, directory.path(), None).unwrap();
        let status: serde_json::Value = serde_json::from_slice(&status.stdout).unwrap();
        assert_eq!(status["inSync"], false);

        sync_shared_to_local(&git, directory.path(), None).unwrap();
        let (local, _) = read_config(&git, directory.path(), None, None).unwrap();
        let (shared, _) = read_config(
            &git,
            directory.path(),
            Some(directory.path().join(".gitflow")),
            None,
        )
        .unwrap();
        assert_eq!(local, shared);
    }

    #[test]
    fn every_typed_command_family_builds_without_exposing_bypass_options() {
        let commands = [
            GitFlowCommand::Init,
            GitFlowCommand::Start,
            GitFlowCommand::List,
            GitFlowCommand::Checkout,
            GitFlowCommand::Update,
            GitFlowCommand::Publish,
            GitFlowCommand::Track,
            GitFlowCommand::Rename,
            GitFlowCommand::Delete,
            GitFlowCommand::Finish,
            GitFlowCommand::Integrate,
            GitFlowCommand::ConfigList,
            GitFlowCommand::ConfigAddBase,
            GitFlowCommand::ConfigAddTopic,
            GitFlowCommand::ConfigEditBase,
            GitFlowCommand::ConfigEditTopic,
            GitFlowCommand::ConfigRenameBase,
            GitFlowCommand::ConfigRenameTopic,
            GitFlowCommand::ConfigDeleteBase,
            GitFlowCommand::ConfigDeleteTopic,
            GitFlowCommand::ConfigStatus,
            GitFlowCommand::ConfigSync,
            GitFlowCommand::Continue,
            GitFlowCommand::Abort,
        ];
        for command in commands {
            let mut value = request(command);
            value.topic_type = Some("feature".into());
            value.name = Some("finish".into());
            value.secondary_name = Some("renamed".into());
            value.parent = Some("main".into());
            value.preset = Some(GitFlowPreset::Classic);
            let args = build_args(&value)
                .unwrap_or_else(|error| panic!("{command:?}のargvを構築できませんでした: {error}"));
            assert!(!args.is_empty(), "{command:?}");
            for prohibited in [
                "--force",
                "--force-delete",
                "--no-verify",
                "--global",
                "--system",
            ] {
                assert!(!args.contains(&OsString::from(prohibited)), "{command:?}");
            }
        }
    }

    #[test]
    fn conflict_recovery_maps_to_git_flow_continue_and_abort() {
        for (command, flag) in [
            (GitFlowCommand::Continue, "--continue"),
            (GitFlowCommand::Abort, "--abort"),
        ] {
            let mut value = request(command);
            value.topic_type = Some("feature".into());
            value.name = Some("finish".into());
            value.secondary_name = Some("conflict".into());
            assert_eq!(
                build_args(&value).unwrap(),
                strings(["feature", "finish", flag, "conflict"])
            );
        }
    }

    #[test]
    fn pending_operation_is_restored_from_git_flow_state() {
        let directory = tempfile::TempDir::new().unwrap();
        let state_directory = directory.path().join("gitflow/state");
        fs::create_dir_all(&state_directory).unwrap();
        fs::write(
            state_directory.join("merge.json"),
            br#"{"action":"integrate","branchType":"develop","branchName":"develop","fullBranchName":"develop"}"#,
        )
        .unwrap();
        assert_eq!(pending_operation(directory.path()), Some("integrate"));
    }

    #[test]
    fn plain_overview_extracts_the_active_branch_and_topic_type() {
        let overview = plain_overview(
            "Base branches:\n==============\n  main (root)\n\nTopic branch types:\n===================\nfeature/*:\n  Parent: develop\n\nActive topic branches:\n======================\n* feature/demo (feature)\n",
        );
        assert_eq!(overview["baseBranch"], "main");
        assert_eq!(overview["topicType"], "feature");
        assert_eq!(overview["activeBranch"], "feature/demo");
    }
}
