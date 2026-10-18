const {
  app,
  BrowserWindow,
  WebContentsView,
  View,
  ipcMain,
  Menu,
  shell,
  screen,
} = require("electron");
const path = require("node:path");
const rootPath = path.resolve(__dirname, "..");
app.setPath(
  "userData",
  process.env.GOA2_LAB_ELECTRON_USER_DATA ||
    path.join(
      rootPath,
      ".layout-lab",
      "runtime",
      `desktop-profile-${process.platform}`,
    ),
);
app.setName("GoA2 Layout lab");
// This app runs local developer checkouts. Retain software WebGL fallback on VMs.
app.commandLine.appendSwitch("enable-unsafe-swiftshader");
const views = new Map();
let root;
function applyMetrics(item, scale = 1) {
  const p = item.profile;
  item.view.webContents.enableDeviceEmulation({
    screenPosition: p.isMobile ? "mobile" : "desktop",
    screenSize: p.viewport,
    viewSize: p.viewport,
    deviceScaleFactor: 1,
    scale,
  });
  item.scale = scale;
}
function park(item) {
  const [width, height] = root.getContentSize();
  item.host.setBounds({ x: width - 1, y: height - 1, width: 1, height: 1 });
  item.view.setBounds({
    x: 0,
    y: 0,
    width: item.profile.viewport.width,
    height: item.profile.viewport.height,
  });
  if (item.initialized) applyMetrics(item, 1);
  item.host.setVisible(true);
}
function place(item, spec, force = false) {
  const numbers = ["x", "y", "width", "height", "offsetX", "offsetY"];
  if (
    numbers.some((k) => !Number.isFinite(spec[k]) || Math.abs(spec[k]) > 20000)
  )
    return;
  if (!spec.visible || spec.width < 1 || spec.height < 1) {
    item.host.setVisible(false);
    return;
  }
  const scale = Math.max(0.05, Math.min(3, spec.scale || 1));
  item.host.setBounds({
    x: Math.round(spec.x),
    y: Math.round(spec.y),
    width: Math.round(spec.width),
    height: Math.round(spec.height),
  });
  item.view.setBounds({
    x: Math.round(spec.offsetX),
    y: Math.round(spec.offsetY),
    width: Math.max(1, Math.round(item.profile.viewport.width * scale)),
    height: Math.max(1, Math.round(item.profile.viewport.height * scale)),
  });
  // Reapply after capture: DevTools screenshot helpers can reset emulation.
  if (force || item.scale !== scale) applyMetrics(item, scale);
  item.host.setVisible(true);
}
function layout(items) {
  const shown = new Set();
  for (const spec of items) {
    const item = views.get(spec.id);
    if (!item) continue;
    shown.add(spec.id);
    item.lastLayout = spec;
    if (!item.capturing) place(item, spec);
  }
  // Pending views stay parked until initialization completes.
  for (const [id, item] of views)
    if (!shown.has(id) && item.lastLayout) {
      if (item.lastLayout)
        item.lastLayout = { ...item.lastLayout, visible: false };
      if (!item.capturing) item.host.setVisible(false);
    }
}
app.whenReady().then(async () => {
  Menu.setApplicationMenu(
    process.platform === "darwin"
      ? Menu.buildFromTemplate([
          { role: "appMenu" },
          { role: "editMenu" },
          { role: "windowMenu" },
        ])
      : null,
  );
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  root = new BrowserWindow({
    width: Math.min(1540, workArea.width),
    height: Math.min(1040, workArea.height),
    minWidth: 760,
    minHeight: 600,
    show: false,
    title: "GoA2 Layout lab",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  await root.loadURL("about:blank");
  global.lab = {
    root,
    views,
    layout,
    async create(profile) {
      const host = new View();
      host.setBorderRadius(1);
      root.contentView.addChildView(host);
      const view = new WebContentsView({
        webPreferences: {
          partition: "lab-" + Date.now() + "-" + Math.random(),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          backgroundThrottling: false,
        },
      });
      host.addChildView(view);
      const item = { view, host, profile, scale: 0, lastLayout: null };
      views.set(view.webContents.id, item);
      park(item);
      view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      view.webContents.on("before-input-event", (event, input) => {
        if (
          input.type === "keyDown" &&
          input.key === "Escape" &&
          item.lastLayout?.expanded
        ) {
          event.preventDefault();
          void root.webContents.executeJavaScript(
            "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))",
          );
          root.webContents.focus();
        }
      });
      await view.webContents.loadURL("about:blank");
      item.initialized = true;
      applyMetrics(item, 1);
      return view.webContents.id;
    },
    destroy(id) {
      const item = views.get(id);
      if (!item) return;
      views.delete(id);
      root.contentView.removeChildView(item.host);
      if (!item.view.webContents.isDestroyed()) item.view.webContents.close();
    },
    async open(url, show) {
      await root.loadURL(url);
      if (show) root.show();
    },
    show() {
      root.show();
    },
    async screenshot() {
      return (await root.capturePage()).toPNG().toString("base64");
    },
    beginCapture(id) {
      const item = views.get(id);
      if (!item) throw Error("View closed");
      item.capturing = true;
      if (!item.host.getVisible()) park(item);
      item.view.setBounds({
        x: 0,
        y: 0,
        width: item.profile.viewport.width,
        height: item.profile.viewport.height,
      });
      applyMetrics(item, 1);
    },
    endCapture(id) {
      const item = views.get(id);
      if (!item) return;
      item.capturing = false;
      if (item.lastLayout) place(item, item.lastLayout, true);
      else park(item);
    },
  };
  ipcMain.on("lab:focus", (event, id) => {
    if (event.sender === root.webContents)
      views.get(id)?.view.webContents.focus();
  });
  ipcMain.on("lab:layout", (event, items) => {
    if (
      event.sender === root.webContents &&
      Array.isArray(items) &&
      items.length <= 3
    )
      layout(items);
  });
  root.webContents.setWindowOpenHandler(({ url }) => {
    const u = new URL(url);
    if (
      u.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(u.hostname)
    )
      void shell.openExternal(url);
    return { action: "deny" };
  });
  root.on("closed", () => {
    for (const item of views.values())
      if (!item.view.webContents.isDestroyed()) item.view.webContents.close();
    views.clear();
    app.quit();
  });
});
app.on("window-all-closed", () => app.quit());
