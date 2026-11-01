# 变更记录

按时间倒序记录每次功能修改的变更点、影响文件与验证结论。`docs/VERIFICATION.md` 保留需求与功能的完整映射。

## 2026-11-02 软件经理角色、在测跟踪、验证条码台账与秒级时间

**需求**：组织转测试/转验证的人改为「软件经理」角色（需新增）；项目 PM、项目主管同样可组织转测试、转验证与转正；软件包总览不再显示测试责任组（改到责任组页面配置）；所有人都可提交转测试但只能选择自己责任组内的包；测试通过后该包责任组任意成员可提交转验证申请；组织转验证时必须填写验证条码，便于后续按条码管理验证结论；需要有页面查看转测后尚未完成测试的配套包（连续转测时前一批未完成的包也要可见）；转测时间按版本记录，精确到分秒。

**变更点**

1. 新增项目角色「软件经理」：`project_members.is_software_manager`（增量迁移）；成员页可授予/撤销；侧边栏展示角色；成员 API 支持。
2. 权限调整：
   - 组织转测试 / 转验证：软件经理、项目 PM、项目主管（不再包含责任组负责人）；
   - 转正：项目 PM、项目主管；
   - 提交转测试：所有项目成员，但只能选择自己责任组内的软件包（PM/主管/软件经理可代任意责任组提交）；
   - 提交转验证：该软件包责任组任意成员、原转测申请人、PM/主管/软件经理。
3. 组织转验证时必须逐包填写验证条码（服务端 400 校验），条码在批次创建时写入；批次内仍可修改条码。
4. 软件包总览移除「测试责任组」卡片与顶部徽标；测试责任组改在「责任组」页面由 PM 配置。
5. 新增「在测跟踪」标签页：跨批次汇总已转测但未出结论的配套包，展示批次、转测版本、较正式/较上批、转测时间（秒）、入批时间、已等待时长、提交人、测试状态；「测试中」指标改用该口径。
6. 新增「验证条码台账」：按条码列出所属软件包、责任组、验证版本、验证批次、验证结论、结论时间与转正状态，支持条码/包/批次搜索。
7. 时间精度：转测申请时间、批次组织时间、在测时间、历史事件时间统一展示到秒（`YYYY-MM-DD HH:mm:ss`）。
8. 演示数据：新增软件经理账号 `m00000012`（周敏）；新增第二次转测批次 `T-2026-002`（CPLD 在测）与一条待组织的 BIOS Rev.C2 申请。

**影响文件**

| 文件 | 说明 |
|---|---|
| `lib/db.ts`、`lib/access.ts`、`lib/projects.ts` | 软件经理角色与权限 |
| `lib/packages.ts` | 组织权限、转验证条码校验、在测跟踪、条码台账 |
| `app/api/projects/[projectId]/members/**`、`package-batches/route.ts` | 角色与条码入参 |
| `components/members/MembersClient.tsx`、`components/ProjectNav.tsx` | 角色维护与展示 |
| `components/groups/GroupsClient.tsx`、`app/(app)/projects/[projectId]/groups/page.tsx` | 测试责任组配置迁入 |
| `components/packages/*` | 去掉测试责任组卡片、在测跟踪、条码台账、秒级时间、组织验证填条码 |
| `scripts/seed.ts`、`scripts/e2e-packages.mjs`、`scripts/ui-packages.mjs`、`tests/packages.test.ts` | 演示数据与校验 |
| `README.md` | 角色、能力与演示账号 |

**验证**

- `pnpm typecheck`：通过
- `pnpm test`：**37/37** 通过（新增/更新 18 项软件包领域测试：软件经理与 PM/主管组织权限、按责任组限定提交范围、组内任意成员提交转验证、组织验证必须填条码、在测跟踪跨批次、条码台账、秒级时间）
- `pnpm build`：编译成功
- `node scripts/e2e-packages.mjs`：13/13 步通过（含软件经理添加、授予角色、代提交与组织批次的完整校验）
- `node scripts/ui-packages.mjs`：10/10 项通过（总览不再显示测试责任组、在测跟踪、配套表、条码台账检索、责任组页配置测试责任组、成员页软件经理角色）

## 2026-11-01 软件包管理：转测试 / 转验证 / 转正全流程

**需求**：项目由多个软件包组成，每个包有责任组与配套关系；包在正式服务器有正式版本或验证版本。发行验证版本前必须先转测试，测试通过才能转验证版本并在正式服务器验证（逐包绑定条码），验证通过后转正。需要可追溯每个包的历史、测试情况与正式验证情况，并直观看到正式/验证/测试版本、测试中/验证中的包，以及每一批转测试的配套表——配套表需标注「相较正式版本」「相较上一次转测版本」是否更新。

**布局设计**

- 新页面「软件包管理」（左侧工作台，位于「问题跟踪」之后），顶部 5 个指标卡：软件包总数、测试中、验证中、可转正、待办申请。
- 三个标签页：`软件包总览`（三版本 + 当前状态 + 最近结论 + 历史入口 + PM 维护编码与测试责任组）、`转测试`（待组织申请队列 + 组织批次 + 全量配套表 + 逐包测试结论）、`转验证与转正`（测试通过待申请 → 待组织验证 → 验证批次绑定多条码/验证结论 → 勾选转正）。
- 顶部流程说明一行讲清「申请 → 组织转测 → 测试结论 → 转验证 → 组织验证 → 转正」，避免额外文档。

**变更点**

1. 数据模型：`code_list` 增加责任组 `group_id`、测试版本 `test_version`、验证版本 `verification_version`；`projects` 增加测试责任组 `tester_group_id`；新增 `package_requests`（转测试/转验证申请）、`package_batches`（批次）、`package_batch_items`（配套表快照）三张表，均为增量迁移（`ensureColumn` + `CREATE TABLE IF NOT EXISTS`）。
2. 新增领域服务 `lib/packages.ts`：软件包 CRUD、申请提交/撤回、批次组织（全量配套表快照与版本差异计算）、结论录入、多條码绑定、转正、历史时间线、权限判定。
3. 配套表规则：测试批次包含全部软件包，转测包取申请版本，其余包取正式版本；`updated_vs_official` 与 `updated_vs_previous` 分别表示相较正式版本、相较上一批转测版本是否更新，未转测行同时展示「未变更（随正式版本）」。
4. 权限：PM 维护软件包与测试责任组；软件包所属责任组成员可提交转测试申请；PM/主管/测试责任组负责人可组织批次；测试责任组成员（或 PM/主管）填写测试/验证结论与条码；PM/主管执行转正。
5. 新增 API：`/packages`（GET 总览 / POST 新建）、`/packages/[packageId]`（GET 历史 / PATCH / DELETE）、`/packages/settings`（测试责任组）、`/package-requests`（POST 提交 / PATCH 撤回）、`/package-batches`（POST 组织）、`/package-batches/[batchId]`（PATCH 结论 / 条码 / 转正）。
6. 新增页面与组件：`app/(app)/projects/[projectId]/packages/page.tsx`、`components/packages/*`（工作区、转测试、转验证、申请/结论弹窗、历史弹窗、徽标与条码编辑器），并补充样式与移动端适配。
7. 编码清单从「基础信息」页移除，改为跳转「软件包管理」；`InfoClient` 精简为库位云主机维护 + 软件包入口。
8. 演示数据：种子脚本补齐 3 个软件包与一条完整演示链路（转测批次 T-2026-001 → 测试结论 → 转验证 V-2026-001 → 条码 → 验证通过），并保留一个待组织转测申请与一个可转正包。

**影响文件**

| 文件 | 说明 |
|---|---|
| `lib/db.ts`、`lib/packages.ts` | 表结构与领域服务 |
| `app/api/projects/[projectId]/packages/**`、`package-requests`、`package-batches` | 新 API |
| `app/(app)/projects/[projectId]/packages/page.tsx`、`components/packages/*` | 新页面与组件 |
| `app/globals.css`、`app/responsive.css` | 页面样式与响应式 |
| `components/ProjectNav.tsx` | 新增「软件包管理」导航 |
| `components/info/InfoClient.tsx`、`app/(app)/projects/[projectId]/info/page.tsx` | 编码清单迁出 |
| `scripts/seed.ts`、`scripts/ui-packages.mjs`、`tests/packages.test.ts` | 演示数据、UI 校验、领域测试 |
| `package.json`、`README.md` | 新增 `test:ui:packages`、能力说明 |

**验证**

- `pnpm typecheck`：通过
- `pnpm test`：**34/34** 通过（新增 15 项软件包领域测试：权限、配套表版本差异、连续两批转测、结论必填说明、转验证版本一致性、多條码、转正与历史）
- `pnpm build`：编译成功
- `node scripts/ui-packages.mjs`：7/7 项通过（导航入口、三版本总览与状态、筛选、历史时间线、全量配套表与差异标记、多条码验证与转正入口、编码清单迁移）；只读，不写业务数据
- `node scripts/e2e-packages.mjs`：12/12 步通过（临时项目走完建包 → 转测 → 结论 → 转验证 → 条码 → 转正 → 历史，并校验越权/重复/必填等错误分支，结束后删除临时项目）

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
