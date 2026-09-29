import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("clipAPI", {
  getState: () => ipcRenderer.invoke("app:get-state"),
  onState: (callback: (state: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
    ipcRenderer.on("app:state", listener);
    return () => ipcRenderer.removeListener("app:state", listener);
  },
  set: (key: string, value: unknown) => ipcRenderer.send("app:set", { key, value }),
  action: (name: string) => ipcRenderer.send("app:action", name),
  minimize: () => ipcRenderer.send("win:minimize"),
  close: () => ipcRenderer.send("win:close"),
  resizeMenu: (width: number, height: number) => ipcRenderer.send("menu:resize", { width, height }),
  hideMenu: () => ipcRenderer.send("menu:hide"),
  pickOutputDir: () => ipcRenderer.invoke("dialog:pick-output-dir"),
});
