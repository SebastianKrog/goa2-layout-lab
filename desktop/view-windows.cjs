// Separate shells retain the original game WebContents and route controls to the desk.
const { BrowserWindow } = require("electron");
const path = require("node:path");
class ViewWindows {
  constructor(root, views, notify, place) {
    Object.assign(this, { root, views, notify, place });
    this.windows = new Map();
  }
  state() {
    return [...this.windows.keys()];
  }
  owner(sender) {
    return [...this.windows.values()].find(
      (w) => w.window.webContents === sender,
    );
  }
  attach(item, owner) {
    if (item.owner === owner) return;
    item.owner.contentView.removeChildView(item.host);
    owner.contentView.addChildView(item.host);
    item.owner = owner;
  }
  update(payload) {
    const entry = this.windows.get(payload.index);
    if (!entry) return;
    if (payload.editorContext) {
      entry.window.webContents.send("lab:window-content", payload);
      return;
    }
    entry.payload = payload;
    entry.window.setTitle(payload.title + " — GoA2 Layout Lab");
    const item = this.views.get(payload.nativeId);
    if (item) {
      item.slot = payload.index;
      this.attach(item, entry.window);
    }
    if (!entry.window.webContents.isLoading())
      entry.window.webContents.send("lab:window-content", payload);
  }
  toggle({ index, id, title }) {
    if (!Number.isInteger(index) || index < 0 || index > 2)
      throw Error("Invalid View");
    const previous = this.windows.get(index);
    if (previous) {
      previous.window.close();
      return this.state();
    }
    const item = this.views.get(id);
    if (!item || item.slot !== index) throw Error("View replaced; try again");
    const window = new BrowserWindow({
      width: 1000,
      height: 850,
      minWidth: 360,
      minHeight: 320,
      title: title + " — GoA2 Layout Lab",
      autoHideMenuBar: true,
      backgroundColor: "#10151e",
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    const entry = { index, window };
    this.windows.set(index, entry);
    this.attach(item, window);
    item.host.setVisible(false);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("did-finish-load", () => {
      if (entry.payload)
        window.webContents.send("lab:window-content", entry.payload);
      window.show();
    });
    window.on("close", () => {
      this.windows.delete(index);
      for (const v of this.views.values())
        if (v.owner === window) {
          this.attach(v, this.root);
          if (v.lastLayout && !v.capturing) this.place(v, v.lastLayout, true);
        }
      this.notify(this.state());
    });
    const url = new URL("/view.html", this.root.webContents.getURL());
    url.searchParams.set("index", index);
    url.searchParams.set("native", "1");
    void window.loadURL(url.href);
    this.notify(this.state());
    return this.state();
  }
  prune(count) {
    if (!Number.isInteger(count) || count < 0 || count > 3) return;
    for (const [index, entry] of this.windows)
      if (index >= count) entry.window.close();
  }
  close() {
    for (const entry of [...this.windows.values()]) entry.window.close();
  }
}
module.exports = { ViewWindows };
