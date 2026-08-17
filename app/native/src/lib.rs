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
    workspace_execute, workspace_image_bytes, workspace_preview, workspace_query,
};

use std::{
    env,
    hash::{DefaultHasher, Hash, Hasher},
    path::{Path, PathBuf},
    sync::Arc,
};
use tauri::Manager;

fn data_store_identifier(path: &Path) -> [u8; 16] {
    let mut first = DefaultHasher::new();
    path.hash(&mut first);
    let mut second = DefaultHasher::new();
    1_u8.hash(&mut second);
    path.hash(&mut second);

    let mut identifier = [0; 16];
    identifier[..8].copy_from_slice(&first.finish().to_be_bytes());
    identifier[8..].copy_from_slice(&second.finish().to_be_bytes());
    identifier[6] = (identifier[6] & 0x0f) | 0x50;
    identifier[8] = (identifier[8] & 0x3f) | 0x80;
    identifier
}

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
    let data_directory = env::var_os("TAURI_DATA_DIR").map(PathBuf::from);
    let mut context = tauri::generate_context!();
    if let Some(path) = &data_directory {
        let identifier = data_store_identifier(path);
        for window in &mut context.config_mut().app.windows {
            window.data_store_identifier = Some(identifier);
        }
    }

    let builder = tauri::Builder::default()
        .plugin(app_update::plugin())
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            let config_directory = match &data_directory {
                Some(path) => path.clone(),
                None => app.path().app_config_dir()?,
            };
            let manager =
                toolchain::ToolchainManager::load(config_directory, app.path().resource_dir()?)?;
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
            workspace_image_bytes,
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
            toolchain::toolchain_set_mode,
            toolchain::toolchain_set_ignore_patterns
        ])
        .run(context)
        .expect("error while running Stella");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_store_identifier_is_stable_and_path_specific() {
        let first = data_store_identifier(Path::new("/tmp/first"));
        assert_eq!(first, data_store_identifier(Path::new("/tmp/first")));
        assert_ne!(first, data_store_identifier(Path::new("/tmp/second")));
    }
}
