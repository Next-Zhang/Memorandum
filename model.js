export const STORE_KEY = 'shiguang-memo-v1';
export const TAGS = ['工作', '生活', '学习'];
export function localDay(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function isToday(memo, now = new Date()) { return !!memo.due && localDay(memo.due) === localDay(now); }
export function isDue(memo, now = Date.now()) { return !memo.completed && !!memo.due && new Date(memo.due).getTime() <= Number(now); }
export function validMemo(m) {
  return m && typeof m.id === 'string' && m.id.length > 0 && m.id.length <= 200 && typeof m.title === 'string' && m.title.trim().length > 0 && m.title.length <= 100 && typeof m.description === 'string' && m.description.length <= 5000 && TAGS.includes(m.tag) && typeof m.important === 'boolean' && typeof m.completed === 'boolean' && (m.due === null || (typeof m.due === 'string' && Number.isFinite(Date.parse(m.due)))) && typeof m.createdAt === 'string' && Number.isFinite(Date.parse(m.createdAt));
}
export function selectMemos(memos, { view = 'all', tag = null, status = 'pending', search = '', sort = 'smart' } = {}, now = new Date()) {
  const query = search.trim().toLocaleLowerCase();
  return memos.filter(m => {
    if (view === 'completed' ? !m.completed : status === 'pending' ? m.completed : status === 'completed' ? !m.completed : false) return false;
    if (view === 'today' && !isToday(m, now)) return false;
    if (view === 'important' && !m.important) return false;
    if (view === 'upcoming' && (!m.due || new Date(m.due) <= now)) return false;
    if (tag && m.tag !== tag) return false;
    return !query || `${m.title} ${m.description} ${m.tag}`.toLocaleLowerCase().includes(query);
  }).sort((a, b) => {
    if (sort === 'newest') return new Date(b.createdAt) - new Date(a.createdAt);
    if (sort === 'smart' && a.important !== b.important) return Number(b.important) - Number(a.important);
    return (a.due ? Date.parse(a.due) : Infinity) - (b.due ? Date.parse(b.due) : Infinity) || Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}
export function countdown(due, now = Date.now()) {
  const delta = new Date(due).getTime() - Number(now);
  const minutes = Math.ceil(Math.abs(delta) / 60000);
  if (delta <= 0) return { text: minutes < 1 ? '刚刚到期' : minutes < 60 ? `已逾期 ${minutes} 分钟` : minutes < 1440 ? `已逾期 ${Math.floor(minutes / 60)} 小时` : `已逾期 ${Math.floor(minutes / 1440)} 天`, overdue: true };
  return { text: minutes < 60 ? `${minutes} 分钟后` : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟后` : `${Math.floor(minutes / 1440)} 天后`, overdue: false };
}
