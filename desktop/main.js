// ClearPoint Global CRM: desktop shell.
// The screens load from the team's web address, so every improvement reaches everyone the next time they open the app.
const { app, BrowserWindow, shell, Menu, session, dialog } = require("electron");
const path = require("path");
const pkg = require("./package.json");

const APP_URL = process.env.CRM_URL || pkg.appUrl;
const APP_ORIGIN = new URL(APP_URL).origin;
let win = null;

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

function isInternal(url) {
  try { const u = new URL(url); return u.origin === APP_ORIGIN || /\.supabase\.co$/.test(u.hostname); } catch { return false; }
}
function openOutside(url) {
  if (/^(https?|mailto|sms|tel):/i.test(url)) shell.openExternal(url);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 980, minHeight: 640,
    title: "ClearPoint Global CRM",
    backgroundColor: "#0f1f3d",
    show: false,
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true }
  });
  win.once("ready-to-show", () => win.show());

  // Gmail, Messages, phone calls, LinkedIn and Google Sheets open in their own apps or the browser
  win.webContents.setWindowOpenHandler(({ url }) => { openOutside(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!isInternal(url)) { e.preventDefault(); openOutside(url); } });

  win.webContents.on("did-fail-load", (e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return; // -3 = navigation aborted
    win.loadFile(path.join(__dirname, "offline.html"), { query: { u: APP_URL } });
  });

  win.loadURL(APP_URL);
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    { label: "View", submenu: [
      { label: "Refresh", accelerator: "CmdOrCtrl+R", click: () => win && win.loadURL(APP_URL) },
      { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
      { type: "separator" }, { role: "togglefullscreen" }
    ]},
    { role: "windowMenu" },
    { role: "help", submenu: [
      { label: "Check for app updates", click: () => checkUpdates(true) },
      { label: "Version " + app.getVersion(), enabled: false }
    ]}
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// The screens update on their own. The app wrapper itself updates automatically on Windows;
// on Mac (unsigned) it tells people when a new download is available.
async function checkUpdates(manual) {
  try {
    if (process.platform === "win32") {
      const { autoUpdater } = require("electron-updater");
      autoUpdater.autoDownload = true;
      await autoUpdater.checkForUpdatesAndNotify();
      if (manual) dialog.showMessageBox({ message: "You're up to date, or the update is downloading in the background." });
      return;
    }
    const res = await fetch("https://api.github.com/repos/" + pkg.build.publish[0].owner + "/" + pkg.build.publish[0].repo + "/releases/latest");
    if (!res.ok) throw new Error("no release info");
    const rel = await res.json();
    const latest = String(rel.tag_name || "").replace(/^v/, "");
    if (latest && latest !== app.getVersion()) {
      const r = await dialog.showMessageBox({ type: "info", buttons: ["Download", "Later"], message: "A new version of the ClearPoint CRM app (" + latest + ") is available.", detail: "Your data and screens are already up to date. This only updates the app wrapper." });
      if (r.response === 0) shell.openExternal(rel.html_url);
    } else if (manual) dialog.showMessageBox({ message: "You're on the latest version (" + app.getVersion() + ")." });
  } catch (e) {
    if (manual) dialog.showMessageBox({ message: "Couldn't check for updates right now." });
  }
}

app.whenReady().then(async () => {
  // start fresh so everyone always gets the newest screens
  try { await session.defaultSession.clearCache(); } catch {}
  buildMenu();
  createWindow();
  setTimeout(() => checkUpdates(false), 8000);
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
