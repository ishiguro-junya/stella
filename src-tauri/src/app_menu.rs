#[cfg(target_os = "macos")]
use std::process::Command;

use serde::Deserialize;
use tauri::image::Image;
use tauri::menu::{
    AboutMetadata, Menu, MenuBuilder, MenuEvent, MenuId, MenuItemBuilder, Submenu, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Runtime};

const SETTINGS_MENU_ID: &str = "stella-settings";
const SETTINGS_MENU_ACCELERATOR: &str = "Cmd+,";
const SETTINGS_EVENT_TARGET: &str = "main";
const OPEN_SETTINGS_EVENT: &str = "stella://open-settings";
const LICENSE_NAME: &str = "Sustainable Use License 1.0";
const ABOUT_ICON: Image<'static> = tauri::include_image!("./icons/about-icon.png");

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum AppLanguage {
    Ja,
    En,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct MenuLabels {
    about: &'static str,
    settings: &'static str,
    services: &'static str,
    hide: &'static str,
    hide_others: &'static str,
    show_all: &'static str,
    quit: &'static str,
    file: &'static str,
    close_window: &'static str,
    edit: &'static str,
    undo: &'static str,
    redo: &'static str,
    cut: &'static str,
    copy: &'static str,
    paste: &'static str,
    select_all: &'static str,
    view: &'static str,
    fullscreen: &'static str,
    window: &'static str,
    minimize: &'static str,
    zoom: &'static str,
    bring_all_to_front: &'static str,
    help: &'static str,
}

const ENGLISH_LABELS: MenuLabels = MenuLabels {
    about: "About Stella",
    settings: "Settings…",
    services: "Services",
    hide: "Hide Stella",
    hide_others: "Hide Others",
    show_all: "Show All",
    quit: "Quit Stella",
    file: "File",
    close_window: "Close Window",
    edit: "Edit",
    undo: "Undo",
    redo: "Redo",
    cut: "Cut",
    copy: "Copy",
    paste: "Paste",
    select_all: "Select All",
    view: "View",
    fullscreen: "Enter Full Screen",
    window: "Window",
    minimize: "Minimize",
    zoom: "Zoom",
    bring_all_to_front: "Bring All to Front",
    help: "Help",
};

const JAPANESE_LABELS: MenuLabels = MenuLabels {
    about: "Stellaについて",
    settings: "設定…",
    services: "サービス",
    hide: "Stellaを隠す",
    hide_others: "ほかを隠す",
    show_all: "すべてを表示",
    quit: "Stellaを終了",
    file: "ファイル",
    close_window: "ウインドウを閉じる",
    edit: "編集",
    undo: "取り消す",
    redo: "やり直す",
    cut: "カット",
    copy: "コピー",
    paste: "ペースト",
    select_all: "すべてを選択",
    view: "表示",
    fullscreen: "フルスクリーンにする",
    window: "ウインドウ",
    minimize: "しまう",
    zoom: "拡大／縮小",
    bring_all_to_front: "すべてを手前に移動",
    help: "ヘルプ",
};

fn labels(language: AppLanguage) -> &'static MenuLabels {
    match language {
        AppLanguage::Ja => &JAPANESE_LABELS,
        AppLanguage::En => &ENGLISH_LABELS,
    }
}

fn about_metadata(
    name: &str,
    version: &str,
    copyright: Option<&str>,
    icon: Option<Image<'static>>,
) -> AboutMetadata<'static> {
    AboutMetadata {
        name: Some(name.to_owned()),
        short_version: Some(version.to_owned()),
        copyright: copyright.map(str::to_owned),
        credits: Some(LICENSE_NAME.to_owned()),
        icon,
        ..Default::default()
    }
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
    let about = about_metadata(
        &package.name,
        &package.version.to_string(),
        app.config().bundle.copyright.as_deref(),
        Some(ABOUT_ICON.clone()),
    );
    let settings = MenuItemBuilder::with_id(SETTINGS_MENU_ID, text.settings)
        .accelerator(SETTINGS_MENU_ACCELERATOR)
        .build(app)?;

    let app_submenu = SubmenuBuilder::new(app, "Stella")
        .about_with_text(text.about, Some(about))
        .separator()
        .item(&settings)
        .separator()
        .services_with_text(text.services)
        .separator()
        .hide_with_text(text.hide)
        .hide_others_with_text(text.hide_others)
        .show_all_with_text(text.show_all)
        .separator()
        .quit_with_text(text.quit)
        .build()?;
    let file_submenu = SubmenuBuilder::new(app, text.file)
        .close_window_with_text(text.close_window)
        .build()?;
    let edit_submenu = SubmenuBuilder::new(app, text.edit)
        .undo_with_text(text.undo)
        .redo_with_text(text.redo)
        .separator()
        .cut_with_text(text.cut)
        .copy_with_text(text.copy)
        .paste_with_text(text.paste)
        .select_all_with_text(text.select_all)
        .build()?;
    let view_submenu = SubmenuBuilder::new(app, text.view)
        .fullscreen_with_text(text.fullscreen)
        .build()?;
    let window_submenu = SubmenuBuilder::with_id(app, tauri::menu::WINDOW_SUBMENU_ID, text.window)
        .minimize_with_text(text.minimize)
        .maximize_with_text(text.zoom)
        .separator()
        .bring_all_to_front_with_text(text.bring_all_to_front)
        .build()?;
    let help_submenu = Submenu::with_id(app, tauri::menu::HELP_SUBMENU_ID, text.help, true)?;

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

pub(crate) fn handle_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    if !is_settings_event(event.id()) {
        return;
    }
    if let Err(error) = app.emit_to(SETTINGS_EVENT_TARGET, OPEN_SETTINGS_EVENT, ()) {
        eprintln!("Could not request the Stella Settings page: {error}");
    }
}

fn is_settings_event(id: &MenuId) -> bool {
    id == SETTINGS_MENU_ID
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
        assert!(!is_settings_event(&MenuId::new("quit")));
        assert_eq!(SETTINGS_MENU_ACCELERATOR, "Cmd+,");
    }

    #[test]
    fn settings_menu_emits_the_in_app_navigation_contract_to_the_main_window() {
        assert_eq!(SETTINGS_EVENT_TARGET, "main");
        assert_eq!(OPEN_SETTINGS_EVENT, "stella://open-settings");
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
        assert_eq!(labels(AppLanguage::En).settings, "Settings…");
        assert_eq!(labels(AppLanguage::Ja).settings, "設定…");
        assert_eq!(labels(AppLanguage::En).file, "File");
        assert_eq!(labels(AppLanguage::Ja).file, "ファイル");
        assert_eq!(labels(AppLanguage::En).help, "Help");
        assert_eq!(labels(AppLanguage::Ja).help, "ヘルプ");
    }

    #[test]
    fn about_metadata_includes_the_app_name_version_and_license() {
        let metadata = about_metadata(
            "Stella",
            "1.2.3-alpha.4",
            Some("© Junya Ishiguro"),
            Some(Image::new_owned(vec![0, 0, 0, 0], 1, 1)),
        );

        assert_eq!(metadata.name.as_deref(), Some("Stella"));
        assert_eq!(metadata.version, None);
        assert_eq!(metadata.short_version.as_deref(), Some("1.2.3-alpha.4"));
        assert_eq!(metadata.copyright.as_deref(), Some("© Junya Ishiguro"));
        assert_eq!(metadata.credits.as_deref(), Some(LICENSE_NAME));
        assert_eq!(metadata.icon.as_ref().map(Image::width), Some(1));
        assert_eq!(metadata.icon.as_ref().map(Image::height), Some(1));
    }
}
