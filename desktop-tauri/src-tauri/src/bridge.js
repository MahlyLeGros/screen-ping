// Injected into every Screen Ping page before its own scripts.
// Recreates the Electron preload API (desktop/main/preload.ts) on top of
// Tauri, so desktop/renderer runs unchanged.
(() => {
  if (window.electronAPI) return;

  const T = () => window.__TAURI__;
  const toError = (e) => new Error(typeof e === "string" ? e : (e && e.message) || String(e));
  const invoke = (channel, payload) =>
    T().core.invoke("ipc_invoke", { channel, payload: payload === undefined ? null : payload }).catch((e) => {
      throw toError(e);
    });
  const send = (channel, payload) => {
    const go = () =>
      T().core.invoke("ipc_send", { channel, payload: payload === undefined ? null : payload }).catch(() => {});
    if (T()) go();
    else window.addEventListener("DOMContentLoaded", go, { once: true });
  };
  // Events are targeted at this window only.
  const on = (channel, cb) => {
    const attach = () => T().webviewWindow.getCurrentWebviewWindow().listen(channel, (e) => cb(e.payload));
    if (T()) attach();
    else window.addEventListener("DOMContentLoaded", attach, { once: true });
  };

  window.electronAPI = {
    getSavedLogin: () => invoke("auth:get-saved-login"),
    login: (username, password, remember = true) => invoke("auth:login", { username, password, remember }),
    browserLogin: (mode, remember = true) => invoke("auth:browser-login", { mode, remember }),
    cancelBrowserLogin: () => invoke("auth:cancel-browser-login"),
    dismissOverlay: (messageId) => send("overlay:dismiss", { messageId, status: "delivered" }),
    onShowOverlay: (cb) => on("overlay:show", cb),
    onHideOverlay: (cb) => on("overlay:hide", () => cb()),
    onStartOverlay: (cb) => on("overlay:start", cb),
    notifyOverlayReady: (messageId) => send("overlay:ready", { messageId }),
    notifyOverlayInitialized: () => send("overlay:initialized"),
    notifyOverlayFailed: (messageId) => send("overlay:failed", { messageId }),
    notifyOverlayCleared: () => send("overlay:cleared"),
    onDrawBegin: (cb) => on("draw:begin", cb),
    onDrawStroke: (cb) => on("draw:stroke", cb),
    onDrawClear: (cb) => on("draw:clear", cb),
    onDrawEnd: (cb) => on("draw:end", cb),
    notifyDrawIdle: () => send("draw:idle"),
  };

  window.desktopAPI = {
    getState: () => invoke("app:get-state"),
    onState: (cb) => on("app:state", cb),
    set: (key, value) => send("app:set", { key, value }),
    action: (name) => send("app:action", name),
    minimize: () => send("win:minimize"),
    close: () => send("win:close"),
    resizeToContent: (height) => send("win:resize-content", height),
    resizeMenu: (width, height) => send("menu:resize", { width, height }),
    hideMenu: () => send("menu:hide"),
    onOpenTab: (cb) => on("app:open-tab", cb),
    onPresence: (cb) => on("desktop:presence", cb),
    onFriendsUpdate: (cb) => on("desktop:friends", () => cb()),
    friends: {
      list: () => invoke("friends:list"),
      request: (username) => invoke("friends:request", username),
      accept: (id) => invoke("friends:accept", id),
      decline: (id) => invoke("friends:decline", id),
      remove: (id) => invoke("friends:remove", id),
      block: (id) => invoke("friends:block", id),
      unblock: (id) => invoke("friends:unblock", id),
    },
    uploadMedia: (payload) => invoke("media:upload", payload),
    sendMessage: (payload) => invoke("message:send", payload),
    pickMedia: () => invoke("dialog:pick-media"),
    pickAudio: () => invoke("dialog:pick-audio"),
  };

  // Window opacity (Electron's win.setOpacity) is done in CSS here.
  on("__sp:opacity", ({ from, to, ms }) => {
    const el = document.documentElement;
    el.style.transition = "none";
    el.style.opacity = String(from);
    if (ms > 0) {
      void el.offsetWidth;
      el.style.transition = `opacity ${ms}ms linear`;
    }
    el.style.opacity = String(to);
  });

  // Electron honours `-webkit-app-region: drag`; Tauri needs startDragging().
  window.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || !T()) return;
    for (let el = e.target; el && el.nodeType === 1; el = el.parentElement) {
      const cs = getComputedStyle(el);
      const region = cs.getPropertyValue("-webkit-app-region") || cs.webkitAppRegion || cs.getPropertyValue("app-region");
      if (region === "no-drag") return;
      if (["BUTTON", "INPUT", "TEXTAREA", "SELECT", "A", "LABEL"].includes(el.tagName)) return;
      // Fallback if the engine hides the computed value: drag areas in theme.css.
      if (region === "drag" || (!region && el.matches(".titlebar__drag, .updater"))) {
        T().window.getCurrentWindow().startDragging().catch(() => {});
        return;
      }
    }
  }, true);
})();
