// Replace this functional harness with your Figma renderer; use window.memo only.
const $ = id => document.getElementById(id);
const api = window.memo;
let editing = null;
const report = (text, error = false) => { $('message').textContent = text; $('message').className = error ? 'error' : ''; };
const run = async fn => { try { await fn(); } catch (e) { report(`${e.code || 'ERROR'}: ${e.message}`, true); } };
function button(text, fn) { const el = document.createElement('button'); el.textContent = text; el.type = 'button'; el.onclick = () => run(fn); return el; }
function edit(memo) {
  editing = memo?.id || null; $('heading').textContent = editing ? '编辑事项' : '新建事项';
  for (const key of ['title', 'description', 'tag']) $(key).value = memo?.[key] || (key === 'tag' ? '工作' : '');
  $('important').checked = !!memo?.important;
  const d = memo?.due ? new Date(memo.due) : null;
  $('due').value = d ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
  $('title').focus();
}
async function refresh() {
  const memos = await api.list({ view: $('view').value, status: $('status').value, search: $('search').value });
  $('items').replaceChildren();
  if (!memos.length) $('items').textContent = '暂无符合条件的事项';
  for (const m of memos) {
    const article = document.createElement('article');
    const title = document.createElement('h3'); title.textContent = `${m.completed ? '✓ ' : ''}${m.important ? '★ ' : ''}${m.title}`;
    const text = document.createElement('p'); text.textContent = m.description;
    const meta = document.createElement('p'); meta.textContent = `${m.tag} · ${m.due ? new Date(m.due).toLocaleString('zh-CN') : '未设置提醒'}${m.snoozedUntil ? ' · 已延后提醒' : ''}`;
    article.append(title, text, meta, button(m.completed ? '恢复待办' : '完成', () => api.update(m.id, { completed: !m.completed })), button('编辑', () => edit(m)), button('删除', () => { $('delete-title').textContent = m.title; $('delete-dialog').dataset.id = m.id; $('delete-dialog').showModal(); }));
    if (m.due && !m.completed) article.append(button('10 分钟后提醒', () => api.snooze(m.id, 10)));
    $('items').append(article);
  }
  const settings = await api.settings();
  for (const key of ['notifications', 'closeToTray', 'launchAtLogin']) $(key).checked = settings[key];
}
if (!api) report('请使用 npm start 启动桌面应用。', true);
else {
  $('form').onsubmit = event => { event.preventDefault(); run(async () => {
    const fields = { title: $('title').value, description: $('description').value, tag: $('tag').value, important: $('important').checked, due: $('due').value ? new Date($('due').value).toISOString() : null };
    if (editing) await api.update(editing, fields); else await api.create(fields);
    edit(null); report('已保存到本地'); await refresh();
  }); };
  $('reset').onclick = () => edit(null);
  for (const id of ['view', 'status']) $(id).onchange = () => run(refresh);
  $('search').oninput = () => run(refresh);
  for (const key of ['notifications', 'closeToTray', 'launchAtLogin']) $(key).onchange = () => run(async () => { try { await api.updateSettings({ [key]: $(key).checked }); } finally { await refresh(); } });
  $('export').onclick = () => run(async () => { const r = await api.exportFile(); if (!r.canceled) report(`已导出：${r.path}`); });
  $('import').onclick = () => run(async () => { const r = await api.importFile(); if (!r.canceled) report(`导入成功：新增 ${r.added}，更新 ${r.updated}`); });
  $('cancel-delete').onclick = () => $('delete-dialog').close();
  $('confirm-delete').onclick = () => run(async () => { const id = $('delete-dialog').dataset.id; await api.remove(id); if (editing === id) edit(null); $('delete-dialog').close(); });
  api.onChanged(() => run(refresh));
  api.onOpenMemo(id => run(async () => edit(await api.get(id))));
  api.onReminder(m => { const row = document.createElement('div'); row.className = 'reminder'; const title = document.createElement('b'); title.textContent = `到期提醒：${m.title}`; row.append(title, button('完成', async () => { await api.update(m.id, { completed: true }); row.remove(); }), button('稍后提醒', async () => { await api.snooze(m.id, 10); row.remove(); }), button('关闭提示', () => row.remove())); $('reminders').prepend(row); });
  run(async () => { const info = await api.info(); $('data-path').textContent = info.dataDirectory; if (info.recovered) report('数据已从上一次备份恢复，请检查事项。'); await refresh(); });
}
