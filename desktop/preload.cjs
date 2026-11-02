const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("layoutLabDesktop", {
  toggleWindow: (payload) => ipcRenderer.invoke("lab:window-toggle", payload),
  windows: () => ipcRenderer.invoke("lab:windows"),
  pruneWindows: (count) => ipcRenderer.send("lab:windows-prune", count),
  windowContent: (payload) => ipcRenderer.send("lab:window-content", payload),
  windowAction: (payload) => ipcRenderer.send("lab:window-action", payload),
  onWindows: (callback) =>
    ipcRenderer.on("lab:windows", (_, value) => callback(value)),
  onWindowContent: (callback) =>
    ipcRenderer.on("lab:window-content", (_, value) => callback(value)),
  onWindowAction: (callback) =>
    ipcRenderer.on("lab:window-action", (_, value) => callback(value)),
  focus: (id) => ipcRenderer.send("lab:focus", id),
  layout: (items) => ipcRenderer.send("lab:layout", items),
});
