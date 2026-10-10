const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (method, ...args) => {
  const result = await ipcRenderer.invoke('memo:invoke', { method, args });
  if (!result.ok) { const error = new Error(result.error.message); error.code = result.error.code; throw error; }
  return result.data;
};
const subscribe = (channel, callback) => {
  if (typeof callback !== 'function') throw new TypeError('callback must be a function');
  const listener = (_, data) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('memo', {
  list: options => invoke('list', options), get: id => invoke('get', id),
  create: data => invoke('create', data), update: (id, data) => invoke('update', id, data),
  remove: id => invoke('remove', id), snooze: (id, minutes) => invoke('snooze', id, minutes),
  settings: () => invoke('settings'), updateSettings: data => invoke('updateSettings', data),
  exportData: () => invoke('exportData'), importData: data => invoke('importData', data),
  exportFile: () => invoke('exportFile'), importFile: () => invoke('importFile'),
  info: () => invoke('info'), showWindow: () => invoke('showWindow'),
  onChanged: callback => subscribe('memo:changed', callback),
  onReminder: callback => subscribe('memo:reminder', callback),
  onOpenMemo: callback => subscribe('memo:open', callback)
});
