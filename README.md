# 定位台 · 责任组制问题定位跟踪系统

面向硬件测试现场的问题定位与责任协作系统。项目按责任组运作：问题录入时选择参与责任组，系统按「责任组 + 当前星期 + 时间段 + 生效日期」解析当前排班处理人；组内转交只在本组内进行，跨组转接只选择目标责任组。状态只表达问题业务进展，不参与责任路由。

## 技术栈

- **Next.js 16 App Router + React 19 + TypeScript**
- **SQLite（better-sqlite3，WAL 模式）**：单实例部署，面向约 1,000 名用户、≤ 30 并发的内部系统
- 自研轻量领域服务（排班解析、交班、转移、审批、统计），没有引入额外工作流/微服务框架
- 服务端 Cookie 会话 + bcrypt 密码哈希；项目、责任组、组角色三层权限
- 纯 CSS 设计系统，无 UI 框架
- 内置每分钟交班调度器，也可由外部 Cron 调用交班接口

## 已实现能力

- 注册、登录、退出与项目级权限隔离；工号格式为「1 个小写字母 + 8 个数字」
- 仅系统管理员可创建项目；项目内角色包括 PM、项目主管、责任组负责人、组内普通成员
- 登录失败会明确提示账号不存在或密码错误
- 左侧项目导航可收起/展开（浏览器本地记忆状态）
- 责任组、组内成员、负责人、默认/兜底处理人、按星期与班次排班、生效日期
- 临时调班、节假日覆盖、代理值班、排班缺失兜底与异常记录
- 按当前排班解析处理人：多人全部通知，待处理少者为主处理人
- 问题录入、Excel 批量导入与模板下载、默认责任组
- 一个条码下多个问题项（报错测试项），整个条码或单项转交
- 组内转交、跨组转接、PM/主管强制转交与完整责任人路径
- 状态维护、必填定位原因、富文本 + 图片、批量状态更新
- 跨班次自动交接、组内转交指定人在新排班中的保持规则
- 条码列表作为第一个顶部标签页；搜索、筛选、分页与批量操作集中在该标签页；点击条码新开详情标签页
- 多问题跟踪群号、云主机与设备 IP、库位云主机映射、编码清单
- 高频报错项统计、按分类/责任组/时间段筛选与单项时间线
- 删除审批：有历史条码进入 PM 审批，多选合并审批，驳回通知发起人
- 站内通知发送日志、已读状态、按责任人合并通知
- 项目首页统计、我的待处理、待审核数、沟通地图排班模拟

更完整的需求映射见 [docs/VERIFICATION.md](docs/VERIFICATION.md)。

## 快速开始

环境要求：Node.js ≥ 20.9（推荐 24）、pnpm 11。

```bash
pnpm install
cp .env.example .env.local
# 开发环境可保持 .env.local 的默认值；生产必须替换 SESSION_SECRET / CRON_SECRET
pnpm seed
pnpm dev
```

访问 <http://localhost:3000>。

### 演示账号（密码均为 Demo1234）

| 工号 | 姓名 | 角色 |
|---|---|---|
| a00000001 | 系统管理员 | 全局可创建项目 / 演示项目 PM |
| p00000001 | 林晓 | 项目 PM |
| s00000002 | 陈工 | 项目主管 / 维修组夜班处理人 |
| c00000003 | 张伟 | CPU 测试组负责人 |
| c00000004 | 李娜 | CPU 测试组默认处理人 |
| c00000005 | 王强 | CPU 测试组夜班 |
| c00000006 | 刘洋 | CPU 测试组成员（用于组内转交） |
| f00000007 | 赵敏 | 风扇测试组负责人 |
| f00000008 | 周航 | 风扇测试组默认处理人 |
| r00000009 | 孙磊 | 维修组负责人 |
| t00000010 | 吴倩 | 复测组负责人 |
| q00000011 | 郑一 | 测试录入人（普通项目成员） |

`pnpm seed` 是幂等的：演示项目已存在时会跳过。

生产环境不会自动产生管理员：先注册账号，再由运维执行以下命令授予其系统管理员权限：

```bash
pnpm admin:grant <工号>
```

只有系统管理员可以创建项目；创建者自动成为该项目 PM。普通用户可等待项目 PM 将其加入项目或责任组。

## 测试与验证

```bash
pnpm typecheck      # TypeScript 严格检查
pnpm test           # 19 个领域/集成测试，使用临时 SQLite 数据库
pnpm build          # 生产构建
```

需要启动本地开发服务器后再执行的可写验证脚本（会创建用户和项目，**不要指向生产数据库**）：

```bash
pnpm test:api       # 28 组 HTTP API 端到端验证
pnpm test:ui        # 浏览器截图冒烟 + 11 组 UI 交互验证
```

详细结果与需求映射见 [docs/VERIFICATION.md](docs/VERIFICATION.md)。

## 环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `DATABASE_PATH` | SQLite 文件路径 | `./data/app.db` |
| `UPLOAD_DIR` | 富文本图片上传目录 | `./data/uploads` |
| `SESSION_SECRET` | 会话签名密钥，生产必须为强随机值 | 仅开发有回退值 |
| `CRON_SECRET` | 外部调用交班接口的密钥 | 未配置时交班 HTTP 接口不可用 |
| `APP_TIMEZONE` | 业务时区 | `Asia/Shanghai` |
| `ENABLE_SCHEDULER` | 是否启用内置交班调度器 | 仅显式 `true` 开启 |
| `COOKIE_SECURE` | 生产会话 Cookie 是否强制 HTTPS | 生产默认 `true` |
| `BACKUP_DIR` | 备份脚本输出目录 | `./backups` |

## 从 GitHub 下载并部署

GitHub 仓库：<https://github.com/920171519/factory-issue-tracker.git>

### 方式一：直接部署到 Linux 服务器

要求：Node.js ≥ 20.9（推荐 24）、pnpm 11、可持久化磁盘。首次安装 `better-sqlite3` 如无预编译包，需要 Python 3、make、g++。

```bash
# 1. 下载完整代码
git clone https://github.com/920171519/factory-issue-tracker.git
cd factory-issue-tracker

# 2. 安装依赖
pnpm install --frozen-lockfile

# 3. 配置生产环境
cp .env.example .env.production
#    编辑 .env.production，至少修改 SESSION_SECRET、CRON_SECRET
#    HTTPS 部署保持 COOKIE_SECURE=true
#    纯内网 HTTP 临时使用才设为 false

# 4. 构建
pnpm build

# 5. 可选：初始化演示项目（正式环境可跳过）
pnpm seed

# 6. 启动生产服务
pnpm start
```

默认访问地址：`http://localhost:3000`。健康检查：

```bash
curl -fsS http://127.0.0.1:3000/api/health
# {"status":"ok", ...}
```

### 首次管理员配置

系统只有「系统管理员」可以创建项目。无演示数据时：

1. 打开注册页，使用「1 个小写字母 + 8 个数字」的工号注册；
2. 在服务器项目目录执行：

```bash
pnpm admin:grant <工号>
```

3. 重新登录，即可创建项目。使用 `pnpm seed` 时，系统管理员演示账号为 `a00000001`。

### 数据与进程

- 数据库默认在 `data/app.db`，上传图片在 `data/uploads`，**两个目录都必须持久化并纳入备份**。
- 单机部署时开启内置交班调度：

  ```dotenv
  ENABLE_SCHEDULER=true
  ```

- 仅使用一个 Node.js 实例。SQLite 和内置调度器不支持多副本/PM2 cluster。
- 生产环境推荐用 PM2 + Nginx：

  ```bash
  mkdir -p logs data/uploads backups
  pnpm add -g pm2
  pm2 start deploy/ecosystem.config.cjs
  pm2 save
  ```

  Nginx 反向代理示例见 [deploy/nginx.conf.example](deploy/nginx.conf.example)。

- 备份与恢复：

  ```bash
  pnpm backup
  ```

  备份会生成数据库在线备份和上传目录快照，详细恢复步骤见部署手册。

### 方式二：Docker Compose

```bash
git clone https://github.com/920171519/factory-issue-tracker.git
cd factory-issue-tracker

export SESSION_SECRET=$(openssl rand -hex 32)
export CRON_SECRET=$(openssl rand -hex 32)
docker compose up -d --build
```

数据会持久化到宿主机 `./data`。首次配置管理员：

```bash
docker compose exec app node_modules/.bin/tsx scripts/set-admin.ts <工号>
```

如服务器没有 HTTPS，需要临时在 Compose 环境设置 `COOKIE_SECURE=false` 并明确了解风险；正式环境应使用 HTTPS。

### 后续更新

```bash
cd factory-issue-tracker
git pull origin main
pnpm install --frozen-lockfile
pnpm build
pm2 restart factory-issue-tracker
# 或 docker compose up -d --build
```

完整 Nginx、PM2、Docker、备份恢复、交班调度和安全配置见：

- [部署与运维手册](docs/DEPLOYMENT.md)
- 健康检查：`GET /api/health`
- 交班任务：`GET|POST /api/jobs/handoff`，需 `Authorization: Bearer <CRON_SECRET>` 或 `x-cron-secret`

## Git 提交约定

每次功能修改先在本地确认通过，再提交一次，避免一次提交包含过多无法回溯的改动：

```bash
pnpm verify        # typecheck + 单元测试 + 生产构建
git status
git add -A
git commit -m "feat: 简要说明本次功能"
git push origin main
```

仓库已配置 `.gitignore`，`.env*`、`data/`、`node_modules/`、`.next/`、上传文件、测试截图和备份目录不会进入提交。

## 目录结构

```
app/                Next.js 页面与 API Route Handlers
components/         页面组件与交互
lib/                领域服务（排班、问题、转移、审批、统计、导入等）
tests/              Vitest 领域/集成测试
scripts/            演示种子、E2E、UI 验证、备份
deploy/             PM2 与 Nginx 示例
docs/               部署与验证文档
```

## 设计边界

- 系统按单 Node.js 实例 + SQLite 设计。内置交班调度器、WAL 和单实例部署配合满足本系统规模；不要以 PM2 cluster 多进程或容器多副本共享同一 SQLite 文件。
- 通知渠道为站内信并保留 STUB 接口设计；后续可替换为组织现有通知系统。
- 设备当前测试条码接口为明确标注的桩实现，可替换 `lib/device-stub.ts`。
- 云主机账号密码保存在 SQLite 中，请限制数据文件与备份的访问权限。
- 富文本原因支持图片上传；图片和数据库目录都需纳入持久化与备份。
- Excel 导入逐行处理：格式正确的行会导入，错误行会在结果中列出（最多 500 行/次）。

## License

仓库根目录的 [LICENSE](LICENSE)。
