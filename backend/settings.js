import { MemoError } from './service.js';
export function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.entries(input).some(([key, value]) => !['notifications', 'launchAtLogin', 'closeToTray'].includes(key) || typeof value !== 'boolean')) throw new MemoError('INVALID_INPUT', '设置参数无效');
}
