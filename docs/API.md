# 前端接口

接口通过 Electron preload 暴露为 `window.memo`。不需要 HTTP 服务或访问令牌，也不能在普通浏览器中直接调用。所有操作返回 Promise，异常含 `code` 和 `message`。完整类型见 [`desktop/api.d.ts`](../desktop/api.d.ts)。

| 方法 | 功能 |
| --- | --- |
| `list(options?)` | 获取筛选排序后的事项；默认全部状态 |
| `get(id)` | 获取单个事项 |
| `create(fields)` | 创建；仅标题必填 |
| `update(id, fields)` | 部分更新，不接受 id、时间戳等内部字段 |
| `remove(id)` | 永久删除，前端应先确认 |
| `snooze(id, minutes = 10)` | 1–10080 分钟后重新提醒 |
| `settings()` | 读取设置 |
| `updateSettings(fields)` | 部分更新设置 |
| `exportData()` / `importData(backup)` | 内存中的 JSON 备份操作 |
| `exportFile()` / `importFile()` | 原生文件对话框与备份操作 |
| `info()` | 版本、数据目录、通知支持、是否从备份恢复 |
| `showWindow()` | 显示窗口 |
| `onChanged(callback)` | 数据或设置变化事件 |
| `onReminder(callback)` | 到期事件，参数为事项 |
| `onOpenMemo(callback)` | 点击系统通知事件，参数为事项 id |

事件订阅返回取消订阅函数。`onChanged` 不携带数据，请重新调用 `list`。如果窗口尚未加载或隐藏，仍应通过列表状态显示逾期事项，不依赖事件作为唯一数据源。

## 事项

输入字段：`title`（去除两端空白后 1–100 字符）、`description`（最多 5000 字符）、`tag`（工作／生活／学习）、`important`、`completed`、`due`（ISO 日期字符串或 null）。未指定字段默认空内容、生活标签、不重要、未完成、无提醒。

返回额外字段：`id`（UUID）、`createdAt`、`updatedAt`、`notifiedAt`、`snoozedUntil`。禁止前端通过 create/update 写内部字段。

`list` 参数：

```js
{
  view: 'all',       // all | today | important | upcoming | completed
  status: 'all',     // all | pending | completed
  tag: null,        // null | 工作 | 生活 | 学习
  search: '',       // 标题、内容、标签，不区分英文大小写
  sort: 'smart'     // smart | due | newest
}
```

`completed` 视图覆盖 status 条件。`upcoming` 仅包含提醒时间晚于当前时间的事项。`smart` 先按重要标记，再按提醒时间排序；无提醒时间排在有时间事项之后。

## 设置

```js
{ notifications: true, launchAtLogin: false, closeToTray: true }
```

关闭 notifications 同时关闭应用内到期事件与系统通知；重新开启后补发未通知的到期事项。closeToTray 为 false 时关闭窗口即退出软件。

## 备份

格式为 `{ version: 1, exportedAt: ISO时间, memos: Memo[] }`。导入最多 10000 条，文件最多 20 MB；重复编号、非法字段值会整批拒绝。与本地相同 id 的内容按备份覆盖；其他本地事项保留。设置不随事项备份导入。导入返回 `{ added, updated, total }`。文件对话框取消时返回 `{ canceled: true }`。

## 错误

| code | 含义 |
| --- | --- |
| INVALID_INPUT | 参数类型、字段或长度不正确 |
| NOT_FOUND | 事项不存在，可能被其他操作删除 |
| INVALID_IMPORT | 备份格式或大小不正确 |
| STORAGE_CORRUPT | 数据及备份无法读取，原文件保留 |
| FORBIDDEN | IPC 调用来源不合法 |
| INTERNAL_ERROR | 未分类的系统错误 |

原生文件系统错误可能返回 `EACCES`、`ENOSPC` 等系统 code。操作失败时前端应显示错误，不能将内容标记为已保存。
