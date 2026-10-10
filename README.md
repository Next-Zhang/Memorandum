# Memorandum

Windows 本地备忘录软件。记录重要事项、实时查看待办，并在事项到期时发送桌面提醒。

**当前阶段：后端与 Electron 桌面框架已实现，附带最小功能联调页。正式界面将通过 Figma 设计后接入。**

## 功能

- 事项新增、编辑、删除、完成与恢复，重要事项标记。
- 工作／生活／学习标签，标题与内容搜索，今日、重要、即将到来、已完成筛选。
- 按重要程度、提醒时间、创建时间排序。
- 每秒检查提醒，Windows 系统通知，点击通知定位事项，支持稍后提醒。
- 托盘常驻、单实例运行、关闭窗口后继续提醒、可选开机启动。
- 本地 JSON 原子写入、写入队列、上一次有效版本备份、损坏文件保留与备份恢复。
- JSON 导入／导出，格式校验、相同编号合并，原生文件选择窗口。
- 隔离的 Electron IPC 接口，前端不直接读写文件。

## 开发运行

Windows，Node.js 22 或更新的 LTS 版本，npm。

```sh
npm install
npm test
npm start
```

首次安装需联网下载 Electron。启动后显示联调页，可验证增删改查、提醒与设置。

`npm run test:desktop` 使用隔离的临时目录测试真实 Electron preload 与 IPC 的增删改查，不影响个人数据。后端包含 9 项测试，覆盖持久化、并发写入、参数校验、筛选、提醒去重、稍后提醒、导入及备份恢复。

```sh
npm run build
```

生成的 Windows 便携版位于 `release/`。当前没有代码签名证书。开机启动建议在稳定位置保存打包程序后开启，移动程序后应重新设置。

## 前端接入

Figma 设计实现为前端后，替换 `index.html`、`app.js`、`style.css`。通过 `window.memo` 调用业务接口，类型见 [desktop/api.d.ts](desktop/api.d.ts)，详细约定见 [docs/API.md](docs/API.md)。

```js
const memo = await window.memo.create({
  title: '项目评审',
  tag: '工作',
  important: true,
  due: new Date('2026-10-12T14:00:00+08:00').toISOString()
});
const items = await window.memo.list({ view: 'important', status: 'pending' });
const unsubscribe = window.memo.onChanged(() => refreshList());
// 组件卸载时调用 unsubscribe()
```

## 数据与提醒行为

- 数据目录由 Electron `app.getPath('userData')` 确定，可在联调页或 `window.memo.info()` 查看。
- 所有时间以 ISO 8601 存储，前端按用户本地时区显示；今日事项按本地日历日判断。
- 关闭窗口默认隐藏到系统托盘，提醒继续运行；托盘菜单选择「退出」会停止提醒。
- 电脑关机、休眠或软件完全退出时无法提醒，恢复运行后补发尚未通知的到期事项。
- 通知是否显示受 Windows 通知设置及勿扰模式影响。系统通知不等于用户已阅读。
- 已到期事项通知状态持久化，重启不重复通知；修改到期时间、恢复待办或稍后提醒会重新安排通知。
- 调度采用先持久化通知状态再投递的去重方式。极端情况下若写入后、投递前进程崩溃，该次系统通知可能未显示；事项仍在列表保留。当前不提供系统级定时唤醒或通知送达确认。
- 备份为上一次成功写入前的有效状态，恢复可能丢失最后一次修改。请定期导出备份。
- 当前不含账号登录、云同步或多设备功能，数据未加密。

## 目录

```text
backend/service.js     数据与业务逻辑
backend/scheduler.js   提醒调度
desktop/main.cjs       桌面窗口、托盘、通知与 IPC
desktop/preload.cjs    安全的前端桥接接口
desktop/api.d.ts       前端 TypeScript 类型
model.js              过滤、日期与排序函数
tests/                后端自动化测试
docs/API.md           接口与错误约定
index.html            临时功能联调页
```

## License

[MIT](LICENSE) © 2026 Next-Zhang
