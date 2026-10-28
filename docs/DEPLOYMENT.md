# 部署与运维手册

本文档以「单台 Linux 服务器 + 单个 Node.js 进程 + SQLite」为正式部署模型，适用于约 1,000 名用户、并发 ≤ 30 的内部部署。也可使用提供的 Docker Compose。系统不建议使用 PM2 cluster 或多副本共享同一 SQLite 文件。

## 1. 运行要求

- Node.js **24 LTS**（最低 20.9）
- pnpm **11.5**
- 可选：Nginx、PM2、Docker 24+ / Docker Compose v2
- 构建原生依赖 `better-sqlite3` 时需要 Python 3、make、g++（无预编译包时）
- 持久化目录：
  - 数据库：`DATABASE_PATH`，例如 `/srv/factory-issue-tracker/data/app.db`
  - 图片：`UPLOAD_DIR`，例如 `/srv/factory-issue-tracker/data/uploads`
  - 备份：`BACKUP_DIR`

> 时区：业务按 `APP_TIMEZONE`（默认 Asia/Shanghai）计算星期与班次。建议同时设置系统/容器环境变量 `TZ=Asia/Shanghai`。

## 2. 环境变量

复制并修改：

```bash
cp .env.example .env.production
```

生产至少修改：

```dotenv
DATABASE_PATH=./data/app.db
UPLOAD_DIR=./data/uploads
SESSION_SECRET=<openssl rand -hex 32 的输出>
CRON_SECRET=<openssl rand -hex 32 的输出>
APP_TIMEZONE=Asia/Shanghai
ENABLE_SCHEDULER=true
COOKIE_SECURE=true
```

- `SESSION_SECRET` 长度至少 32 字节，更换会导致所有会话失效。
- `CRON_SECRET` 用于保护外部触发交班接口；即使使用内置调度器也建议配置。
- HTTPS 部署保持 `COOKIE_SECURE=true`。若仅在无 HTTPS 的内网 HTTP 上临时运行，可设为 `false`，但会话和数据会以明文传输，生产不推荐。
- Next.js 会自动读取 `.env.production`；用 PM2/systemd/Docker 时也可显式注入环境变量。

## 3. 方式 A：Node.js + PM2 + Nginx（推荐）

### 3.1 安装与构建

```bash
# 建议使用专用系统账号运行
sudo useradd --system --create-home --shell /usr/sbin/nologin issue-tracker || true
sudo mkdir -p /srv/factory-issue-tracker
sudo chown -R issue-tracker:issue-tracker /srv/factory-issue-tracker

sudo -u issue-tracker bash
cd /srv/factory-issue-tracker
# 将代码放到当前目录
cp .env.example .env.production
vi .env.production
pnpm install --frozen-lockfile
pnpm build
# 可选：仅演示环境需要
# pnpm seed
```

> 正式环境无需执行演示种子。首次使用：先在页面注册账号，再由运维执行 `pnpm admin:grant <工号>` 授予系统管理员权限；只有系统管理员可以创建项目，创建者自动成为该项目 PM。未授予管理员权限的账号只能等待项目 PM 邀请。

### 3.2 PM2 启动

```bash
mkdir -p logs data/uploads backups
pnpm add -g pm2
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup
```

`deploy/ecosystem.config.cjs` 已设置 `instances: 1`、`exec_mode: fork`。**不要改用 cluster 模式**。

PM2 默认不读取 `.env.production` 作为进程环境，但 Next.js 自身会读取该文件；为确保环境变量明确可见，也可以在 ecosystem 文件的 `env` 中配置路径与密钥，或使用 `dotenv-cli`。

### 3.3 Nginx

参考 [deploy/nginx.conf.example](../deploy/nginx.conf.example)。关键点：

- `client_max_body_size 12m;` 以支持 Excel 导入与图片上传
- 反向代理到 `127.0.0.1:3000`
- 保留 `Host`、`X-Forwarded-For`、`X-Forwarded-Proto`
- 配置 HTTPS 证书

```bash
sudo nginx -t && sudo systemctl reload nginx
```

防火墙只开放 80/443；3000 端口仅监听本机或内网。

### 3.4 启动后检查

```bash
curl -fsS http://127.0.0.1:3000/api/health
# {"status":"ok", ...}
```

浏览器验证登录、上传图片、创建问题、下载 Excel 模板。

## 4. 方式 B：Docker Compose

仓库提供 `Dockerfile` 与 `docker-compose.yml`，运行镜像内保留构建与脚本文件，便于执行备份/演示种子。

先生成密钥并导出：

```bash
export SESSION_SECRET=$(openssl rand -hex 32)
export CRON_SECRET=$(openssl rand -hex 32)
# 仅在无 HTTPS 的内网 HTTP 环境设置（不推荐生产使用）
# export COOKIE_SECURE=false
docker compose up -d --build
```

数据持久化到宿主机的 `./data`，备份到 `./backups`。

```bash
# 健康检查
curl -fsS http://127.0.0.1:3000/api/health
# 可选：载入演示数据
docker compose exec app node_modules/.bin/tsx scripts/seed.ts
# 生产首次部署：授予已有账号系统管理员权限
docker compose exec app node_modules/.bin/tsx scripts/set-admin.ts <工号>
# 备份
docker compose exec app node scripts/backup.mjs
# 查看日志
docker compose logs -f app
```

> Compose 文件要求必须提供 `SESSION_SECRET` 和 `CRON_SECRET`，否则启动会失败。建议把变量写入未被版本控制的 `.env` 文件，再执行 `docker compose up -d --build`。公网/生产通过 HTTPS 反向代理访问并将 `COOKIE_SECURE` 保持为 `true`。

如 Docker 构建时原生模块需要编译，Dockerfile 已安装 python3/make/g++。

## 5. 交班调度

系统在班次边界（新的星期或时间段）按各参与责任组的当前排班自动重新解析处理人，并生成「班次交接」历史。状态不参与交接；组内转交指定人若在目标班次排班中仍然出现，则保持。

### 5.1 推荐：内置调度器

```dotenv
ENABLE_SCHEDULER=true
```

- 启动后每 60 秒检查一次，单进程内互斥。
- 服务启动后先初始化各责任组当前班次键，不重复交接。
- **只允许一个进程运行内置调度器**，否则会出现重复检查。

### 5.2 可选：外部 Cron

若关闭内置调度器，可在系统 crontab 每分钟调用：

```cron
* * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/jobs/handoff >/var/log/fit-handoff.log 2>&1
```

并通过服务器环境或只读脚本安全提供 `CRON_SECRET`，不要写在命令行历史中。外部 Cron 与内置调度器任选其一，不要同时启用。

## 6. 备份、恢复与升级

### 6.1 备份

```bash
pnpm backup
# 或 docker compose exec app node scripts/backup.mjs
```

脚本调用 SQLite 在线备份 API，并将 `UPLOAD_DIR` 一起复制到 `backups/<时间戳>/`。建议：

- 每日备份，保留至少 14–30 天
- 备份完成后复制到独立主机/对象存储
- 定期在一台隔离主机验证恢复

不要只复制运行中的 `app.db` 而忽略 WAL 文件；请使用备份脚本或 `sqlite3 .backup`。

### 6.2 恢复

```bash
# 1) 停止应用
pm2 stop factory-issue-tracker
# 2) 备份当前数据
mv data/app.db data/app.db.bad
mv data/uploads data/uploads.bad
# 3) 从备份恢复
cp backups/<timestamp>/app.db data/app.db
cp -R backups/<timestamp>/uploads data/uploads
# 4) 权限
chown -R issue-tracker:issue-tracker data
# 5) 启动
pm2 start factory-issue-tracker
```

Docker 环境在宿主机 `./data` 下执行同样操作，然后 `docker compose restart app`。

### 6.3 升级

```bash
pnpm backup
git pull            # 或解压新版本
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pm2 restart factory-issue-tracker
```

升级前必须备份数据库和上传目录。当前版本不会删除既有表；如未来新增迁移，需按迁移说明执行。

## 7. 容量、并发和安全

- 单 Node 进程 + SQLite WAL 可支撑本系统规模。已设置 `busy_timeout=5000`、外键约束与索引。
- **不要使用 PM2 cluster 或共享网络盘上的 SQLite 多实例**。如需高可用或多副本，应先迁移到 PostgreSQL，并把交班任务放到外部调度系统。
- `SESSION_SECRET` 泄露可伪造会话；`CRON_SECRET` 泄露可触发交班检查。
- 云主机账号密码是明文业务配置，限制 `data/`、备份目录和服务器访问权限，最好使用磁盘加密。
- 建议在 Nginx/网关对登录接口做频率限制，并限制管理端访问来源。
- 系统管理员是全局创建项目的唯一入口；请仅授予可信运维或项目负责人，并定期审计 `users.is_system_admin`。
- 登录错误会明确区分账号不存在与密码错误，便于内网用户排查，但也意味着存在账号枚举；对外网暴露时应配合网关限流。
- HTTPS 下保持 Secure Cookie；不要关闭 `COOKIE_SECURE`。
- 上传接口限制 5MB 图片和 MIME 类型，仍建议对上传目录做防病毒扫描与定期清理。
- 上传文件通过登录态接口读取，数据库只保存相对 URL；备份时必须同时备份 `UPLOAD_DIR`。

## 8. 常见问题

| 现象 | 排查 |
|---|---|
| 启动报缺少 `SESSION_SECRET` | 生产必须设置环境变量；开发未设置时有回退值 |
| 登录成功后反复跳登录 | 生产 HTTP 环境下 Secure Cookie 被浏览器丢弃；改用 HTTPS，或临时设置 `COOKIE_SECURE=false` |
| 班次没有自动交接 | 检查 `ENABLE_SCHEDULER=true` 或外部 Cron；检查服务时间时区；查看日志中 `[scheduler] handoff` |
| 图片显示 404 | 检查 `UPLOAD_DIR` 是否持久化、是否随部署被清空，旧备份恢复后缺失图片 |
| Excel 导入失败 | 使用项目内下载的最新模板；检查表头、工号/责任组名称、条码是否重复 |
| 原生模块加载失败 | 在目标平台重新 `pnpm rebuild better-sqlite3`，安装编译工具链 |
| 无法删除/停用责任组 | 责任组仍参与问题；先完成转接，再停用/删除 |
| 删除条码未立即消失 | 条码有定位原因或责任人变更历史，需 PM 审批；在删除审批页处理 |
| 通知数不更新 | 通知是站内发送日志；刷新页面或点开通知中心；外部短信/IM 通道尚未接入 |

## 9. 验证与验收

部署后执行：

```bash
curl -fsS http://127.0.0.1:3000/api/health
pnpm typecheck
pnpm test
```

浏览器验收建议：

1. 用系统管理员账号登录并创建项目；再添加项目成员、创建责任组与排班。
2. 用测试成员录入条码，确认当前班次处理人收到站内通知。
3. 使用处理人更新状态为「已定位」，填写原因，确认待处理数下降。
4. 执行组内转交与跨组转接，并在条码详情核对责任人路径。
5. 配置临时调班并模拟沟通地图。
6. 导入 Excel、查看高频报错统计、提交删除审批并以 PM 审批。
7. 在无 HTTPS 的临时内网使用 `COOKIE_SECURE=false`，验证图片与上传持久化。

详细测试结果见 [VERIFICATION.md](VERIFICATION.md)。
