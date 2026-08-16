use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

const LOGO_CANDIDATES: &[&str] = &[
    "logo.svg",
    "logo.png",
    "logo.webp",
    "logo.jpg",
    "logo.jpeg",
    ".stella/logo.svg",
    ".stella/logo.png",
    ".github/logo.svg",
    ".github/logo.png",
    "docs/logo.svg",
    "docs/logo.png",
    "src-tauri/icons/128x128.png",
];

fn find_repository_logo(root: &Path) -> Option<PathBuf> {
    let canonical_root = fs::canonicalize(root).ok()?;
    LOGO_CANDIDATES.iter().find_map(|relative| {
        let candidate = fs::canonicalize(canonical_root.join(relative)).ok()?;
        (candidate.starts_with(&canonical_root) && candidate.is_file()).then_some(candidate)
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn repository_logo(app: tauri::AppHandle, path: String) -> Option<String> {
    let logo = find_repository_logo(Path::new(&path))?;
    app.asset_protocol_scope().allow_file(&logo).ok()?;
    Some(logo.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_first_supported_logo_without_leaving_the_repository() {
        let repository = tempfile::tempdir().unwrap();
        fs::create_dir(repository.path().join(".github")).unwrap();
        fs::write(repository.path().join(".github/logo.png"), b"png").unwrap();
        fs::write(repository.path().join("logo.svg"), b"svg").unwrap();

        assert_eq!(
            find_repository_logo(repository.path()),
            fs::canonicalize(repository.path().join("logo.svg")).ok()
        );
    }

    #[test]
    fn returns_none_when_the_repository_has_no_supported_logo() {
        let repository = tempfile::tempdir().unwrap();
        assert_eq!(find_repository_logo(repository.path()), None);
    }

    #[test]
    fn uses_a_tauri_app_icon_as_a_repository_logo() {
        let repository = tempfile::tempdir().unwrap();
        let icons = repository.path().join("src-tauri/icons");
        fs::create_dir_all(&icons).unwrap();
        fs::write(icons.join("128x128.png"), b"png").unwrap();

        assert_eq!(
            find_repository_logo(repository.path()),
            fs::canonicalize(icons.join("128x128.png")).ok()
        );
    }
}
