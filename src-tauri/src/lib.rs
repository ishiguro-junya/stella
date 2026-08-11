#![forbid(unsafe_code)]

mod app_menu;
mod commit;
mod conflict;
mod git;
mod journal;
mod model;
mod patch;
mod repository_logo;
mod workspace;

pub use model::*;
pub use workspace::{
    Workspace, workspace_attach, workspace_cancel, workspace_execute, workspace_preview,
    workspace_query,
};

use std::sync::Arc;

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
    let workspace = Workspace::system()
        .unwrap_or_else(|error| panic!("Stella backend initialization failed: {error}"));

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(workspace));
    with_e2e_plugins(builder)
        .menu(app_menu::build)
        .on_menu_event(app_menu::handle_event)
        .invoke_handler(tauri::generate_handler![
            workspace_attach,
            workspace_query,
            workspace_preview,
            workspace_execute,
            workspace_cancel,
            repository_logo::repository_logo,
            app_menu::set_app_language
        ])
        .run(tauri::generate_context!())
        .expect("error while running Stella");
}
