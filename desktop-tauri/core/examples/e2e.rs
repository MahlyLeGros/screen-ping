//! End-to-end check against a running server (not part of the app).
//!
//!   SP_SERVER=http://127.0.0.1:8765 cargo run --example e2e
//!
//! Needs two accepted friends `alice` / `bob` with password `pass1234`.
//! alice is the receiver (real socket + real overlay queue, fake window);
//! bob uploads an image and sends it to alice.

use screenping_core::overlay::{async_trait_shim::BoxFuture, OverlayHost, OverlayQueue, QueueOutput};
use screenping_core::settings::{PlainSecretBox, Settings, SettingsStore};
use screenping_core::socket::{SocketEvents, SocketManager};
use screenping_core::Api;
use serde_json::Value;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

type Log = Arc<Mutex<Vec<String>>>;

struct Host {
    log: Log,
    queue: OnceLock<OverlayQueue>,
}
impl OverlayHost for Host {
    fn show(&self) { self.log.lock().unwrap().push("show".into()) }
    fn park(&self) { self.log.lock().unwrap().push("park".into()) }
    fn reinforce(&self) {}
    fn set_keeper(&self, on: bool) { self.log.lock().unwrap().push(format!("keeper:{on}")) }
    fn opacity(&self) -> f64 { 1.0 }
    fn fade(&self, from: f64, to: f64, ms: u64) -> BoxFuture<'_, ()> {
        self.log.lock().unwrap().push(format!("fade:{from}->{to}/{ms}"));
        Box::pin(async move { tokio::time::sleep(Duration::from_millis(ms)).await })
    }
    fn send(&self, channel: &str, payload: Value) {
        self.log.lock().unwrap().push(format!("send:{channel}"));
        if channel == "overlay:show" {
            let id = payload["messageId"].as_str().unwrap().to_string();
            let url = payload["mediaUrl"].as_str().unwrap_or("").to_string();
            self.log.lock().unwrap().push(format!("mediaUrl:{url}"));
            let q = self.queue.get().unwrap().clone();
            tokio::spawn(async move {
                // The renderer preloads the media, then reports ready.
                let ok = reqwest::get(&url).await.map(|r| r.status().is_success()).unwrap_or(false);
                if ok { q.overlay_ready(id) } else { q.overlay_failed(id) }
            });
        }
    }
    fn clear_renderer(&self) -> BoxFuture<'_, ()> { Box::pin(async {}) }
    fn stop_overlay_media(&self) -> BoxFuture<'_, ()> { Box::pin(async {}) }
    fn play_hidden_audio(&self, _url: &str, _delay_ms: u64) {}
    fn stop_hidden_audio(&self) -> BoxFuture<'_, ()> { Box::pin(async {}) }
}

struct Events {
    name: &'static str,
    log: Log,
    queue: OnceLock<OverlayQueue>,
}
impl SocketEvents for Events {
    fn on_status(&self, c: bool) { self.log.lock().unwrap().push(format!("{}:status:{c}", self.name)) }
    fn on_deliver(&self, p: Value) {
        self.log.lock().unwrap().push(format!("{}:deliver:{}", self.name, p["mediaType"]));
        if let Some(q) = self.queue.get() { q.enqueue(p, false) }
    }
    fn on_revoke(&self, id: String) { self.log.lock().unwrap().push(format!("{}:revoke:{id}", self.name)) }
    fn on_start(&self, id: String, at: i64) {
        self.log.lock().unwrap().push(format!("{}:start in {}ms", self.name, at - screenping_core::now_ms()));
        if let Some(q) = self.queue.get() { q.schedule_start(id, at) }
    }
    fn on_draw(&self, e: &str, _p: Value) { self.log.lock().unwrap().push(format!("{}:{e}", self.name)) }
    fn on_presence(&self, _p: Value) {}
    fn on_friends_update(&self, _p: Value) {}
    fn on_session_expired(&self) { self.log.lock().unwrap().push(format!("{}:EXPIRED", self.name)) }
    fn idle_seconds(&self) -> u64 { 0 }
}

struct Out { socket: OnceLock<SocketManager>, log: Log }
impl QueueOutput for Out {
    fn ack(&self, id: &str, status: &str) {
        self.log.lock().unwrap().push(format!("ack:{status}"));
        let s = self.socket.get().unwrap().clone();
        let (id, status) = (id.to_string(), status.to_string());
        tokio::spawn(async move { s.ack_message(&id, &status).await });
    }
    fn prepared(&self, id: &str, group: &str) {
        self.log.lock().unwrap().push("prepared".into());
        let s = self.socket.get().unwrap().clone();
        let (id, group) = (id.to_string(), group.to_string());
        tokio::spawn(async move { s.prepared_message(&id, &group).await });
    }
}

fn api(server: &str) -> Api {
    let settings = Settings { server_url: server.into(), ..Default::default() };
    Api::new(SettingsStore::in_memory(settings, Arc::new(PlainSecretBox)), "1.0.66")
}

async fn wait_for(log: &Log, needle: &str, secs: u64) -> bool {
    for _ in 0..secs * 10 {
        if log.lock().unwrap().iter().any(|l| l.contains(needle)) { return true }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    false
}

fn check(ok: bool, what: &str, log: &Log) {
    if ok { println!("PASS {what}") } else {
        println!("FAIL {what}\n  log: {:?}", log.lock().unwrap());
        std::process::exit(1);
    }
}

#[tokio::main]
async fn main() {
    let server = std::env::var("SP_SERVER").unwrap_or("http://127.0.0.1:8765".into());
    let log: Log = Default::default();

    // --- receiver: alice -------------------------------------------------
    let alice = api(&server);
    alice.login("alice", "pass1234", true).await.expect("alice login");
    check(alice.store.refresh_token().is_some(), "login stores refresh token", &log);
    let before = alice.store.access_token();
    let refreshed = alice.refresh_access_token().await.is_ok();
    check(refreshed && alice.store.access_token().is_some(), "POST /api/auth/refresh", &log);
    let _ = before;
    let me = alice.fetch_me().await.expect("me");
    check(me["username"] == "alice", "GET /api/auth/me", &log);
    let friends = alice.list_friends().await.expect("friends");
    check(friends.as_array().map(|a| a.len()) == Some(1), "GET /api/friends", &log);

    // Start with a bad access token: the handshake is refused, the client
    // must refresh and connect anyway.
    alice.store.update(|s| s.access_token = Some("bogus".into()));

    let host = Arc::new(Host { log: log.clone(), queue: OnceLock::new() });
    let out = Arc::new(Out { socket: OnceLock::new(), log: log.clone() });
    let queue = OverlayQueue::new(host.clone(), out.clone(), server.clone());
    let _ = host.queue.set(queue.clone());
    let events = Arc::new(Events { name: "alice", log: log.clone(), queue: OnceLock::new() });
    let _ = events.queue.set(queue.clone());
    let sock = SocketManager::new(alice.clone(), events.clone(), "1.0.66");
    let _ = out.socket.set(sock.clone());
    sock.connect();
    check(wait_for(&log, "alice:status:true", 20).await, "socket connects after refusing a bad token", &log);

    // --- sender: bob -----------------------------------------------------
    let bob = api(&server);
    bob.login("bob", "pass1234", true).await.expect("bob login");
    let bob_events = Arc::new(Events { name: "bob", log: log.clone(), queue: OnceLock::new() });
    let bob_sock = SocketManager::new(bob.clone(), bob_events, "1.0.66");
    bob_sock.connect();
    check(wait_for(&log, "bob:status:true", 20).await, "sender socket connects", &log);

    let png = std::env::temp_dir().join("sp-e2e.png");
    std::fs::write(&png, include_bytes!("../../../desktop/assets/icon-48.png")).unwrap();
    let uploads = bob
        .upload_media(&[me["id"].as_str().unwrap().to_string()], png.to_str().unwrap(), Some("hello"), None)
        .await
        .expect("upload");
    let mid = uploads[0]["message_id"].as_str().unwrap().to_string();
    check(!mid.is_empty(), "POST /api/media/upload", &log);

    bob_sock
        .send_message(&serde_json::json!({ "receiverId": me["id"], "messageId": mid, "durationMs": 1500 }))
        .await
        .expect("send");

    check(wait_for(&log, "alice:deliver", 10).await, "receiver gets message:deliver", &log);
    check(wait_for(&log, "send:overlay:show", 5).await, "queue sends overlay:show", &log);
    check(wait_for(&log, "send:overlay:start", 15).await, "media loads and overlay starts", &log);
    check(wait_for(&log, "ack:delivered", 10).await, "ping ends and is acked as delivered", &log);
    check(wait_for(&log, "park", 3).await, "overlay parked after the ping", &log);

    // Reconnect keeps working.
    log.lock().unwrap().clear();
    sock.reconnect().await;
    check(wait_for(&log, "alice:status:true", 20).await, "manual reconnect", &log);

    // Revoked session: refused handshake + refused refresh => session expired.
    log.lock().unwrap().clear();
    alice.revoke_current_session().await;
    alice.store.update(|s| s.access_token = Some("bogus".into()));
    sock.reconnect().await;
    check(wait_for(&log, "alice:EXPIRED", 25).await, "revoked session reports expiry", &log);

    println!("\nfull log was OK");
}
