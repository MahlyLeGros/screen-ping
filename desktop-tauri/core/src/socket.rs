//! Socket.IO connection, ported from socketClient.ts and the reconnect /
//! watchdog logic in main.ts.
//!
//! One supervisor task owns the connection. It (re)connects with a fresh
//! token, detects dead transports with a `clock:sync` liveness probe, and
//! backs off 1 s → 10 s like the Electron client.

use crate::api::{Api, RefreshResult};
use crate::now_ms;
use futures_util::FutureExt;
use rust_socketio::asynchronous::{Client, ClientBuilder, ReconnectSettings};
use rust_socketio::{Event, Payload, TransportType};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Weak};
use std::time::Duration;
use tokio::sync::{Mutex, Notify};

/// What the app does with socket events. All callbacks must return quickly.
pub trait SocketEvents: Send + Sync + 'static {
    fn on_status(&self, connected: bool);
    fn on_deliver(&self, payload: Value);
    fn on_revoke(&self, message_id: String);
    /// `start_at_local` is in this machine's epoch ms.
    fn on_start(&self, message_id: String, start_at_local: i64);
    fn on_draw(&self, event: &str, payload: Value);
    fn on_presence(&self, payload: Value);
    fn on_friends_update(&self, payload: Value);
    fn on_update_check(&self) {}
    fn on_session_expired(&self);
    /// Seconds since the last keyboard/mouse input.
    fn idle_seconds(&self) -> u64;
}

const HEARTBEAT: Duration = Duration::from_secs(30);
const PROBE_EVERY: Duration = Duration::from_secs(10);

struct Inner {
    api: Api,
    events: Arc<dyn SocketEvents>,
    app_version: String,
    client: Mutex<Option<Client>>,
    /// Socket.IO CONNECT acknowledged by the server.
    connected: AtomicBool,
    /// Server rejected the handshake (bad/expired token).
    rejected: AtomicBool,
    /// Server closed the namespace ("io server disconnect").
    closed: AtomicBool,
    /// A transport error was seen; probe right away.
    suspect: AtomicBool,
    enabled: AtomicBool,
    /// Bumped on every new client so stale callbacks are ignored.
    generation: AtomicU64,
    clock_offset: AtomicI64,
    wake: Notify,
}

#[derive(Clone)]
pub struct SocketManager {
    inner: Arc<Inner>,
}

impl SocketManager {
    pub fn new(api: Api, events: Arc<dyn SocketEvents>, app_version: &str) -> Self {
        let inner = Arc::new(Inner {
            api,
            events,
            app_version: app_version.to_string(),
            client: Mutex::new(None),
            connected: AtomicBool::new(false),
            rejected: AtomicBool::new(false),
            closed: AtomicBool::new(false),
            suspect: AtomicBool::new(false),
            enabled: AtomicBool::new(false),
            generation: AtomicU64::new(0),
            clock_offset: AtomicI64::new(0),
            wake: Notify::new(),
        });
        tokio::spawn(supervise(Arc::downgrade(&inner)));
        Self { inner }
    }

    pub fn is_connected(&self) -> bool {
        self.inner.connected.load(Ordering::SeqCst)
    }

    /// Start (or keep) the connection.
    pub fn connect(&self) {
        self.inner.enabled.store(true, Ordering::SeqCst);
        self.inner.wake.notify_one();
    }

    /// Drop the current connection and dial again right away.
    pub async fn reconnect(&self) {
        self.inner.enabled.store(true, Ordering::SeqCst);
        drop_client(&self.inner).await;
        self.inner.wake.notify_one();
    }

    pub async fn disconnect(&self) {
        self.inner.enabled.store(false, Ordering::SeqCst);
        drop_client(&self.inner).await;
        self.inner.wake.notify_one();
    }

    async fn emit(&self, event: &str, data: Value) -> Result<(), String> {
        let client = self.inner.client.lock().await.clone();
        match client {
            Some(c) if self.is_connected() => c.emit(event, data).await.map_err(|e| e.to_string()),
            _ => Err("Not connected — reconnect and try again".into()),
        }
    }

    pub async fn ack_message(&self, message_id: &str, status: &str) {
        let _ = self.emit("message:ack", json!({ "messageId": message_id, "status": status })).await;
    }

    pub async fn prepared_message(&self, message_id: &str, group_id: &str) {
        let _ = self.emit("message:ready", json!({ "messageId": message_id, "groupId": group_id })).await;
    }

    /// `sendMessage` in socketClient.ts, with the same defaults.
    pub async fn send_message(&self, p: &Value) -> Result<(), String> {
        let num = |k: &str, d: i64| p.get(k).and_then(Value::as_i64).unwrap_or(d);
        let layout = p
            .get("layout")
            .cloned()
            .filter(|v| !v.is_null())
            .unwrap_or_else(|| json!({ "x": 0, "y": 0, "width": 100, "height": 100, "rotation": 0, "objectFit": "contain" }));
        self.emit(
            "message:send",
            json!({
                "receiverId": p.get("receiverId"),
                "messageId": p.get("messageId"),
                "durationMs": num("durationMs", 3000),
                "delayMs": num("delayMs", 0),
                "audioDelayMs": num("audioDelayMs", 0),
                "fadeInMs": num("fadeInMs", 200),
                "fadeOutMs": num("fadeOutMs", 0),
                "layout": layout,
            }),
        )
        .await
    }
}

async fn drop_client(inner: &Arc<Inner>) {
    inner.generation.fetch_add(1, Ordering::SeqCst);
    let old = inner.client.lock().await.take();
    if inner.connected.swap(false, Ordering::SeqCst) {
        inner.events.on_status(false);
    }
    if let Some(c) = old {
        let _ = tokio::time::timeout(Duration::from_secs(2), c.disconnect()).await;
    }
}

fn auth_payload(token: &str, version: &str) -> Value {
    json!({
        "token": token,
        "client_type": "desktop",
        "app_version": version,
        "delivery_sync": 1,
        "long_video": 1,
    })
}

fn first_arg(payload: Payload) -> Value {
    match payload {
        Payload::Text(mut v) if !v.is_empty() => v.swap_remove(0),
        #[allow(deprecated)]
        Payload::String(s) => serde_json::from_str(&s).unwrap_or(Value::Null),
        _ => Value::Null,
    }
}

async fn build_client(inner: &Arc<Inner>, token: &str, transport: TransportType) -> Result<Client, String> {
    let gen = inner.generation.fetch_add(1, Ordering::SeqCst) + 1;
    inner.rejected.store(false, Ordering::SeqCst);
    inner.closed.store(false, Ordering::SeqCst);
    let weak = Arc::downgrade(inner);
    let auth = auth_payload(token, &inner.app_version);

    // Only acts if this callback belongs to the live client.
    let live = move |w: &Weak<Inner>| -> Option<Arc<Inner>> {
        let i = w.upgrade()?;
        (i.generation.load(Ordering::SeqCst) == gen).then_some(i)
    };

    let (w1, w2, w3, w4, w5) = (weak.clone(), weak.clone(), weak.clone(), weak.clone(), weak.clone());
    let url = inner.api.store.server_url();
    ClientBuilder::new(url)
        .transport_type(transport)
        // The library re-dials a lost transport (1 s → 10 s, like Electron);
        // we hand it a fresh token each time.
        .reconnect(true)
        .reconnect_on_disconnect(true)
        .reconnect_delay(1000, 10_000)
        .on_reconnect(move || {
            let w = w5.clone();
            async move {
                let mut settings = ReconnectSettings::new();
                let Some(i) = live(&w) else { return settings };
                if i.connected.swap(false, Ordering::SeqCst) {
                    i.events.on_status(false);
                }
                // "io server disconnect" usually means the token was revoked.
                if i.closed.swap(false, Ordering::SeqCst) {
                    let _ = i.api.refresh_access_token().await;
                }
                if let Some(t) = i.api.store.access_token() {
                    settings.auth(auth_payload(&t, &i.app_version));
                }
                settings
            }
            .boxed()
        })
        .auth(auth)
        .on(Event::Connect, move |_, _| {
            let w = w1.clone();
            async move {
                if let Some(i) = live(&w) {
                    i.connected.store(true, Ordering::SeqCst);
                    i.events.on_status(true);
                    i.wake.notify_one();
                }
            }
            .boxed()
        })
        .on(Event::Close, move |_, _| {
            let w = w2.clone();
            async move {
                if let Some(i) = live(&w) {
                    i.closed.store(true, Ordering::SeqCst);
                    if i.connected.swap(false, Ordering::SeqCst) {
                        i.events.on_status(false);
                    }
                    i.wake.notify_one();
                }
            }
            .boxed()
        })
        .on(Event::Error, move |payload, _| {
            let w = w3.clone();
            async move {
                if let Some(i) = live(&w) {
                    let text = format!("{payload:?}");
                    if text.contains("ConnectError") {
                        i.rejected.store(true, Ordering::SeqCst);
                    } else {
                        i.suspect.store(true, Ordering::SeqCst);
                    }
                    i.wake.notify_one();
                }
            }
            .boxed()
        })
        .on_any(move |event, payload, _| {
            let w = w4.clone();
            async move {
                let Some(i) = live(&w) else { return };
                let name = event.as_str().to_string();
                let data = first_arg(payload);
                let ev = &i.events;
                match name.as_str() {
                    "message:deliver" => ev.on_deliver(data),
                    "message:revoke" => {
                        if let Some(id) = data.get("messageId").and_then(Value::as_str) {
                            ev.on_revoke(id.to_string());
                        }
                    }
                    "message:start" => {
                        let id = data.get("messageId").and_then(Value::as_str);
                        let at = data.get("startAt").and_then(Value::as_f64);
                        if let (Some(id), Some(at)) = (id, at) {
                            let local = at as i64 - i.clock_offset.load(Ordering::SeqCst);
                            ev.on_start(id.to_string(), local);
                        }
                    }
                    "draw:begin" | "draw:stroke" | "draw:clear" | "draw:end" => ev.on_draw(&name, data),
                    "presence:update" => ev.on_presence(data),
                    "friends:update" => ev.on_friends_update(data),
                    "desktop:update-check" => ev.on_update_check(),
                    _ => {}
                }
            }
            .boxed()
        })
        .connect()
        .await
        .map_err(|e| e.to_string())
}

/// `clock:sync` round trip. Returns (server_now, sent_at, received_at).
async fn clock_sync(client: &Client, timeout: Duration) -> Option<(i64, i64, i64)> {
    let (tx, rx) = tokio::sync::oneshot::channel::<i64>();
    let tx = Arc::new(std::sync::Mutex::new(Some(tx)));
    let sent = now_ms();
    let tx2 = tx.clone();
    client
        .emit_with_ack("clock:sync", json!({}), timeout, move |payload: Payload, _| {
            let tx = tx2.clone();
            async move {
                if let Some(now) = first_arg(payload).get("serverNow").and_then(Value::as_f64) {
                    if let Some(tx) = tx.lock().unwrap().take() {
                        let _ = tx.send(now as i64);
                    }
                }
            }
            .boxed()
        })
        .await
        .ok()?;
    let server_now = tokio::time::timeout(timeout, rx).await.ok()?.ok()?;
    Some((server_now, sent, now_ms()))
}

async fn sync_clock(inner: &Arc<Inner>, client: &Client) {
    let mut best = i64::MAX;
    for _ in 0..3 {
        if let Some((server_now, sent, recv)) = clock_sync(client, Duration::from_secs(5)).await {
            let rtt = recv - sent;
            if rtt < best {
                best = rtt;
                inner.clock_offset.store(server_now - (sent + recv) / 2, Ordering::SeqCst);
            }
        }
    }
}

async fn heartbeat(inner: &Arc<Inner>, client: &Client) {
    let idle = inner.events.idle_seconds();
    let _ = client.emit("presence:heartbeat", json!({ "idleSeconds": idle })).await;
}

/// Wait for CONNECT / CONNECT_ERROR after the transport opened.
async fn await_handshake(inner: &Arc<Inner>) -> bool {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    loop {
        if inner.connected.load(Ordering::SeqCst) {
            return true;
        }
        if inner.rejected.load(Ordering::SeqCst) || tokio::time::Instant::now() >= deadline {
            return false;
        }
        let _ = tokio::time::timeout(Duration::from_millis(200), inner.wake.notified()).await;
    }
}

async fn supervise(weak: Weak<Inner>) {
    let mut backoff = Duration::from_secs(1);
    let mut prefer_websocket = true;
    loop {
        let Some(inner) = weak.upgrade() else { return };

        let enabled = inner.enabled.load(Ordering::SeqCst);
        let token = inner.api.store.access_token();
        if !enabled || token.is_none() {
            drop_client(&inner).await;
            let _ = tokio::time::timeout(Duration::from_secs(5), inner.wake.notified()).await;
            continue;
        }

        let transport = if prefer_websocket { TransportType::Websocket } else { TransportType::Polling };
        let client = match build_client(&inner, token.as_deref().unwrap(), transport).await {
            Ok(c) => c,
            Err(e) => {
                log::warn!("socket connect failed: {e}");
                prefer_websocket = !prefer_websocket;
                // A refused handshake can also mean an expired token.
                if refresh_or_expire(&inner).await {
                    return_after(&inner, &mut backoff).await;
                }
                continue;
            }
        };
        *inner.client.lock().await = Some(client.clone());

        if !await_handshake(&inner).await {
            drop_client(&inner).await;
            if refresh_or_expire(&inner).await {
                return_after(&inner, &mut backoff).await;
            }
            continue;
        }

        backoff = Duration::from_secs(1);
        let gen = inner.generation.load(Ordering::SeqCst);
        sync_clock(&inner, &client).await;
        heartbeat(&inner, &client).await;

        // Connected: heartbeat + liveness probe until something breaks.
        let mut last_heartbeat = tokio::time::Instant::now();
        let mut misses = 0;
        let mut offline_ticks = 0;
        let mut was_connected = true;
        loop {
            let _ = tokio::time::timeout(PROBE_EVERY, inner.wake.notified()).await;
            if inner.generation.load(Ordering::SeqCst) != gen
                || !inner.enabled.load(Ordering::SeqCst)
                || inner.rejected.load(Ordering::SeqCst)
            {
                break;
            }
            if !inner.connected.load(Ordering::SeqCst) {
                // The library is re-dialing. Give it ~1 min, then start over.
                was_connected = false;
                offline_ticks += 1;
                if offline_ticks >= 6 {
                    break;
                }
                continue;
            }
            if !was_connected {
                was_connected = true;
                offline_ticks = 0;
                misses = 0;
                sync_clock(&inner, &client).await;
                heartbeat(&inner, &client).await;
                last_heartbeat = tokio::time::Instant::now();
                continue;
            }
            if last_heartbeat.elapsed() >= HEARTBEAT {
                heartbeat(&inner, &client).await;
                last_heartbeat = tokio::time::Instant::now();
            }
            let suspect = inner.suspect.swap(false, Ordering::SeqCst);
            if clock_sync(&client, Duration::from_secs(if suspect { 3 } else { 5 })).await.is_some() {
                misses = 0;
            } else {
                misses += 1;
                if suspect || misses >= 2 {
                    log::warn!("socket liveness probe failed twice; reconnecting");
                    break;
                }
            }
        }

        let rejected = inner.rejected.load(Ordering::SeqCst);
        if inner.generation.load(Ordering::SeqCst) == gen {
            drop_client(&inner).await;
        }
        if rejected && inner.enabled.load(Ordering::SeqCst) {
            // A re-dial was refused (token revoked or expired): refresh first.
            if refresh_or_expire(&inner).await {
                return_after(&inner, &mut backoff).await;
            }
        }
    }
}

/// Returns false when the session is gone (caller should not retry soon).
async fn refresh_or_expire(inner: &Arc<Inner>) -> bool {
    match inner.api.refresh_access_token().await {
        RefreshResult::Unauthorized => {
            inner.enabled.store(false, Ordering::SeqCst);
            inner.events.on_session_expired();
            false
        }
        _ => true,
    }
}

async fn return_after(inner: &Arc<Inner>, backoff: &mut Duration) {
    let _ = tokio::time::timeout(*backoff, inner.wake.notified()).await;
    *backoff = (*backoff * 2).min(Duration::from_secs(10));
}
