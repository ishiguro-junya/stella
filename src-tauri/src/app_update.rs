use std::{sync::Arc, time::Duration};

use serde::Serialize;
use tauri::{AppHandle, State, ipc::Channel};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;

const PRERELEASE_ENDPOINT: &str =
    "https://github.com/ishiguro-junya/stella/releases/download/updater-prerelease/latest.json";
const STABLE_ENDPOINT: &str =
    "https://github.com/ishiguro-junya/stella/releases/download/updater-stable/latest.json";

#[derive(Default)]
pub(crate) struct AppUpdateState {
    pending: Mutex<Option<Update>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppUpdateInfo {
    current_version: String,
    version: String,
    notes: Option<String>,
    date: Option<String>,
}

impl From<&Update> for AppUpdateInfo {
    fn from(update: &Update) -> Self {
        Self {
            current_version: update.current_version.clone(),
            version: update.version.clone(),
            notes: update.body.clone(),
            date: update.date.map(|date| date.to_string()),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub(crate) enum AppUpdateInstallEvent {
    Started,
    Progress {
        #[serde(rename = "chunkLength")]
        chunk_length: usize,
        #[serde(rename = "contentLength")]
        content_length: Option<u64>,
    },
    Finished,
}

pub(crate) fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry, tauri_plugin_updater::Config> {
    tauri_plugin_updater::Builder::new().build()
}

fn endpoint(version: &str) -> &'static str {
    let version_without_build = version.split('+').next().unwrap_or(version);
    if version_without_build.contains('-') {
        PRERELEASE_ENDPOINT
    } else {
        STABLE_ENDPOINT
    }
}

#[tauri::command]
pub(crate) async fn app_update_check(
    app: AppHandle,
    state: State<'_, Arc<AppUpdateState>>,
) -> Result<Option<AppUpdateInfo>, String> {
    let mut pending = state.pending.lock().await;
    if let Some(update) = pending.as_ref() {
        return Ok(Some(update.into()));
    }

    let endpoint = endpoint(&app.package_info().version.to_string())
        .parse()
        .map_err(|error| format!("更新先URLが不正です: {error}"))?;
    let update = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| error.to_string())?
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?;
    let info = update.as_ref().map(AppUpdateInfo::from);
    *pending = update;
    Ok(info)
}

#[tauri::command]
pub(crate) async fn app_update_install(
    app: AppHandle,
    state: State<'_, Arc<AppUpdateState>>,
    on_event: Channel<AppUpdateInstallEvent>,
) -> Result<(), String> {
    let pending = state.pending.lock().await;
    let update = pending
        .as_ref()
        .ok_or_else(|| "インストールできる更新がありません。".to_owned())?;
    let progress = on_event.clone();
    on_event
        .send(AppUpdateInstallEvent::Started)
        .map_err(|error| error.to_string())?;
    update
        .download_and_install(
            move |chunk_length, content_length| {
                let _ = progress.send(AppUpdateInstallEvent::Progress {
                    chunk_length,
                    content_length,
                });
            },
            || {},
        )
        .await
        .map_err(|error| error.to_string())?;
    on_event
        .send(AppUpdateInstallEvent::Finished)
        .map_err(|error| error.to_string())?;
    drop(pending);
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prereleases_and_stable_versions_use_separate_feeds() {
        assert_eq!(endpoint("1.0.0-alpha.1"), PRERELEASE_ENDPOINT);
        assert_eq!(endpoint("1.0.0-beta.1"), PRERELEASE_ENDPOINT);
        assert_eq!(endpoint("1.0.0-rc.1"), PRERELEASE_ENDPOINT);
        assert_eq!(endpoint("1.0.0"), STABLE_ENDPOINT);
        assert_eq!(endpoint("1.0.0+build.1"), STABLE_ENDPOINT);
    }

    #[test]
    fn install_progress_uses_the_frontend_channel_contract() {
        assert_eq!(
            serde_json::to_value(AppUpdateInstallEvent::Progress {
                chunk_length: 64,
                content_length: Some(128),
            })
            .expect("progress event should serialize"),
            serde_json::json!({
                "event": "progress",
                "chunkLength": 64,
                "contentLength": 128,
            }),
        );
    }
}
