#![forbid(unsafe_code)]

fn main() {
    println!("cargo:rerun-if-changed=icons/about-icon.png");
    println!("cargo:rerun-if-changed=icons/icon-dev.icns");
    tauri_build::build()
}
