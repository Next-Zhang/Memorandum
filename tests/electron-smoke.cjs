// Launch the real desktop backend with isolated temporary data, without showing a window.
const { app } = require('electron');
const { mkdtempSync, rmSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const directory = mkdtempSync(path.join(os.tmpdir(), 'memorandum-smoke-'));
app.setPath('userData', directory);
const deadline = setTimeout(() => { console.error('Desktop smoke test timed out'); app.exit(1); }, 30000);
app.on('browser-window-created', (_, window) => {
  window.hide();
  window.once('ready-to-show', () => window.hide());
  window.webContents.once('did-finish-load', async () => {
    try {
      const result = await window.webContents.executeJavaScript(`(async () => {
        if (!window.memo) throw new Error('Preload API missing');
        const item = await window.memo.create({ title: '桌面联调测试', important: true });
        const found = await window.memo.get(item.id);
        if (!found.important) throw new Error('Create/get failed');
        await window.memo.update(item.id, { completed: true });
        const list = await window.memo.list({ view: 'completed' });
        if (!list.some(m => m.id === item.id)) throw new Error('Update/list failed');
        await window.memo.remove(item.id);
        return { preload: true, CRUD: true, info: await window.memo.info() };
      })()`);
      console.log('Desktop smoke test passed:', JSON.stringify(result));
      clearTimeout(deadline); app.quit();
    } catch (error) { console.error(error); clearTimeout(deadline); app.exit(1); }
  });
});
app.on('will-quit', () => {
  const resolved = path.resolve(directory);
  const root = path.resolve(os.tmpdir());
  if (path.dirname(resolved) === root && path.basename(resolved).startsWith('memorandum-smoke-')) rmSync(resolved, { recursive: true, force: true });
});
require('../desktop/main.cjs');
