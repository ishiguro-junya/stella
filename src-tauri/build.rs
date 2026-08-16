#![forbid(unsafe_code)]

use std::path::Path;
use std::process::Command;

fn git_output(repository: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repository)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn main() {
    let repository = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("リポジトリのパスを取得できませんでした");
    if let Some(head_log) = git_output(repository, &["rev-parse", "--git-path", "logs/HEAD"]) {
        let head_log = Path::new(&head_log);
        let head_log = if head_log.is_relative() {
            repository.join(head_log)
        } else {
            head_log.to_owned()
        };
        println!("cargo:rerun-if-changed={}", head_log.display());
    }
    if let Some(commit) = git_output(repository, &["rev-parse", "--short=7", "HEAD"]) {
        println!("cargo:rustc-env=STELLA_COMMIT={commit}");
    }
    if let Ok(output) = Command::new("/bin/date").arg("+%Y/%m/%d").output()
        && output.status.success()
    {
        println!(
            "cargo:rustc-env=STELLA_BUILD_DATE={}",
            String::from_utf8_lossy(&output.stdout).trim()
        );
    }
    println!("cargo:rerun-if-changed=icons/about-icon.png");
    println!("cargo:rerun-if-changed=icons/icon.png");
    tauri_build::build()
}
