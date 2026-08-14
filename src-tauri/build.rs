#![forbid(unsafe_code)]

fn main() {
    println!("cargo:rerun-if-changed=icons/about-icon.png");
    println!("cargo:rerun-if-changed=icons/icon.png");
    tauri_build::build()
}
