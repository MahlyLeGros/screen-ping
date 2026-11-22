//! Ping queue and live-draw layer, ported from overlayQueue.ts and
//! drawOverlay.ts.
//!
//! One actor task owns all state, so the guards Electron needed for
//! interleaved async calls (`finishing`, …) come from running commands one at
//! a time. Timers post commands back to the actor and carry a generation so a
//! cancelled timer is ignored.

use crate::now_ms;
use async_trait_shim::BoxFuture;
use serde_json::{json, Value};
use std::collections::{HashSet, VecDeque};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;

pub mod async_trait_shim {
    pub type BoxFuture<'a, T> = std::pin::Pin<Box<dyn std::future::Future<Output = T> + Send + 'a>>;
}

/// The overlay window, implemented by the app.
pub trait OverlayHost: Send + Sync + 'static {
    /// Position on the chosen monitor, make top-most, show without focus.
    fn show(&self);
    /// Hide, transparent, and move off-screen.
    fn park(&self);
    /// Re-assert visibility and top-most.
    fn reinforce(&self);
    /// Keep re-asserting top-most every 800 ms (z-order guard) while true.
    fn set_keeper(&self, on: bool);
    fn opacity(&self) -> f64;
    /// Animate window opacity; resolves when done.
    fn fade(&self, from: f64, to: f64, ms: u64) -> BoxFuture<'_, ()>;
    /// Send an IPC event to the overlay renderer.
    fn send(&self, channel: &str, payload: Value);
    /// `overlay:hide` and wait for `overlay:cleared` (≤ 500 ms).
    fn clear_renderer(&self) -> BoxFuture<'_, ()>;
    fn stop_overlay_media(&self) -> BoxFuture<'_, ()>;
    /// Audio-only pings play in a separate hidden window.
    fn play_hidden_audio(&self, url: &str, delay_ms: u64);
    fn stop_hidden_audio(&self) -> BoxFuture<'_, ()>;
}

/// Where queue results go (the socket).
pub trait QueueOutput: Send + Sync + 'static {
    fn ack(&self, message_id: &str, status: &str);
    fn prepared(&self, message_id: &str, group_id: &str);
}

#[derive(Debug)]
enum Cmd {
    Enqueue(Value, bool),
    Revoke(String),
    Dismiss,
    DismissId(String),
    Ready(String),
    Failed(String),
    ScheduleStart(String, i64),
    Timer(Timer, u64, String),
    ProcessNext,
    Draw(String, Value),
    DrawIdle,
    SetServerUrl(String),
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Timer {
    Show,
    StartPrepared,
    Dismiss,
    ReadyTimeout,
    AudioEnd,
}

#[derive(Clone)]
pub struct OverlayQueue {
    tx: mpsc::UnboundedSender<Cmd>,
}

impl OverlayQueue {
    pub fn new(host: Arc<dyn OverlayHost>, output: Arc<dyn QueueOutput>, server_url: String) -> Self {
        let (tx, rx) = mpsc::unbounded_channel();
        let actor = Actor {
            host,
            output,
            tx: tx.clone(),
            server_url,
            queue: VecDeque::new(),
            showing: false,
            current: None,
            payload: None,
            prepared: false,
            was_audio_only: false,
            fully_visible: false,
            duration_ms: 3000,
            fade_in_ms: 200,
            fade_out_ms: 0,
            timer_gen: 0,
            show_timer: None,
            dismiss_timer: None,
            ready_timer: None,
            audio_timer: None,
            draw_sessions: HashSet::new(),
            draw_holding: false,
            ping_keeper: false,
            draw_keeper: false,
        };
        tokio::spawn(actor.run(rx));
        Self { tx }
    }

    fn send(&self, c: Cmd) {
        let _ = self.tx.send(c);
    }
    pub fn enqueue(&self, payload: Value, paused: bool) {
        self.send(Cmd::Enqueue(payload, paused))
    }
    pub fn revoke(&self, id: String) {
        self.send(Cmd::Revoke(id))
    }
    pub fn dismiss_current(&self) {
        self.send(Cmd::Dismiss)
    }
    pub fn dismiss(&self, id: String) {
        self.send(Cmd::DismissId(id))
    }
    pub fn overlay_ready(&self, id: String) {
        self.send(Cmd::Ready(id))
    }
    pub fn overlay_failed(&self, id: String) {
        self.send(Cmd::Failed(id))
    }
    pub fn schedule_start(&self, id: String, start_at_local: i64) {
        self.send(Cmd::ScheduleStart(id, start_at_local))
    }
    /// draw:begin / draw:stroke / draw:clear / draw:end from the socket.
    pub fn draw(&self, event: &str, payload: Value) {
        self.send(Cmd::Draw(event.to_string(), payload))
    }
    pub fn draw_idle(&self) {
        self.send(Cmd::DrawIdle)
    }
    pub fn set_server_url(&self, url: String) {
        self.send(Cmd::SetServerUrl(url))
    }
}

struct Actor {
    host: Arc<dyn OverlayHost>,
    output: Arc<dyn QueueOutput>,
    tx: mpsc::UnboundedSender<Cmd>,
    server_url: String,

    queue: VecDeque<Value>,
    showing: bool,
    current: Option<String>,
    payload: Option<Value>,
    prepared: bool,
    was_audio_only: bool,
    fully_visible: bool,
    duration_ms: u64,
    fade_in_ms: u64,
    fade_out_ms: u64,

    timer_gen: u64,
    show_timer: Option<u64>,
    dismiss_timer: Option<u64>,
    ready_timer: Option<u64>,
    audio_timer: Option<u64>,

    draw_sessions: HashSet<String>,
    draw_holding: bool,
    ping_keeper: bool,
    draw_keeper: bool,
}

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(Value::as_str).filter(|x| !x.is_empty()).map(String::from)
}

/// `readMs`: finite, non-negative, else fallback.
fn ms(v: &Value, k: &str, fallback: u64) -> u64 {
    match v.get(k).and_then(Value::as_f64) {
        Some(x) if x.is_finite() => x.max(0.0) as u64,
        _ => fallback,
    }
}

fn is_audio_only(p: &Value) -> bool {
    match p.get("mediaType").and_then(Value::as_str) {
        Some("video") | Some("image") => return false,
        _ => {}
    }
    if s(p, "audioUrl").is_some() {
        return false;
    }
    if p.get("mediaType").and_then(Value::as_str) == Some("audio") {
        return true;
    }
    let url = s(p, "mediaUrl").unwrap_or_default().to_lowercase();
    let path = url.split('?').next().unwrap_or("");
    [".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"].iter().any(|e| path.ends_with(e))
}

fn cache_bust(url: &str, id: &str) -> String {
    let sep = if url.contains('?') { '&' } else { '?' };
    format!("{url}{sep}v={}", crate::api::urlencode(id))
}

impl Actor {
    async fn run(mut self, mut rx: mpsc::UnboundedReceiver<Cmd>) {
        while let Some(cmd) = rx.recv().await {
            self.handle(cmd).await;
        }
    }

    fn full_url(&self, url: &str, id: &str) -> String {
        let abs = if url.starts_with("http") { url.to_string() } else { format!("{}{}", self.server_url, url) };
        cache_bust(&abs, id)
    }

    fn is_current(&self, id: &str) -> bool {
        self.current.as_deref() == Some(id)
    }

    fn timer(&mut self, kind: Timer, delay: Duration, id: &str) -> u64 {
        self.timer_gen += 1;
        let gen = self.timer_gen;
        let tx = self.tx.clone();
        let id = id.to_string();
        tokio::spawn(async move {
            tokio::time::sleep(delay).await;
            let _ = tx.send(Cmd::Timer(kind, gen, id));
        });
        gen
    }

    fn after(&self, delay: Duration, cmd: Cmd) {
        let tx = self.tx.clone();
        tokio::spawn(async move {
            tokio::time::sleep(delay).await;
            let _ = tx.send(cmd);
        });
    }

    fn sync_keeper(&mut self) {
        // The ping and the draw layer each hold the keeper; it runs while either does.
        self.host.set_keeper(self.ping_keeper || self.draw_keeper);
    }

    async fn handle(&mut self, cmd: Cmd) {
        match cmd {
            Cmd::SetServerUrl(u) => self.server_url = u.trim_end_matches('/').to_string(),
            Cmd::Enqueue(p, paused) => {
                let Some(id) = s(&p, "messageId") else { return };
                if paused {
                    self.output.ack(&id, "paused");
                    return;
                }
                if self.is_current(&id) || self.queue.iter().any(|q| s(q, "messageId").as_deref() == Some(&id)) {
                    return;
                }
                self.queue.push_back(p);
                self.process_next().await;
            }
            Cmd::Revoke(id) => {
                self.queue.retain(|q| s(q, "messageId").as_deref() != Some(&id));
                if self.is_current(&id) && self.showing {
                    self.finish("failed").await;
                }
            }
            Cmd::Dismiss => {
                if self.current.is_some() {
                    self.finish("delivered").await;
                }
            }
            Cmd::DismissId(id) => {
                if self.is_current(&id) {
                    self.finish("delivered").await;
                }
            }
            Cmd::Failed(id) => {
                if self.is_current(&id) {
                    self.finish("failed").await;
                }
            }
            Cmd::Ready(id) => self.on_ready(id).await,
            Cmd::ScheduleStart(id, at) => {
                if !self.is_current(&id) || !self.prepared || self.show_timer.is_some() {
                    return;
                }
                self.ready_timer = None;
                let delay = Duration::from_millis((at - now_ms()).max(0) as u64);
                self.show_timer = Some(self.timer(Timer::StartPrepared, delay, &id));
            }
            Cmd::Timer(kind, gen, id) => self.on_timer(kind, gen, id).await,
            Cmd::ProcessNext => self.process_next().await,
            Cmd::Draw(event, p) => self.on_draw(&event, p),
            Cmd::DrawIdle => {
                if self.draw_sessions.is_empty() {
                    self.maybe_park_draw();
                }
            }
        }
    }

    async fn on_timer(&mut self, kind: Timer, gen: u64, id: String) {
        let slot = match kind {
            Timer::Show | Timer::StartPrepared => &mut self.show_timer,
            Timer::Dismiss => &mut self.dismiss_timer,
            Timer::ReadyTimeout => &mut self.ready_timer,
            Timer::AudioEnd => &mut self.audio_timer,
        };
        if *slot != Some(gen) {
            return; // cancelled or superseded
        }
        *slot = None;
        match kind {
            Timer::Show => self.start(id).await,
            Timer::StartPrepared => self.start_prepared(&id).await,
            Timer::Dismiss => {
                if self.is_current(&id) {
                    self.finish("delivered").await;
                }
            }
            Timer::ReadyTimeout => {
                if self.is_current(&id) && self.showing {
                    self.finish("failed").await;
                }
            }
            Timer::AudioEnd => {
                if self.is_current(&id) {
                    self.host.stop_hidden_audio().await;
                    self.finish("delivered").await;
                }
            }
        }
    }

    async fn process_next(&mut self) {
        if self.showing || self.queue.is_empty() {
            return;
        }
        let p = self.queue.pop_front().unwrap();
        let id = s(&p, "messageId").unwrap_or_default();
        self.showing = true;
        self.current = Some(id.clone());
        self.prepared = false;
        self.payload = Some(p.clone());

        let synced = s(&p, "syncGroupId").is_some();
        let delay = if synced { 0 } else { ms(&p, "delayMs", 0) };
        if delay > 0 {
            self.show_timer = Some(self.timer(Timer::Show, Duration::from_millis(delay), &id));
        } else {
            self.start(id).await;
        }
    }

    async fn start(&mut self, id: String) {
        if !self.is_current(&id) {
            return;
        }
        let Some(p) = self.payload.clone() else { return };
        if is_audio_only(&p) && s(&p, "syncGroupId").is_none() {
            self.play_audio_only(&p, &id);
        } else {
            self.display_payload(&p, &id).await;
        }
    }

    fn play_audio_only(&mut self, p: &Value, id: &str) {
        self.was_audio_only = true;
        self.duration_ms = ms(p, "durationMs", 3000);
        self.host.park();
        self.host.send("overlay:hide", Value::Null);
        let url = self.full_url(&s(p, "mediaUrl").unwrap_or_default(), id);
        let audio_delay = ms(p, "audioDelayMs", 0);
        self.host.play_hidden_audio(&url, audio_delay);
        let total = Duration::from_millis(audio_delay + self.duration_ms);
        self.audio_timer = Some(self.timer(Timer::AudioEnd, total, id));
    }

    async fn display_payload(&mut self, p: &Value, id: &str) {
        self.was_audio_only = false;
        self.show_timer = None;

        self.host.fade(0.0, 0.0, 0).await;
        self.host.clear_renderer().await;
        if !self.is_current(id) {
            return;
        }
        // Wake the webview while still transparent.
        self.host.show();

        let media = self.full_url(&s(p, "mediaUrl").unwrap_or_default(), id);
        let audio = s(p, "audioUrl").map(|u| self.full_url(&u, id));
        self.duration_ms = ms(p, "durationMs", 3000);
        self.fade_in_ms = ms(p, "fadeInMs", 200);
        self.fade_out_ms = ms(p, "fadeOutMs", 0);

        let mut out = p.clone();
        if let Some(o) = out.as_object_mut() {
            o.insert("mediaUrl".into(), json!(media));
            match audio {
                Some(a) => o.insert("audioUrl".into(), json!(a)),
                None => o.remove("audioUrl"),
            };
            o.insert("fadeInMs".into(), json!(self.fade_in_ms));
            o.insert("fadeOutMs".into(), json!(self.fade_out_ms));
        }
        self.host.send("overlay:show", out);
        let timeout = if s(p, "syncGroupId").is_some() { 650_000 } else { 15_000 };
        self.ready_timer = Some(self.timer(Timer::ReadyTimeout, Duration::from_millis(timeout), id));
    }

    async fn on_ready(&mut self, id: String) {
        if !self.is_current(&id) || self.prepared || !self.showing {
            return;
        }
        self.prepared = true;
        if let Some(group) = self.payload.as_ref().and_then(|p| s(p, "syncGroupId")) {
            self.output.prepared(&id, &group);
            return;
        }
        self.start_prepared(&id).await;
    }

    async fn start_prepared(&mut self, id: &str) {
        if !self.is_current(id) {
            return;
        }
        self.ready_timer = None;
        self.host.show();
        self.host.send("overlay:start", json!({ "messageId": id }));
        self.host.fade(0.0, 1.0, self.fade_in_ms).await;
        if !self.is_current(id) || !self.showing {
            return;
        }
        self.fully_visible = true;
        self.ping_keeper = true;
        self.sync_keeper();
        self.dismiss_timer = Some(self.timer(Timer::Dismiss, Duration::from_millis(self.duration_ms), id));
    }

    async fn finish(&mut self, status: &str) {
        if !self.showing {
            return;
        }
        self.ping_keeper = false;
        self.sync_keeper();
        self.ready_timer = None;
        self.show_timer = None;
        self.dismiss_timer = None;
        self.audio_timer = None;

        let host = self.host.clone();
        tokio::join!(host.stop_overlay_media(), host.stop_hidden_audio());
        if let Some(id) = self.current.take() {
            self.output.ack(&id, status);
        }

        if !self.was_audio_only {
            if self.draw_active() {
                self.host.clear_renderer().await;
            } else {
                let from = self.host.opacity();
                self.host.fade(from, 0.0, self.fade_out_ms).await;
                self.host.clear_renderer().await;
            }
        }
        self.fully_visible = false;
        self.fade_in_ms = 200;
        self.fade_out_ms = 0;
        self.payload = None;
        self.prepared = false;
        self.was_audio_only = false;
        self.showing = false;
        // drawOverlay.setPingShowing(false)
        self.maybe_park_draw();
        if !self.draw_active() {
            self.host.park();
        }
        self.after(Duration::from_millis(50), Cmd::ProcessNext);
    }

    // ----- live draw (drawOverlay.ts) -----------------------------------

    fn draw_active(&self) -> bool {
        !self.draw_sessions.is_empty()
    }

    fn on_draw(&mut self, event: &str, p: Value) {
        let session = s(&p, "sessionId").unwrap_or_default();
        match event {
            "draw:begin" | "draw:stroke" => {
                self.draw_sessions.insert(session);
                self.ensure_draw_visible();
            }
            "draw:end" => {
                self.draw_sessions.remove(&session);
                // Keep the overlay up while the trail fades; park on draw:idle.
            }
            _ => {}
        }
        self.host.send(event, p);
    }

    fn ensure_draw_visible(&mut self) {
        if self.showing {
            self.host.reinforce();
            return;
        }
        self.host.show();
        if self.host.opacity() < 1.0 {
            let host = self.host.clone();
            tokio::spawn(async move { host.fade(1.0, 1.0, 0).await });
        }
        self.draw_holding = true;
        self.draw_keeper = true;
        self.sync_keeper();
    }

    fn maybe_park_draw(&mut self) {
        if self.showing || self.draw_active() || !self.draw_holding {
            return;
        }
        self.draw_keeper = false;
        self.sync_keeper();
        self.host.park();
        self.draw_holding = false;
    }
}
