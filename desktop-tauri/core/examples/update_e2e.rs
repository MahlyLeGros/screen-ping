//! Update flow against a mock update server (not part of the app).
//!
//!   SP_SERVER=http://127.0.0.1:8790 SP_UPDATE_KEY=<spki b64> cargo run --example update_e2e
//!
//! The server offers 1.1.0 to 1.0.73 with a feed, an installer and a `.sig`
//! made by sign-update.js; `/bad/...` serves the same with a wrong signature.

use screenping_core::updater::{UpdateStatus, Updater};
use std::sync::{Arc, Mutex};

#[tokio::main]
async fn main() {
    let server = std::env::var("SP_SERVER").unwrap_or_else(|_| "http://127.0.0.1:8790".into());
    let key = std::env::var("SP_UPDATE_KEY").expect("SP_UPDATE_KEY");
    let dir = std::env::temp_dir().join("sp-update-e2e");
    let _ = std::fs::remove_dir_all(&dir);
    let mut ok = true;
    let mut check = |cond: bool, what: &str| {
        println!("{} {what}", if cond { "PASS" } else { "FAIL" });
        ok &= cond;
    };

    // Good update.
    let s = server.clone();
    let up = Updater::new("1.0.73", dir.clone(), move || s.clone()).with_public_key(&key);
    let seen = Arc::new(Mutex::new(Vec::<String>::new()));
    let log = seen.clone();
    up.set_listener(move |st| {
        let v = serde_json::to_value(st).unwrap();
        log.lock().unwrap().push(v["state"].as_str().unwrap().to_string());
    });
    let ready = up.check_and_download().await;
    check(ready, "1.0.73 downloads and verifies 1.1.0");
    check(up.outdated_target().as_deref() == Some("1.1.0"), "outdated target is 1.1.0");
    let states = seen.lock().unwrap().clone();
    check(
        states.first().map(String::as_str) == Some("checking")
            && states.contains(&"available".to_string())
            && states.contains(&"downloading".to_string())
            && states.last().map(String::as_str) == Some("ready"),
        &format!("status goes checking → available → downloading → ready ({})", states.join(",")),
    );
    let installer = up.ready_installer().map(|(_, p)| p);
    check(
        installer.as_ref().is_some_and(|p| p.file_name().unwrap() == "Screen Ping Setup 1.1.0.exe" && p.exists()),
        "installer saved under its published name",
    );

    // Current version: nothing to do.
    let s = server.clone();
    let cur = Updater::new("1.1.0", dir.join("cur"), move || s.clone()).with_public_key(&key);
    check(!cur.check_and_download().await && cur.status() == UpdateStatus::UpToDate, "1.1.0 is up to date");

    // Wrong signature: refused, file removed.
    let s = format!("{server}/bad");
    let bad = Updater::new("1.0.73", dir.join("bad"), move || s.clone()).with_public_key(&key);
    let refused = !bad.check_and_download().await;
    check(
        refused && matches!(bad.status(), UpdateStatus::Error { ref message } if message.contains("signature")),
        "a bad signature is refused",
    );
    check(!dir.join("bad").join("Screen Ping Setup 1.1.0.exe").exists(), "the refused installer is deleted");

    // Production key does not trust the test signature.
    let s = server.clone();
    let prod = Updater::new("1.0.73", dir.join("prod"), move || s.clone());
    check(!prod.check_and_download().await, "the production key rejects a test-signed installer");

    println!("\n{}", if ok { "update e2e OK" } else { "update e2e FAILED" });
    std::process::exit(if ok { 0 } else { 1 });
}
