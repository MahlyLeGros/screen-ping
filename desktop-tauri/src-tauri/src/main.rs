#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    screen_ping_tauri_proto::run();
}
