const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification, dialog, powerMonitor } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { readFile, writeFile, stat } = require('node:fs/promises');
let window, tray, service, scheduler, quitting = false, closeToTray = true;
const entry = path.join(__dirname, '..', 'index.html');
const icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAIUlEQVQ4T2N0j+n8z0ABYBw1gGE0DBjGowYwGoYMo2EAAABqFRYhZiILqwAAAABJRU5ErkJggg==');

function showWindow(id) {
  if (!window || window.isDestroyed()) createWindow();
  if (window.isMinimized()) window.restore();
  window.show(); window.focus();
  if (id) { if (window.webContents.isLoading()) window.webContents.once('did-finish-load', () => window.webContents.send('memo:open', id)); else window.webContents.send('memo:open', id); }
}
function createWindow() {
  window = new BrowserWindow({ width: 1220, height: 840, minWidth: 800, minHeight: 600, title: '拾光 · 备忘录', backgroundColor: '#f7f8fa', autoHideMenuBar: true, icon, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.loadFile(entry);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== pathToFileURL(entry).href) event.preventDefault(); });
  window.on('close', event => { if (!quitting && closeToTray) { event.preventDefault(); window.hide(); } });
}
async function registerApi() {
  const exposed = new Set(['list', 'get', 'create', 'update', 'remove', 'snooze', 'settings', 'updateSettings', 'exportData', 'importData', 'exportFile', 'importFile', 'info', 'showWindow']);
  ipcMain.handle('memo:invoke', async (event, request) => {
    try {
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw Object.assign(new Error('不允许的调用来源'), { code: 'FORBIDDEN' });
      if (!request || !exposed.has(request.method) || !Array.isArray(request.args) || request.args.length > 2) throw Object.assign(new Error('无效的接口调用'), { code: 'INVALID_INPUT' });
      const { method, args } = request;
      let data;
      if (method === 'info') data = { version: app.getVersion(), dataDirectory: app.getPath('userData'), notificationsSupported: Notification.isSupported(), recovered: service.recovered };
      else if (method === 'showWindow') { showWindow(); data = true; }
      else if (method === 'exportFile') {
        const result = await dialog.showSaveDialog(window, { title: '导出备忘录', defaultPath: `拾光备份-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON 备份', extensions: ['json'] }] });
        if (result.canceled) data = { canceled: true };
        else { await writeFile(result.filePath, JSON.stringify(await service.exportData(), null, 2), 'utf8'); data = { canceled: false, path: result.filePath }; }
      } else if (method === 'importFile') {
        const result = await dialog.showOpenDialog(window, { title: '导入备忘录', properties: ['openFile'], filters: [{ name: 'JSON 备份', extensions: ['json'] }] });
        if (result.canceled) data = { canceled: true };
        else {
          if ((await stat(result.filePaths[0])).size > 20 * 1024 * 1024) throw Object.assign(new Error('备份文件不能超过 20 MB'), { code: 'INVALID_IMPORT' });
          let backup;
          try { backup = JSON.parse(await readFile(result.filePaths[0], 'utf8')); } catch { throw Object.assign(new Error('备份不是有效的 JSON 文件'), { code: 'INVALID_IMPORT' }); }
          data = await service.importData(backup);
        }
      } else if (method === 'updateSettings') {
        // Apply the OS setting first so failure cannot be reported as a successful preference save.
        const { validateSettings } = await import('../backend/settings.js');
        validateSettings(args[0]);
        const previous = await service.settings();
        try {
          if ('launchAtLogin' in args[0]) app.setLoginItemSettings({ openAtLogin: args[0].launchAtLogin });
          data = await service.updateSettings(args[0]); closeToTray = data.closeToTray;
        } catch (error) { if ('launchAtLogin' in args[0]) app.setLoginItemSettings({ openAtLogin: previous.launchAtLogin }); throw error; }
      } else data = await service[method](...args);
      return { ok: true, data };
    } catch (error) { console.error(error); return { ok: false, error: { code: error.code || 'INTERNAL_ERROR', message: error.code ? error.message : '操作失败，请检查数据目录或稍后重试' } }; }
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.setAppUserModelId('com.shiguang.memo');
  app.on('second-instance', () => { if (service) showWindow(); });
  app.whenReady().then(async () => {
    const { MemoService } = await import('../backend/service.js');
    const { ReminderScheduler } = await import('../backend/scheduler.js');
    service = await new MemoService(app.getPath('userData')).initialize();
    closeToTray = (await service.settings()).closeToTray;
    await registerApi();
    createWindow();
    tray = new Tray(icon); tray.setToolTip('拾光备忘录 · 正在为你记着');
    tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开拾光', click: () => showWindow() }, { type: 'separator' }, { label: '退出（停止提醒）', click: () => app.quit() }]));
    tray.on('double-click', () => showWindow()); tray.on('click', () => showWindow());
    service.on('changed', () => { if (window && !window.isDestroyed()) window.webContents.send('memo:changed'); });
    scheduler = new ReminderScheduler(service, async memo => {
      if (window && !window.isDestroyed()) window.webContents.send('memo:reminder', memo);
      if (Notification.isSupported()) {
        const notification = new Notification({ title: `${memo.important ? '重要事项' : '事项提醒'} · ${memo.title}`, body: memo.description.slice(0, 160) || '到时间了，来看看这件事吧。', icon, silent: false });
        notification.on('click', () => showWindow(memo.id));
        notification.show();
      }
    });
    scheduler.start();
    powerMonitor.on('resume', () => scheduler.tick());
    app.on('activate', () => showWindow());
  }).catch(error => { dialog.showErrorBox('拾光启动失败', error.message); app.quit(); });
  app.on('window-all-closed', () => { if (!closeToTray) app.quit(); });
  app.on('before-quit', event => {
    if (quitting) return;
    quitting = true; scheduler?.stop();
    if (service) {
      event.preventDefault();
      // Wait for accepted writes before exiting so settings and edits are not lost.
      service.queue.finally(() => app.quit());
    }
  });
  app.on('will-quit', () => tray?.destroy());
}
