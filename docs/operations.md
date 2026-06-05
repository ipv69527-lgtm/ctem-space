# CTEM 运维手册

## 生产信息

以下内容请按实际部署环境替换，不要把真实密码、Token、API Key 写入仓库。

- 访问地址：`https://ctem.example.com`
- SSH：`deploy@example.com`
- 远端目录：`/opt/ctem-platform`
- Compose 文件：`docker-compose.prod.yml`
- 服务：`postgres`、`redis`、`backend`、`worker`、`frontend`
- 数据库：`ctem`

## 常用检查

```bash
cd /opt/ctem-platform
docker compose -f docker-compose.prod.yml --project-directory /opt/ctem-platform ps
BASE_URL='https://ctem.example.com' ./ops/health_check.sh
```

带登录 token 时可检查深度健康：

```bash
TOKEN='Bearer token'
BASE_URL='https://ctem.example.com' ./ops/health_check.sh
```

## 一键验收

每次发布后建议执行生产验收脚本：

```bash
cd /opt/ctem-platform
BASE_URL='https://ctem.example.com' ADMIN_USERNAME='security-admin' ADMIN_PASSWORD='正式管理员密码' ./ops/acceptance_check.sh
```

验收覆盖：

1. 登录与 `/auth/me`。
2. `/api/health` 与 `/api/health/deep`。
3. 敏感配置接口权限。
4. 单位、资产、漏洞、模板、报表、资产质量接口。
5. 无效资产和漏洞输入的错误返回。
6. 资产人工编辑、变更记录和自动回滚。
7. 报表模板创建、编辑、报表生成、下载和清理。
8. Word 模板上传、变量替换和报表渲染。
9. 模板审计日志。

## Word 报表模板

报表模板支持上传 `.docx` 文件。模板内可使用变量占位符：

```text
{{report_title}}
{{report_type}}
{{template_name}}
{{unit_name}}
{{generated_at}}
{{asset_count}}
{{vuln_count}}
{{critical_high}}
{{remediation_count}}
{{unit_count}}
{{sync_task_count}}
{{sync_failed_count}}
{{top_risk_unit}}
```

也支持表格占位符：

```text
{{asset_table}}
{{vuln_table}}
{{tracking_table}}
{{risk_rank_table}}
{{sync_quality_table}}
```

如果 Word 模板中没有表格占位符，系统会按报表类型在文末追加标准商用表格。

## 数据库备份

在远端执行：

```bash
cd /opt/ctem-platform
./ops/backup_db.sh
```

默认输出到：

```text
/opt/ctem-platform/backups/postgres/
```

默认保留最近 10 份，可调整：

```bash
RETENTION=30 ./ops/backup_db.sh
```

备份格式为 PostgreSQL custom dump，可用 `pg_restore` 恢复。

## 数据恢复

恢复会覆盖当前数据库。必须显式确认：

```bash
cd /opt/ctem-platform
CONFIRM_RESTORE=YES ./ops/restore_db.sh /opt/ctem-platform/backups/postgres/ctem-YYYYmmdd-HHMMSS.dump
```

恢复脚本会先自动创建一份恢复前备份，然后停止 `backend/worker/frontend`，重建数据库并恢复，再启动服务。

## 发布

从本机执行：

```bash
cd /path/to/CTEM
REMOTE_HOST='deploy@example.com' REMOTE_DIR='/opt/ctem-platform' ./ops/deploy_prod.sh
```

发布脚本会：

1. 打包当前代码。
2. 上传到远端。
3. 备份远端当前源码到 `releases/predeploy-*.tar.gz`。
4. 执行数据库备份。
5. 构建镜像。
6. 执行 Alembic 迁移。
7. 启动 `backend/worker/frontend`。

## 回滚

在远端执行：

```bash
cd /opt/ctem-platform
./ops/rollback_prod.sh
```

默认回滚最近一份 `releases/predeploy-*.tar.gz`。也可指定文件：

```bash
./ops/rollback_prod.sh /opt/ctem-platform/releases/predeploy-YYYYmmdd-HHMMSS.tar.gz
```

回滚脚本会先做数据库备份，再恢复源码、构建镜像、执行迁移并启动服务。

## 注意事项

- `.env` 不会被发布脚本打包，也不会被远端源码备份覆盖。
- 不要把真实 `.env`、数据库备份、报表文件、SSH 密钥、Token、API Key 提交到 Git。
- 恢复数据库前必须确认备份文件来自同一套系统版本或兼容版本。
- 报表文件保存在 Docker volume `reports`，数据库备份不包含报表文件。
- 审计日志在数据库中，数据库恢复会同步恢复到备份时刻的审计状态。
