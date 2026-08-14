#![forbid(unsafe_code)]

mod app_menu;
mod app_update;
mod commit;
mod conflict;
mod git;
mod git_flow;
mod journal;
mod model;
mod patch;
mod repository_logo;
mod toolchain;
mod workspace;
mod worktree_text;

pub use model::*;
pub use workspace::{
    Workspace, workspace_attach, workspace_cancel, workspace_delete_repository, workspace_detach,
    workspace_execute, workspace_preview, workspace_query,
};

use std::sync::Arc;
use tauri::Manager;

#[cfg(feature = "e2e")]
fn with_e2e_plugins(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init())
}

#[cfg(not(feature = "e2e"))]
fn with_e2e_plugins(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder
}

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(app_update::plugin())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let manager = toolchain::ToolchainManager::load(
                app.path().app_config_dir()?,
                app.path().resource_dir()?,
            );
            let executor = manager
                .executor()
                .guard_development_build()
                .map_err(|error| error.to_string())?;
            let workspace = Workspace::with_git(executor).map_err(|error| error.to_string())?;
            app.manage(Arc::new(workspace));
            app.manage(Arc::new(app_update::AppUpdateState::default()));
            app.manage(manager);
            Ok(())
        });
    with_e2e_plugins(builder)
        .menu(app_menu::build)
        .on_menu_event(app_menu::handle_event)
        .invoke_handler(tauri::generate_handler![
            workspace_attach,
            workspace_query,
            workspace_preview,
            workspace_execute,
            workspace_cancel,
            workspace_detach,
            workspace_delete_repository,
            repository_logo::repository_logo,
            app_update::app_update_check,
            app_update::app_update_install,
            app_menu::set_app_language,
            app_menu::open_files_and_folders_settings,
            toolchain::toolchain_status,
            toolchain::toolchain_set_mode
        ])
        .run(tauri::generate_context!())
        .expect("error while running Stella");
}
