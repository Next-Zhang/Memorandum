export type Tag = '工作' | '生活' | '学习';
export interface MemoFields { title: string; description: string; tag: Tag; important: boolean; completed: boolean; due: string | null; }
export interface Memo extends MemoFields { id: string; createdAt: string; updatedAt: string; notifiedAt: string | null; snoozedUntil: string | null; }
export interface ListOptions { view?: 'all' | 'today' | 'important' | 'upcoming' | 'completed'; status?: 'all' | 'pending' | 'completed'; tag?: Tag | null; search?: string; sort?: 'smart' | 'due' | 'newest'; }
export interface Settings { notifications: boolean; launchAtLogin: boolean; closeToTray: boolean; }
export interface Backup { version: 1; exportedAt: string; memos: Memo[]; }
export interface MemoApi {
  list(options?: ListOptions): Promise<Memo[]>;
  get(id: string): Promise<Memo>;
  create(data: Pick<MemoFields, 'title'> & Partial<Omit<MemoFields, 'title'>>): Promise<Memo>;
  update(id: string, data: Partial<MemoFields>): Promise<Memo>;
  remove(id: string): Promise<{ id: string }>;
  snooze(id: string, minutes?: number): Promise<Memo>;
  settings(): Promise<Settings>;
  updateSettings(data: Partial<Settings>): Promise<Settings>;
  exportData(): Promise<Backup>;
  importData(data: Backup): Promise<{ added: number; updated: number; total: number }>;
  exportFile(): Promise<{ canceled: boolean; path?: string }>;
  importFile(): Promise<{ canceled: true } | { added: number; updated: number; total: number }>;
  info(): Promise<{ version: string; dataDirectory: string; notificationsSupported: boolean; recovered: boolean }>;
  showWindow(): Promise<boolean>;
  onChanged(callback: () => void): () => void;
  onReminder(callback: (memo: Memo) => void): () => void;
  onOpenMemo(callback: (id: string) => void): () => void;
}
declare global { interface Window { memo: MemoApi; } }
