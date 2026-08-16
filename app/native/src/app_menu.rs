#[cfg(target_os = "macos")]
use std::process::Command;
use std::sync::OnceLock;

use serde::Deserialize;
use tauri::image::Image;
use tauri::menu::{
    AboutMetadata, Menu, MenuBuilder, MenuEvent, MenuId, MenuItemBuilder, Submenu, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Runtime};

const SETTINGS_MENU_ID: &str = "stella-settings";
const CHECK_UPDATES_MENU_ID: &str = "stella-check-updates";
const SETTINGS_MENU_ACCELERATOR: &str = "Cmd+,";
const MENU_EVENT_TARGET: &str = "main";
const OPEN_SETTINGS_EVENT: &str = "stella://open-settings";
const CHECK_UPDATES_EVENT: &str = "stella://check-updates";
const LICENSE_NAME: &str = "Sustainable Use License 1.0";
const COPYRIGHT_NOTICE: &str = "© Junya Ishiguro";
const DEVELOPMENT_VERSION: &str = "0.0.0-dev";
const FILES_AND_FOLDERS_SETTINGS_URL: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders";
const PRIVACY_SETTINGS_URL: &str = "x-apple.systempreferences:com.apple.preference.security";
const ABOUT_ICON: Image<'static> = tauri::include_image!("./icons/icon.png");

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum AppLanguage {
    Ja,
    En,
}

#[derive(Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
struct MenuLabels {
    native_menu_about: String,
    native_menu_check_updates: String,
    native_menu_settings: String,
    native_menu_services: String,
    native_menu_hide: String,
    native_menu_hide_others: String,
    native_menu_show_all: String,
    native_menu_quit: String,
    native_menu_file: String,
    native_menu_close_window: String,
    native_menu_edit: String,
    native_menu_undo: String,
    native_menu_redo: String,
    native_menu_cut: String,
    native_menu_copy: String,
    native_menu_paste: String,
    native_menu_select_all: String,
    native_menu_view: String,
    native_menu_fullscreen: String,
    native_menu_window: String,
    native_menu_minimize: String,
    native_menu_zoom: String,
    native_menu_bring_all_to_front: String,
    native_menu_help: String,
}

const ENGLISH_MESSAGES: &str = include_str!("../../i18n/locales/en.json");
const JAPANESE_MESSAGES: &str = include_str!("../../i18n/locales/ja.json");

fn labels(language: AppLanguage) -> MenuLabels {
    let catalog = match language {
        AppLanguage::Ja => JAPANESE_MESSAGES,
        AppLanguage::En => ENGLISH_MESSAGES,
    };
    serde_json::from_str(catalog).expect("翻訳カタログを読み込めませんでした")
}

fn about_metadata(
    name: &str,
    version: &str,
    commit: Option<&str>,
    release_date: Option<&str>,
    copyright: Option<&str>,
    icon: Option<Image<'static>>,
) -> AboutMetadata<'static> {
    let version = match commit {
        Some(commit) if version != DEVELOPMENT_VERSION => format!("{version} ({commit})"),
        _ => version.to_owned(),
    };
    let copyright = copyright.unwrap_or(COPYRIGHT_NOTICE);
    let copyright = if cfg!(target_os = "macos") {
        Some(format!(
            "Ver. {version}\n{}{}\n{LICENSE_NAME}",
            release_date.map_or(String::new(), |date| format!("{date}\n")),
            copyright
        ))
    } else {
        Some(copyright.to_owned())
    };
    AboutMetadata {
        name: Some(name.to_owned()),
        copyright,
        license: Some(LICENSE_NAME.to_owned()),
        icon,
        ..Default::default()
    }
}

fn startup_date() -> Option<&'static str> {
    static STARTUP_DATE: OnceLock<Option<String>> = OnceLock::new();
    STARTUP_DATE
        .get_or_init(|| {
            #[cfg(target_os = "macos")]
            {
                Command::new("/bin/date")
                    .arg("+%Y/%m/%d")
                    .output()
                    .ok()
                    .filter(|output| output.status.success())
                    .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
            }
            #[cfg(not(target_os = "macos"))]
            None
        })
        .as_deref()
}

pub(crate) fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    build_for_language(app, initial_language())
}

fn build_for_language<R: Runtime>(
    app: &AppHandle<R>,
    language: AppLanguage,
) -> tauri::Result<Menu<R>> {
    let text = labels(language);
    let package = app.package_info();
    let version = package.version.to_string();
    let release_date = if version == DEVELOPMENT_VERSION {
        startup_date()
    } else {
        option_env!("STELLA_BUILD_DATE")
    };
    let about = about_metadata(
        &package.name,
        &version,
        option_env!("STELLA_COMMIT"),
        release_date,
        app.config().bundle.copyright.as_deref(),
        Some(ABOUT_ICON.clone()),
    );
    let settings = MenuItemBuilder::with_id(SETTINGS_MENU_ID, text.native_menu_settings.as_str())
        .accelerator(SETTINGS_MENU_ACCELERATOR)
        .build(app)?;
    let check_updates = MenuItemBuilder::with_id(
        CHECK_UPDATES_MENU_ID,
        text.native_menu_check_updates.as_str(),
    )
    .build(app)?;

    let app_submenu = SubmenuBuilder::new(app, package.name.as_str())
        .about_with_text(text.native_menu_about.as_str(), Some(about))
        .item(&check_updates)
        .separator()
        .item(&settings)
        .separator()
        .services_with_text(text.native_menu_services.as_str())
        .separator()
        .hide_with_text(text.native_menu_hide.as_str())
        .hide_others_with_text(text.native_menu_hide_others.as_str())
        .show_all_with_text(text.native_menu_show_all.as_str())
        .separator()
        .quit_with_text(text.native_menu_quit.as_str())
        .build()?;
    let file_submenu = SubmenuBuilder::new(app, text.native_menu_file.as_str())
        .close_window_with_text(text.native_menu_close_window.as_str())
        .build()?;
    let edit_submenu = SubmenuBuilder::new(app, text.native_menu_edit.as_str())
        .undo_with_text(text.native_menu_undo.as_str())
        .redo_with_text(text.native_menu_redo.as_str())
        .separator()
        .cut_with_text(text.native_menu_cut.as_str())
        .copy_with_text(text.native_menu_copy.as_str())
        .paste_with_text(text.native_menu_paste.as_str())
        .select_all_with_text(text.native_menu_select_all.as_str())
        .build()?;
    let view_submenu = SubmenuBuilder::new(app, text.native_menu_view.as_str())
        .fullscreen_with_text(text.native_menu_fullscreen.as_str())
        .build()?;
    let window_submenu = SubmenuBuilder::with_id(
        app,
        tauri::menu::WINDOW_SUBMENU_ID,
        text.native_menu_window.as_str(),
    )
    .minimize_with_text(text.native_menu_minimize.as_str())
    .maximize_with_text(text.native_menu_zoom.as_str())
    .separator()
    .bring_all_to_front_with_text(text.native_menu_bring_all_to_front.as_str())
    .build()?;
    let help_submenu = Submenu::with_id(
        app,
        tauri::menu::HELP_SUBMENU_ID,
        text.native_menu_help.as_str(),
        true,
    )?;

    MenuBuilder::new(app)
        .item(&app_submenu)
        .item(&file_submenu)
        .item(&edit_submenu)
        .item(&view_submenu)
        .item(&window_submenu)
        .item(&help_submenu)
        .build()
}

#[tauri::command]
pub(crate) fn set_app_language(app: AppHandle, language: AppLanguage) -> Result<(), String> {
    let menu = build_for_language(&app, language).map_err(|error| error.to_string())?;
    app.set_menu(menu).map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn open_system_settings_url(url: &str) -> Result<(), String> {
    let status = Command::new("/usr/bin/open")
        .arg(url)
        .status()
        .map_err(|error| format!("システム設定を開けませんでした: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "システム設定を開けませんでした（終了コード: {}）",
            status
                .code()
                .map_or_else(|| "不明".to_owned(), |code| code.to_string())
        ))
    }
}

#[cfg(not(target_os = "macos"))]
fn open_system_settings_url(_url: &str) -> Result<(), String> {
    Err("システム設定はmacOSでのみ開けます。".to_owned())
}

#[tauri::command]
pub(crate) fn open_files_and_folders_settings() -> Result<(), String> {
    open_system_settings_url(FILES_AND_FOLDERS_SETTINGS_URL)
        .or_else(|_| open_system_settings_url(PRIVACY_SETTINGS_URL))
}

pub(crate) fn handle_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let event_name = if is_settings_event(event.id()) {
        OPEN_SETTINGS_EVENT
    } else if is_check_updates_event(event.id()) {
        CHECK_UPDATES_EVENT
    } else {
        return;
    };
    if let Err(error) = app.emit_to(MENU_EVENT_TARGET, event_name, ()) {
        eprintln!("Stellaのメニュー操作を通知できませんでした: {error}");
    }
}

fn is_settings_event(id: &MenuId) -> bool {
    id == SETTINGS_MENU_ID
}

fn is_check_updates_event(id: &MenuId) -> bool {
    id == CHECK_UPDATES_MENU_ID
}

fn language_from_locale(value: &str) -> AppLanguage {
    let normalized = value
        .trim()
        .trim_start_matches(['(', '"'])
        .to_ascii_lowercase();
    if normalized == "ja" || normalized.starts_with("ja-") || normalized.starts_with("ja_") {
        AppLanguage::Ja
    } else {
        AppLanguage::En
    }
}

fn initial_language() -> AppLanguage {
    #[cfg(target_os = "macos")]
    if let Ok(output) = Command::new("defaults")
        .args(["read", "-g", "AppleLanguages"])
        .output()
        && output.status.success()
    {
        let stdout = String::from_utf8_lossy(&output.stdout);
        if let Some(first) = stdout.lines().find(|line| {
            let value = line.trim();
            !value.is_empty() && value != "(" && value != ")"
        }) {
            return language_from_locale(first.trim_end_matches(','));
        }
    }

    ["LC_ALL", "LC_MESSAGES", "LANG"]
        .into_iter()
        .find_map(|key| std::env::var(key).ok().filter(|value| !value.is_empty()))
        .map_or(AppLanguage::En, |value| language_from_locale(&value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_event_is_scoped_to_its_native_menu_item() {
        assert!(is_settings_event(&MenuId::new(SETTINGS_MENU_ID)));
        assert!(is_check_updates_event(&MenuId::new(CHECK_UPDATES_MENU_ID)));
        assert!(!is_settings_event(&MenuId::new("quit")));
        assert_eq!(SETTINGS_MENU_ACCELERATOR, "Cmd+,");
    }

    #[test]
    fn settings_menu_emits_the_in_app_navigation_contract_to_the_main_window() {
        assert_eq!(MENU_EVENT_TARGET, "main");
        assert_eq!(OPEN_SETTINGS_EVENT, "stella://open-settings");
        assert_eq!(CHECK_UPDATES_EVENT, "stella://check-updates");
    }

    #[test]
    fn files_and_folders_settings_uses_the_privacy_pane_contract() {
        assert_eq!(
            FILES_AND_FOLDERS_SETTINGS_URL,
            "x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders"
        );
        assert_eq!(
            PRIVACY_SETTINGS_URL,
            "x-apple.systempreferences:com.apple.preference.security"
        );
    }

    #[test]
    fn locale_detection_uses_japanese_only_for_japanese_locales() {
        assert_eq!(language_from_locale("ja-JP"), AppLanguage::Ja);
        assert_eq!(language_from_locale("\"ja-JP\","), AppLanguage::Ja);
        assert_eq!(language_from_locale("en-US"), AppLanguage::En);
        assert_eq!(language_from_locale("unknown"), AppLanguage::En);
    }

    #[test]
    fn menu_labels_cover_both_languages_and_keep_settings_contract() {
        assert_eq!(labels(AppLanguage::En).native_menu_settings, "Settings…");
        assert_eq!(labels(AppLanguage::Ja).native_menu_settings, "設定…");
        assert_eq!(
            labels(AppLanguage::En).native_menu_check_updates,
            "Check for Updates…"
        );
        assert_eq!(
            labels(AppLanguage::Ja).native_menu_check_updates,
            "更新を確認…"
        );
        assert_eq!(labels(AppLanguage::En).native_menu_file, "File");
        assert_eq!(labels(AppLanguage::Ja).native_menu_file, "ファイル");
        assert_eq!(labels(AppLanguage::En).native_menu_help, "Help");
        assert_eq!(labels(AppLanguage::Ja).native_menu_help, "ヘルプ");
    }

    #[test]
    fn about_metadata_includes_the_app_name_version_and_visible_license() {
        let metadata = about_metadata(
            "Stella",
            "1.2.3-alpha.4",
            Some("2bd8ecf"),
            Some("2026/08/16"),
            Some("© Junya Ishiguro"),
            Some(Image::new_owned(vec![0, 0, 0, 0], 1, 1)),
        );

        assert_eq!(metadata.name.as_deref(), Some("Stella"));
        assert_eq!(metadata.version, None);
        assert_eq!(metadata.short_version, None);
        #[cfg(target_os = "macos")]
        assert_eq!(
            metadata.copyright.as_deref(),
            Some(
                "Ver. 1.2.3-alpha.4 (2bd8ecf)\n2026/08/16\n© Junya Ishiguro\nSustainable Use License 1.0"
            )
        );
        #[cfg(not(target_os = "macos"))]
        assert_eq!(metadata.copyright.as_deref(), Some("© Junya Ishiguro"));
        assert_eq!(metadata.license.as_deref(), Some(LICENSE_NAME));
        assert_eq!(metadata.credits, None);
        assert_eq!(metadata.icon.as_ref().map(Image::width), Some(1));
        assert_eq!(metadata.icon.as_ref().map(Image::height), Some(1));

        for name in ["Stella (DEV)", "Stella (TEST)"] {
            let mode_metadata = about_metadata(
                name,
                DEVELOPMENT_VERSION,
                Some("2bd8ecf"),
                Some("2026/08/17"),
                None,
                None,
            );
            assert_eq!(mode_metadata.name.as_deref(), Some(name));
            assert_eq!(mode_metadata.version, None);
            assert_eq!(mode_metadata.short_version, None);
            #[cfg(target_os = "macos")]
            assert_eq!(
                mode_metadata.copyright.as_deref(),
                Some("Ver. 0.0.0-dev\n2026/08/17\n© Junya Ishiguro\nSustainable Use License 1.0")
            );
            assert_eq!(mode_metadata.license.as_deref(), Some(LICENSE_NAME));
        }
    }
}
