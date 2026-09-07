import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  getSavedLogin: () => ipcRenderer.invoke("auth:get-saved-login"),
  login: (username: string, password: string, remember = true) =>
    ipcRenderer.invoke("auth:login", { username, password, remember }),
  browserLogin: (mode: "google" | "web", remember = true) =>
    ipcRenderer.invoke("auth:browser-login", { mode, remember }),
  cancelBrowserLogin: () => ipcRenderer.invoke("auth:cancel-browser-login"),
  dismissOverlay: (messageId: string) =>
    ipcRenderer.send("overlay:dismiss", { messageId, status: "delivered" }),
  onShowOverlay: (callback: (payload: unknown) => void) => {
    ipcRenderer.on("overlay:show", (_event, payload) => callback(payload));
  },
  onHideOverlay: (callback: () => void) => {
    ipcRenderer.on("overlay:hide", () => callback());
  },
  notifyOverlayReady: (messageId: string) => {
    ipcRenderer.send("overlay:ready", { messageId });
  },
  notifyOverlayCleared: () => {
    ipcRenderer.send("overlay:cleared");
  },
  onDrawBegin: (callback: (payload: unknown) => void) => {
    ipcRenderer.on("draw:begin", (_event, payload) => callback(payload));
  },
  onDrawStroke: (callback: (payload: unknown) => void) => {
    ipcRenderer.on("draw:stroke", (_event, payload) => callback(payload));
  },
  onDrawClear: (callback: (payload: unknown) => void) => {
    ipcRenderer.on("draw:clear", (_event, payload) => callback(payload));
  },
  onDrawEnd: (callback: (payload: unknown) => void) => {
    ipcRenderer.on("draw:end", (_event, payload) => callback(payload));
  },
  notifyDrawIdle: () => {
    ipcRenderer.send("draw:idle");
  },
});

contextBridge.exposeInMainWorld("desktopAPI", {
  getState: () => ipcRenderer.invoke("app:get-state"),
  onState: (callback: (state: unknown) => void) => {
    ipcRenderer.on("app:state", (_event, state) => callback(state));
  },
  set: (key: string, value: boolean | number | null) => ipcRenderer.send("app:set", { key, value }),
  action: (name: string) => ipcRenderer.send("app:action", name),
  minimize: () => ipcRenderer.send("win:minimize"),
  close: () => ipcRenderer.send("win:close"),
  resizeToContent: (height: number) => ipcRenderer.send("win:resize-content", height),
  resizeMenu: (width: number, height: number) => ipcRenderer.send("menu:resize", { width, height }),
  hideMenu: () => ipcRenderer.send("menu:hide"),
  onOpenTab: (callback: (tab: string) => void) => {
    ipcRenderer.on("app:open-tab", (_event, tab) => callback(tab));
  },
  onPresence: (callback: (payload: unknown) => void) => {
    ipcRenderer.on("desktop:presence", (_event, payload) => callback(payload));
  },
  onFriendsUpdate: (callback: () => void) => {
    ipcRenderer.on("desktop:friends", () => callback());
  },
  friends: {
    list: () => ipcRenderer.invoke("friends:list"),
    request: (username: string) => ipcRenderer.invoke("friends:request", username),
    accept: (id: string) => ipcRenderer.invoke("friends:accept", id),
    decline: (id: string) => ipcRenderer.invoke("friends:decline", id),
    remove: (id: string) => ipcRenderer.invoke("friends:remove", id),
    block: (id: string) => ipcRenderer.invoke("friends:block", id),
    unblock: (id: string) => ipcRenderer.invoke("friends:unblock", id),
  },
  uploadMedia: (payload: {
    receiverIds: string[];
    filePath: string;
    caption?: string;
    soundPath?: string;
  }) => ipcRenderer.invoke("media:upload", payload),
  sendMessage: (payload: unknown) => ipcRenderer.invoke("message:send", payload),
  pickMedia: () => ipcRenderer.invoke("dialog:pick-media"),
  pickAudio: () => ipcRenderer.invoke("dialog:pick-audio"),
});
