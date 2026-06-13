# 生产监控最小集

本文档给出 CTEM Platform 单机生产环境的最低监控方案。目标是先覆盖可用性、同步失败、备份、磁盘和容器健康，后续再接入企业统一监控平台。

## 1. 监控目标

最低应覆盖：

- Web 健康接口是否可访问。
- Docker Compose 服务是否运行。
- 后端容器是否健康。
- Worker 是否运行。
- 数据库备份是否按时生成。
- 生产目录磁盘空间是否充足。
- 同步任务是否出现失败堆积。
- 报表目录是否存在容量风险。

## 2. 一键巡检脚本

仓库提供轻量巡检脚本：

```bash
cd /opt/ctem-platform
BASE_URL='https://ctem.example.com' ./ops/monitor_check.sh
```

带账号后可额外检查同步任务概要：

```bash
cd /opt/ctem-platform
BASE_URL='https://ctem.example.com' \
ADMIN_USERNAME='security-admin' \
ADMIN_PASSWORD='正式管理员密码' \
./ops/monitor_check.sh
```

脚本检查内容：

- `/api/health`。
- `docker compose ps`。
- 容器运行和健康状态。
- 生产目录磁盘使用率。
- 最新数据库备份年龄。
- 登录后查询同步任务失败数和运行数。

## 3. 巡检参数

可通过环境变量调整：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `BASE_URL` | `http://localhost` | 平台访问地址 |
| `COMPOSE_FILE` | `docker-compose.prod.yml` | Compose 文件 |
| `PROJECT_DIR` | 当前目录 | 生产项目目录 |
| `BACKUP_DIR` | `$PROJECT_DIR/backups/postgres` | 数据库备份目录 |
| `DISK_PATH` | `$PROJECT_DIR` | 磁盘检查路径 |
| `DISK_WARN_PERCENT` | `85` | 磁盘使用率告警阈值 |
| `BACKUP_MAX_AGE_HOURS` | `24` | 最新备份最大允许年龄 |
| `ADMIN_USERNAME` | 空 | 管理员用户名，设置后检查同步摘要 |
| `ADMIN_PASSWORD` | 空 | 管理员密码，设置后检查同步摘要 |

## 4. Cron 定时巡检

建议每 5 分钟执行健康和容器检查，每天检查备份。

示例：

```cron
*/5 * * * * cd /opt/ctem-platform && BASE_URL='https://ctem.example.com' ./ops/monitor_check.sh >> /var/log/ctem-monitor.log 2>&1
```

如果需要检查同步失败数，可用 root 以外的受限运维账号，并通过系统安全方式注入密码。不要把真实密码写入仓库。

## 5. 日志检查

查看后端日志：

```bash
cd /opt/ctem-platform
docker compose -f docker-compose.prod.yml logs --tail=200 backend
```

查看 Worker 日志：

```bash
docker compose -f docker-compose.prod.yml logs --tail=200 worker
```

查看前端日志：

```bash
docker compose -f docker-compose.prod.yml logs --tail=200 frontend
```

建议生产环境配置日志轮转，避免宿主机日志占满磁盘。

## 6. 告警建议

建议接入企业微信、邮件、短信或统一监控平台。最低告警条件：

- `/api/health` 连续 3 次失败。
- 任一核心容器退出或 unhealthy。
- 生产目录磁盘使用率超过 85%。
- 最新数据库备份超过 24 小时。
- 同步失败任务数量持续增长。
- Worker 不运行但同步任务存在 pending/running。

## 7. 备份监控

手工备份：

```bash
cd /opt/ctem-platform
./ops/backup_db.sh
```

检查最新备份：

```bash
ls -lh /opt/ctem-platform/backups/postgres/ | tail
```

注意：

- 数据库备份不包含报表文件。
- 报表文件保存在 Docker volume `reports`。
- 需要结合磁盘快照或对象存储备份报表文件。

## 8. 容量监控

检查磁盘：

```bash
df -h /opt/ctem-platform
docker system df
```

清理无用 Docker 缓存前必须确认当前镜像和容器状态，避免误删仍需回滚的镜像。

## 9. 生产巡检记录

建议记录：

| 时间 | 版本 | 健康接口 | 容器 | 磁盘 | 备份 | 同步失败 | 处理人 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  |  | 正常 / 异常 | 正常 / 异常 |  |  |  |  |  |

巡检异常应关联处理记录，包括故障时间、影响范围、根因、恢复动作和后续改进。
