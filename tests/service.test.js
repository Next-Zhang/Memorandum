import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MemoService } from '../backend/service.js';
import { ReminderScheduler } from '../backend/scheduler.js';
import { localDay } from '../model.js';

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'memorandum-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let time = new Date('2026-10-10T09:00:00+08:00');
  const now = () => new Date(time);
  const service = await new MemoService(directory, { now }).initialize();
  return { service, directory, now, setTime: value => { time = new Date(value); } };
}
test('CRUD persists across restart and returns isolated copies', async t => {
  const { service, directory, now } = await fixture(t);
  const m = await service.create({ title: '  项目计划  ', important: true, tag: '工作' });
  assert.equal(m.title, '项目计划');
  m.title = 'external mutation';
  assert.equal((await service.get(m.id)).title, '项目计划');
  await service.update(m.id, { description: '补充细节', completed: true });
  const reopened = await new MemoService(directory, { now }).initialize();
  assert.equal((await reopened.get(m.id)).description, '补充细节');
  assert.equal((await reopened.list({ view: 'completed' })).length, 1);
  await reopened.remove(m.id);
  await assert.rejects(reopened.get(m.id), { code: 'NOT_FOUND' });
});
test('concurrent writes do not lose items; failed operation does not poison queue', async t => {
  const { service } = await fixture(t);
  await Promise.all(Array.from({ length: 25 }, (_, i) => service.create({ title: `事项 ${i}` })));
  assert.equal((await service.list()).length, 25);
  await assert.rejects(service.remove('missing'), { code: 'NOT_FOUND' });
  await service.create({ title: '仍可写入' });
  assert.equal((await service.list()).length, 26);
});
test('invalid data is rejected before writes', async t => {
  const { service } = await fixture(t);
  for (const value of [{ title: '' }, { title: 'a', due: 'broken' }, { title: 'a', tag: '未知' }, { title: 'a', important: 1 }, { title: 'a', id: 'fake' }]) assert.throws(() => service.create(value), { code: 'INVALID_INPUT' });
  assert.throws(() => service.updateSettings({ toString: true }), { code: 'INVALID_INPUT' });
  assert.throws(() => service.updateSettings({ notifications: 'yes' }), { code: 'INVALID_INPUT' });
  assert.equal((await service.list()).length, 0);
});
test('search, tag, status, due and important ordering', async t => {
  const { service, now } = await fixture(t);
  const today = new Date(now()); today.setHours(12, 0, 0, 0);
  const work = await service.create({ title: '设计评审', description: 'Figma 联调', tag: '工作', important: true, due: today.toISOString() });
  await service.create({ title: '购物', tag: '生活' });
  await service.create({ title: '读书', tag: '学习', completed: true });
  assert.equal((await service.list({ search: 'FIGMA' }))[0].id, work.id);
  assert.equal((await service.list({ view: 'today' })).length, 1);
  assert.equal((await service.list({ tag: '工作', status: 'pending' })).length, 1);
  assert.equal((await service.list({ status: 'pending' })).length, 2);
  assert.equal((await service.list())[0].id, work.id);
  assert.equal(localDay(today), localDay(now()));
});
test('reminders trigger at deadline, deduplicate concurrent ticks and survive restart', async t => {
  const { service, now, directory, setTime } = await fixture(t);
  await service.create({ title: '到期事项', due: '2026-10-10T09:01:00+08:00' });
  assert.equal((await service.claimReminders()).length, 0);
  setTime('2026-10-10T09:01:00+08:00');
  const batches = await Promise.all([service.claimReminders(), service.claimReminders(), service.claimReminders()]);
  assert.equal(batches.flat().length, 1);
  const reopened = await new MemoService(directory, { now }).initialize();
  assert.equal((await reopened.claimReminders()).length, 0);
});
test('snooze, disabling notifications, completing and rescheduling', async t => {
  const { service, setTime } = await fixture(t);
  const m = await service.create({ title: '会议', due: '2026-10-10T08:00:00+08:00' });
  await service.updateSettings({ notifications: false });
  assert.equal((await service.claimReminders()).length, 0);
  await service.updateSettings({ notifications: true });
  assert.equal((await service.claimReminders()).length, 1);
  await service.snooze(m.id, 10);
  assert.equal((await service.claimReminders()).length, 0);
  setTime('2026-10-10T09:10:00+08:00');
  assert.equal((await service.claimReminders()).length, 1);
  await service.update(m.id, { completed: true });
  assert.equal((await service.claimReminders()).length, 0);
  await service.update(m.id, { completed: false, due: '2026-10-10T09:20:00+08:00' });
  assert.equal((await service.claimReminders()).length, 0);
  setTime('2026-10-10T09:20:00+08:00');
  assert.equal((await service.claimReminders()).length, 1);
});
test('import merges atomically; invalid backup never modifies data', async t => {
  const { service } = await fixture(t);
  const memo = await service.create({ title: '原始事项' });
  const backup = await service.exportData(); backup.memos[0].title = '导入内容';
  const result = await service.importData(backup);
  assert.deepEqual(result, { added: 0, updated: 1, total: 1 });
  backup.memos.push({ ...memo, id: 'new-id', title: '' });
  assert.throws(() => service.importData(backup), { code: 'INVALID_IMPORT' });
  assert.equal((await service.list()).length, 1);
  assert.equal((await service.get(memo.id)).title, '导入内容');
});
test('corrupted primary file is preserved and previous valid state is recovered', async t => {
  const { service, directory, now } = await fixture(t);
  const memo = await service.create({ title: '备份数据' });
  await service.update(memo.id, { title: '最新数据' });
  await writeFile(path.join(directory, 'memos.json'), '{broken');
  const reopened = await new MemoService(directory, { now }).initialize();
  assert.equal(reopened.recovered, true);
  assert.equal((await reopened.get(memo.id)).title, '备份数据');
  assert.ok((await readdir(directory)).some(name => name.includes('.corrupt-')));
});
test('scheduler avoids overlapping delivery and delivers all overdue items after resume', async t => {
  const { service } = await fixture(t);
  await service.create({ title: 'A', due: '2026-10-10T08:00:00+08:00' });
  await service.create({ title: 'B', due: '2026-10-10T08:00:00+08:00' });
  const delivered = [];
  const errors = [];
  const scheduler = new ReminderScheduler(service, async m => { delivered.push(m.id); }, { onError: e => errors.push(e) });
  await Promise.all([scheduler.tick(), scheduler.tick(), scheduler.tick()]);
  await scheduler.tick();
  assert.equal(delivered.length, 2);
  assert.equal(new Set(delivered).size, 2);
  assert.deepEqual(errors, []);
});
