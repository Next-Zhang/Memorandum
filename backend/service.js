import { mkdir, readFile, writeFile, rename, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { TAGS, validMemo, selectMemos, isDue } from '../model.js';

export class MemoError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new MemoError(code, message); };
const clone = value => structuredClone(value);
const DEFAULT_SETTINGS = { notifications: true, launchAtLogin: false, closeToTray: true };

export function validateFields(input, partial = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_INPUT', '事项必须是对象');
  const output = {};
  for (const key of Object.keys(input)) {
    if (!['title', 'description', 'tag', 'important', 'completed', 'due'].includes(key)) fail('INVALID_INPUT', `不支持的事项字段：${key}`);
  }
  if (!partial || 'title' in input) {
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 100) fail('INVALID_INPUT', '标题需要 1–100 个字符');
    output.title = input.title.trim();
  }
  for (const [key, fallback] of Object.entries({ description: '', tag: '生活', important: false, completed: false, due: null })) {
    if (partial && !(key in input)) continue;
    const value = key in input ? input[key] : fallback;
    if (key === 'description' && (typeof value !== 'string' || value.length > 5000)) fail('INVALID_INPUT', '内容不能超过 5000 个字符');
    if (key === 'tag' && !TAGS.includes(value)) fail('INVALID_INPUT', '标签须为工作、生活或学习');
    if (['important', 'completed'].includes(key) && typeof value !== 'boolean') fail('INVALID_INPUT', `${key} 必须为布尔值`);
    if (key === 'due' && value !== null && (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))) fail('INVALID_INPUT', '提醒时间格式无效');
    output[key] = key === 'due' && value !== null ? new Date(value).toISOString() : value;
  }
  return output;
}

export class MemoService extends EventEmitter {
  constructor(directory, { now = () => new Date() } = {}) {
    super();
    this.directory = directory;
    this.filename = path.join(directory, 'memos.json');
    this.now = now;
    this.state = { version: 1, memos: [], settings: { ...DEFAULT_SETTINGS } };
    this.queue = Promise.resolve();
    this.recovered = false;
  }
  decode(text) {
    const data = JSON.parse(text);
    if (data.version !== 1 || !Array.isArray(data.memos) || !data.memos.every(validMemo)) throw new Error('数据文件格式无效');
    if (new Set(data.memos.map(m => m.id)).size !== data.memos.length) throw new Error('事项编号重复');
    const settings = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(settings)) if (typeof data.settings?.[key] === 'boolean') settings[key] = data.settings[key];
    return { version: 1, memos: data.memos.map(m => this.normalizeImported(m)), settings };
  }
  async initialize() {
    await mkdir(this.directory, { recursive: true });
    try { this.state = this.decode(await readFile(this.filename, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') {
        // Preserve damaged data for manual recovery before reading the last valid backup.
        await copyFile(this.filename, `${this.filename}.corrupt-${Date.now()}`);
        try { this.state = this.decode(await readFile(`${this.filename}.bak`, 'utf8')); this.recovered = true; }
        catch { fail('STORAGE_CORRUPT', '数据文件及备份无法读取，原文件已保留，请检查数据目录'); }
      } else {
        // A backup can survive an interrupted external move/removal of the primary file.
        try { this.state = this.decode(await readFile(`${this.filename}.bak`, 'utf8')); this.recovered = true; }
        catch (backupError) { if (backupError.code !== 'ENOENT') fail('STORAGE_CORRUPT', '备份数据无法读取'); }
      }
    }
    return this;
  }
  async persist(next) {
    const content = JSON.stringify(next, null, 2);
    const temporary = `${this.filename}.tmp`;
    await writeFile(temporary, content, { encoding: 'utf8', flush: true });
    // Keep a known-valid previous state; do not copy a possibly damaged file.
    await writeFile(`${this.filename}.bak.tmp`, JSON.stringify(this.state, null, 2), { encoding: 'utf8', flush: true });
    await rename(`${this.filename}.bak.tmp`, `${this.filename}.bak`);
    await rename(temporary, this.filename);
    this.state = next;
  }
  mutate(action) {
    const operation = this.queue.then(async () => {
      const next = clone(this.state);
      const result = action(next);
      await this.persist(next);
      this.emit('changed');
      return clone(result);
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async list(options = {}) {
    await this.queue;
    if (!options || typeof options !== 'object' || Array.isArray(options)) fail('INVALID_INPUT', '筛选条件无效');
    const { view = 'all', status = 'all', tag = null, search = '', sort = 'smart' } = options;
    if (!['all', 'today', 'important', 'upcoming', 'completed'].includes(view) || !['all', 'pending', 'completed'].includes(status) || (tag !== null && !TAGS.includes(tag)) || typeof search !== 'string' || search.length > 5000 || !['smart', 'due', 'newest'].includes(sort)) fail('INVALID_INPUT', '筛选条件无效');
    return clone(selectMemos(this.state.memos, { view, status, tag, search, sort }, this.now()));
  }
  async get(id) { await this.queue; const memo = this.state.memos.find(m => m.id === id); if (!memo) fail('NOT_FOUND', '事项不存在'); return clone(memo); }
  create(input) {
    const fields = validateFields(input);
    return this.mutate(state => {
      const timestamp = this.now().toISOString();
      const memo = { ...fields, id: randomUUID(), createdAt: timestamp, updatedAt: timestamp, notifiedAt: null, snoozedUntil: null };
      state.memos.push(memo);
      return memo;
    });
  }
  update(id, input) {
    const fields = validateFields(input, true);
    return this.mutate(state => {
      const memo = state.memos.find(m => m.id === id);
      if (!memo) fail('NOT_FOUND', '事项不存在');
      const reset = ('due' in fields && fields.due !== memo.due) || (fields.completed === false && memo.completed);
      Object.assign(memo, fields, { updatedAt: this.now().toISOString() });
      if (reset) { memo.notifiedAt = null; memo.snoozedUntil = null; }
      return memo;
    });
  }
  remove(id) {
    return this.mutate(state => {
      const index = state.memos.findIndex(m => m.id === id);
      if (index === -1) fail('NOT_FOUND', '事项不存在');
      state.memos.splice(index, 1);
      return { id };
    });
  }
  snooze(id, minutes = 10) {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080) fail('INVALID_INPUT', '稍后提醒时间须为 1–10080 分钟');
    return this.mutate(state => {
      const memo = state.memos.find(m => m.id === id);
      if (!memo) fail('NOT_FOUND', '事项不存在');
      if (memo.completed || !memo.due) fail('INVALID_INPUT', '仅可延后未完成且已设置提醒的事项');
      memo.snoozedUntil = new Date(this.now().getTime() + minutes * 60000).toISOString();
      memo.notifiedAt = null;
      memo.updatedAt = this.now().toISOString();
      return memo;
    });
  }
  async settings() { await this.queue; return clone(this.state.settings); }
  updateSettings(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.entries(input).some(([k, v]) => !Object.hasOwn(DEFAULT_SETTINGS, k) || typeof v !== 'boolean')) fail('INVALID_INPUT', '设置参数无效');
    return this.mutate(state => Object.assign(state.settings, input));
  }
  async exportData() { await this.queue; return { version: 1, exportedAt: this.now().toISOString(), memos: clone(this.state.memos) }; }
  normalizeImported(memo) {
    const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
    return { id: memo.id, ...validateFields(Object.fromEntries(['title', 'description', 'tag', 'important', 'completed', 'due'].map(k => [k, memo[k]]))), createdAt: new Date(memo.createdAt).toISOString(), updatedAt: timestamp(memo.updatedAt) || new Date(memo.createdAt).toISOString(), notifiedAt: timestamp(memo.notifiedAt), snoozedUntil: timestamp(memo.snoozedUntil) };
  }
  importData(data) {
    if (!data || data.version !== 1 || !Array.isArray(data.memos) || data.memos.length > 10000 || !data.memos.every(validMemo) || new Set(data.memos.map(m => m.id)).size !== data.memos.length) fail('INVALID_IMPORT', '备份格式无效、存在重复编号或事项超过 10000 条');
    const incoming = data.memos.map(m => this.normalizeImported(m));
    return this.mutate(state => {
      let added = 0, updated = 0;
      for (const memo of incoming) {
        const index = state.memos.findIndex(m => m.id === memo.id);
        if (index < 0) { state.memos.push(memo); added++; }
        else { state.memos[index] = memo; updated++; }
      }
      return { added, updated, total: state.memos.length };
    });
  }
  // Claim reminders atomically before delivering, preventing duplicate ticks or notifications after restart.
  claimReminders() {
    return this.queue.then(() => {
      const now = this.now();
      const ready = this.state.memos.some(m => isDue(m, now) && !m.notifiedAt && (!m.snoozedUntil || Date.parse(m.snoozedUntil) <= now.getTime()));
      if (!ready || !this.state.settings.notifications) return [];
      return this.mutate(state => {
        const result = [];
        for (const memo of state.memos) {
          if (isDue(memo, now) && !memo.notifiedAt && (!memo.snoozedUntil || Date.parse(memo.snoozedUntil) <= now.getTime())) {
            memo.notifiedAt = now.toISOString();
            result.push(clone(memo));
          }
        }
        return result;
      });
    });
  }
}
