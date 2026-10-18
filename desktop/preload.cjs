const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("layoutLabDesktop", {
  focus: (id) => ipcRenderer.send("lab:focus", id),
  layout: (items) => ipcRenderer.send("lab:layout", items),
});
