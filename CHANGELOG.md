# 变更记录

按时间倒序记录每次功能修改的变更点、影响文件与验证结论。`docs/VERIFICATION.md` 保留需求与功能的完整映射。

## 2026-11-01 问题跟踪页：工具区上移 + 条码列表固定为第一个标签页

**需求**：条码列表作为第一个标签页；点击条码在其后追加详情标签页；搜索、筛选、录入问题等内容统一放到标签页上方；每次点击筛选回到第一个标签页。

**变更点**

1. 把搜索框、筛选入口、「录入问题 / 批量导入 / 下载模板」按钮从「条码列表」面板内部上移到标签栏上方，组成统一工具区（`.issues-toolbar-card`）；打开详情标签页时工具区仍然可见。
2. 标签页顺序固定为：`条码列表`（第一个）→ 各条码详情标签页（按点击顺序追加）。
3. 新增 `focusListTab()`：点击「筛选」、修改任一筛选条件、提交搜索、清除筛选、切换每页数量时，自动切回第一个标签页并滚动到页面顶部。
4. 筛选、搜索、每页数量变更统一重置到第 1 页；条码列表与详情标签页保持互斥显示。
5. 新增样式 `.issues-toolbar-card`、`.toolbar-target-hint`；宽度 ≤ 840px 时隐藏提示文案并压缩工具区内边距。
6. 新增只读 Playwright 校验脚本 `scripts/ui-issues-tabs.mjs`，并在 `package.json` 增加 `test:ui:tabs`。
7. 修正 `scripts/ui-flows.mjs` 中已过期的 `.detail-tab` 选择器为 `.issue-main-tab`。
8. 文档同步：README 能力说明、`docs/VERIFICATION.md` 第 13 节。

**影响文件**

| 文件 | 说明 |
|---|---|
| `components/issues/IssuesWorkspace.tsx` | 工具区上移、标签页顺序、筛选跳转逻辑 |
| `app/globals.css`、`app/responsive.css` | 工具区样式与移动端适配 |
| `scripts/ui-issues-tabs.mjs` | 新增校验脚本 |
| `scripts/ui-flows.mjs` | 修正过期选择器 |
| `package.json` | 新增 `test:ui:tabs` |
| `README.md`、`docs/VERIFICATION.md` | 文档同步 |

**验证**

- `pnpm typecheck`：通过
- `pnpm test`：19/19 通过
- `pnpm build`：编译成功
- `node scripts/ui-issues-tabs.mjs`：12/12 项通过（工具区位置、标签页追加与激活、筛选/搜索/每页数量跳回第一个标签页、请求参数与结果匹配、关闭全部标签页回到列表、深链接仍打开详情标签页、移动端工具区位置）

**兼容性**：未改动任何 API、数据库结构或权限逻辑，仅前端布局与交互；旧链接（如 `?barcode=<id>`、`?new=1`）行为保持不变。
