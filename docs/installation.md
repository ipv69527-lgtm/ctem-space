# 部署手册

本文档用于 CTEM Platform 的本地开发、单机生产部署、远端发布、升级回滚和上线验收。所有命令中的域名、账号、密码和 Token 都是示例，请按实际环境替换。

## 1. 部署架构

CTEM Platform 采用 Docker Compose 单机部署，适合内网或专有云环境快速交付。

核心服务：

- `frontend`：Nginx 托管 React 前端，默认暴露 `80`。
- `backend`：FastAPI 后端，默认暴露 `8000`。
- `worker`：Celery Worker 和定时任务，负责同步任务、自动任务等后台处理。
- `postgres`：PostgreSQL 16，保存业务数据、审计日志、同步任务和报表元数据。
- `redis`：Celery Broker、Result Backend 和运行期缓存。

持久化数据：

- PostgreSQL 数据：Docker volume `pgdata`。
- 报表文件：Docker volume `reports`，容器内路径 `/data/reports`。
- 数据库备份：默认保存到服务器目录 `/opt/ctem-platform/backups/postgres/`。
- 发布前源码备份：默认保存到服务器目录 `/opt/ctem-platform/releases/`。

## 2. 环境要求

最低配置：

- Linux x86_64 服务器。
- Docker 24+。
- Docker Compose v2。
- Git。
- 2 CPU、4 GB 内存、20 GB 可用磁盘。

推荐生产配置：

- 4 CPU、8 GB 内存、100 GB 可用磁盘。
- 独立数据盘或定期快照。
- 固定内网 IP 或域名。
- 已配置 NTP 时间同步。
- 已配置服务器防火墙，只开放必要端口。

端口规划：

| 端口 | 服务 | 说明 |
| --- | --- | --- |
| `80` | frontend | Web 访问入口 |
| `8000` | backend | API 入口，生产环境可仅限内网访问 |
| `5432` | postgres | 容器内部使用，默认不对外暴露 |
| `6379` | redis | 容器内部使用，默认不对外暴露 |

## 3. 获取代码

```bash
git clone https://github.com/ipv69527-lgtm/ctem-space.git
cd ctem-space
```

如使用压缩包部署，确保目录内包含：

```text
backend/
frontend/
ops/
docs/
docker-compose.prod.yml
.env.example
README.md
```

## 4. 环境变量配置

复制示例配置：

```bash
cp .env.example .env
```

必须修改以下配置：

```env
DB_PASSWORD=replace-with-a-strong-database-password
JWT_SECRET=replace-with-a-random-64-char-hex-secret
ADMIN_USERNAME=replace-with-admin-username
ADMIN_PASSWORD=replace-with-a-strong-admin-password
ADMIN_NAME=Security Administrator
ADMIN_EMAIL=security-admin@example.com
```

生成 `JWT_SECRET`：

```bash
openssl rand -hex 32
```

密码要求：

- 初始管理员密码至少 12 位。
- 必须包含大写字母、小写字母、数字和特殊字符。
- 不允许使用历史演示账号密码，例如 `admin/admin123`。
- 不要多人共用管理员账号，后续应在前端用户管理中创建正式个人账号。

RaySpace/Space 接入配置：

```env
SPACE_API_BASE_URL=https://space-api.example.com
SPACE_API_USERNAME=
SPACE_API_PASSWORD=
SPACE_API_KEY=
SPACE_MOCK_MODE=false
```

运行期存储配置：

```env
STORAGE_DIR=/tmp/ctem-storage
REPORT_DIR=/tmp/ctem-storage/reports
REDIS_URL=redis://redis:6379/0
DATABASE_URL=postgresql+asyncpg://ctem:${DB_PASSWORD}@postgres:5432/ctem
```

安全要求：

- `.env` 只保存在服务器，不提交到 Git。
- 不把数据库备份、报表文件、SSH 私钥、API Key、Token、生产密码上传到仓库。
- 生产环境修改 `.env` 后需要重启相关容器。

## 5. 本地开发启动

本地开发使用 `docker-compose.yml`：

```bash
docker compose up -d
docker compose exec backend alembic upgrade head
docker compose exec backend python -m app.cli.init_db
docker compose exec backend python -m app.cli.create_admin
```

访问地址：

- 前端开发服务：`http://localhost:5173`
- 后端 API：`http://localhost:8000`
- API 文档：`http://localhost:8000/docs`

常用开发命令：

```bash
docker compose ps
docker compose logs -f backend
docker compose logs -f worker
docker compose down
```

## 6. 单机生产首次部署

以下以服务器目录 `/opt/ctem-platform` 为例。

创建目录：

```bash
sudo mkdir -p /opt/ctem-platform
sudo chown "$USER":"$USER" /opt/ctem-platform
```

复制代码到服务器后进入目录：

```bash
cd /opt/ctem-platform
cp .env.example .env
```

按第 4 节修改 `.env` 后启动：

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

生产 Compose 会自动执行：

1. PostgreSQL 和 Redis 健康检查。
2. Alembic 数据库迁移。
3. 初始化基础数据。
4. 创建或更新初始超级管理员。
5. 启动 FastAPI、Celery Worker 和前端 Nginx。

检查容器状态：

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f backend
```

访问：

```text
http://服务器IP/
```

## 7. 从本机发布到远端

仓库提供 `ops/deploy_prod.sh`，用于从本机打包并发布到远端服务器。

前置条件：

- 本机可以 SSH 登录远端服务器。
- 远端已经准备好 Docker 和 Docker Compose。
- 远端目录中已经放置过生产 `.env`，或部署前手工创建好。
- `.env` 不会被发布脚本覆盖。

发布命令：

```bash
REMOTE_HOST='deploy@example.com' REMOTE_DIR='/opt/ctem-platform' ./ops/deploy_prod.sh
```

如果部署到内网主机，替换为实际 SSH 地址：

```bash
REMOTE_HOST='user@192.0.2.10' REMOTE_DIR='/opt/ctem-platform' ./ops/deploy_prod.sh
```

发布脚本会执行：

1. 打包当前代码，排除 `frontend/node_modules`、`frontend/dist`、`backups` 等目录。
2. 上传压缩包到远端。
3. 备份远端当前源码到 `releases/predeploy-*.tar.gz`。
4. 执行数据库备份。
5. 解包新版本代码。
6. 构建 `backend`、`worker`、`frontend` 镜像。
7. 执行 Alembic 迁移。
8. 启动 `backend`、`worker`、`frontend`。

## 8. 部署后验收

基础健康检查：

```bash
BASE_URL='https://ctem.example.com' ./ops/health_check.sh
```

一键生产验收：

```bash
BASE_URL='https://ctem.example.com' ADMIN_USERNAME='security-admin' ADMIN_PASSWORD='正式管理员密码' ./ops/acceptance_check.sh
```

验收脚本覆盖：

- 登录和当前用户接口。
- 基础健康和深度健康。
- 单位、资产、漏洞、模板、报表、同步任务接口。
- 权限控制。
- 数据校验。
- 资产人工编辑和变更记录。
- Word 模板上传、报表生成、下载和清理。
- 同步条件模板创建和清理。

人工验收建议：

1. 登录前端，确认没有演示账号入口。
2. 进入用户管理，确认只保留正式账号。
3. 进入系统设置，配置 RaySpace/Space 连接并测试。
4. 执行一次条件同步，确认同步任务中心状态正常。
5. 进入资产管理，确认端口、单位名称、经纬度、厂商等字段显示正常。
6. 进入漏洞管理，确认 `CVE版本匹配` 与 `POC已验证命中` 区分正常。
7. 展开 POC 漏洞，确认验证时间、验证证据和漏洞描述可读。
8. 进入数据质量页，确认未归属资产、缺经纬度、缺端口等统计可用。
9. 生成一份报表并下载，确认 Word 模板渲染正常。
10. 查看审计日志，确认关键操作有记录。

## 9. 升级发布

升级前检查：

```bash
git status --short
git log --oneline -5
```

建议流程：

1. 确认当前代码已提交。
2. 确认 `.env` 不在 Git 跟踪中。
3. 本地运行前端构建或必要检查。
4. 执行远端发布脚本。
5. 等待容器健康。
6. 运行一键验收脚本。
7. 记录本次版本号和提交哈希。

本地前端构建检查：

```bash
cd frontend
npm run build
```

后端语法检查示例：

```bash
PYTHONPATH=backend python3 - <<'PY'
from pathlib import Path
for path in Path('backend/app').rglob('*.py'):
    compile(path.read_text(), str(path), 'exec')
print('python compile ok')
PY
```

## 10. 数据库迁移

生产启动和发布脚本都会执行：

```bash
docker compose -f docker-compose.prod.yml run --rm backend alembic upgrade head
```

手工检查当前迁移版本：

```bash
docker compose -f docker-compose.prod.yml exec postgres psql -U ctem -d ctem -c "select * from alembic_version;"
```

注意：

- 不要手工删除 `alembic_version`。
- 不要在生产库直接修改表结构，除非已经同步到 Alembic 迁移文件。
- 升级失败时先保留日志，再判断是否回滚源码或恢复数据库。

## 11. 备份与恢复

数据库备份：

```bash
cd /opt/ctem-platform
./ops/backup_db.sh
```

默认输出目录：

```text
/opt/ctem-platform/backups/postgres/
```

调整备份保留数量：

```bash
RETENTION=30 ./ops/backup_db.sh
```

数据库恢复：

```bash
cd /opt/ctem-platform
CONFIRM_RESTORE=YES ./ops/restore_db.sh /opt/ctem-platform/backups/postgres/ctem-YYYYmmdd-HHMMSS.dump
```

恢复注意事项：

- 恢复会覆盖当前数据库。
- 恢复脚本会先做一份恢复前备份。
- 报表文件在 `reports` volume 中，数据库备份不包含实际报表文件。
- 恢复前确认备份来自同一系统或兼容版本。

## 12. 回滚

远端发布脚本每次发布前会保存源码包：

```text
/opt/ctem-platform/releases/predeploy-YYYYmmdd-HHMMSS.tar.gz
```

回滚最近版本：

```bash
cd /opt/ctem-platform
./ops/rollback_prod.sh
```

指定版本回滚：

```bash
./ops/rollback_prod.sh /opt/ctem-platform/releases/predeploy-YYYYmmdd-HHMMSS.tar.gz
```

回滚脚本会：

1. 执行数据库备份。
2. 恢复指定源码包。
3. 重新构建镜像。
4. 执行迁移。
5. 启动服务。

如果发布包含破坏性数据库迁移，单纯源码回滚可能不足，需要配合数据库备份恢复。

## 13. 常见故障排查

查看容器状态：

```bash
docker compose -f docker-compose.prod.yml ps
```

查看后端日志：

```bash
docker compose -f docker-compose.prod.yml logs -f backend
```

查看后台任务日志：

```bash
docker compose -f docker-compose.prod.yml logs -f worker
```

查看前端日志：

```bash
docker compose -f docker-compose.prod.yml logs -f frontend
```

常见问题：

| 现象 | 排查方向 |
| --- | --- |
| 前端打不开 | 检查 `frontend` 是否启动、80 端口是否被占用、防火墙是否放行 |
| 登录失败 | 检查初始管理员是否创建、密码策略是否满足、后端日志是否有认证错误 |
| 后端不健康 | 检查 `postgres`、`redis` 健康状态和 `.env` 中 `DB_PASSWORD/JWT_SECRET` |
| 同步任务不执行 | 检查 `worker` 是否运行、Redis 是否健康、同步配置是否启用 |
| RaySpace 查询失败 | 检查 `SPACE_API_BASE_URL`、账号/API Key、网络连通、Token 过期重试日志 |
| 报表下载失败 | 检查 `reports` volume、`REPORT_DIR`、后端日志和磁盘空间 |
| 迁移失败 | 检查 Alembic 日志、数据库连接、迁移版本号长度和表结构冲突 |

进入数据库：

```bash
docker compose -f docker-compose.prod.yml exec postgres psql -U ctem -d ctem
```

查看关键数据量：

```sql
select count(*) from units;
select count(*) from assets;
select count(*) from vulnerabilities;
select status, count(*) from sync_tasks group by status;
```

## 14. 安全上线清单

上线前必须确认：

- `.env` 已使用强密码和随机 `JWT_SECRET`。
- 没有启用演示账号和默认密码。
- 初始管理员已改为正式账号。
- 生产 `.env` 没有提交到 Git。
- 数据库、Redis 没有直接暴露到公网。
- 服务器只开放必要端口。
- 已配置备份目录和备份保留策略。
- 已跑通一键验收脚本。
- 已记录版本提交哈希。
- 已确认 RaySpace/Space Token、账号、API Key 不写入文档或仓库。

更多发布、备份、恢复和回滚细节见 [运维手册](operations.md)。
