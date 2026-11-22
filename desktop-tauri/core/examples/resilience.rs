//! Prints socket status changes for 60 s; restart the server meanwhile.
use screenping_core::settings::{PlainSecretBox, Settings, SettingsStore};
use screenping_core::socket::{SocketEvents, SocketManager};
use screenping_core::Api;
use serde_json::Value;
use std::sync::Arc;

struct E(std::time::Instant);
impl SocketEvents for E {
    fn on_status(&self, c: bool) { println!("{:>5.1}s connected={c}", self.0.elapsed().as_secs_f32()) }
    fn on_deliver(&self, _: Value) {}
    fn on_revoke(&self, _: String) {}
    fn on_start(&self, _: String, _: i64) {}
    fn on_draw(&self, _: &str, _: Value) {}
    fn on_presence(&self, _: Value) {}
    fn on_friends_update(&self, _: Value) {}
    fn on_session_expired(&self) { println!("EXPIRED") }
    fn idle_seconds(&self) -> u64 { 0 }
}

#[tokio::main]
async fn main() {
    let server = std::env::var("SP_SERVER").unwrap_or("http://127.0.0.1:8765".into());
    let api = Api::new(SettingsStore::in_memory(Settings { server_url: server, ..Default::default() }, Arc::new(PlainSecretBox)), "1.0.66");
    api.login("alice", "pass1234", true).await.unwrap();
    let s = SocketManager::new(api, Arc::new(E(std::time::Instant::now())), "1.0.66");
    s.connect();
    tokio::time::sleep(std::time::Duration::from_secs(60)).await;
}
