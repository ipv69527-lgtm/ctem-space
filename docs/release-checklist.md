# 上线交付清单

本文档用于 CTEM Platform 生产上线、版本升级和项目交付确认。每次发布前后建议逐项勾选并保留执行记录。

## 1. 基础环境

- [ ] 已确认服务器 CPU、内存、磁盘满足生产要求。
- [ ] 已安装 Docker 24+。
- [ ] 已安装 Docker Compose v2。
- [ ] 已配置服务器时间同步。
- [ ] 已确认服务器防火墙只开放必要端口。
- [ ] 已确认生产目录存在，例如 `/opt/ctem-platform`。
- [ ] 已确认部署用户拥有生产目录读写权限。
- [ ] 已确认服务器可访问 RaySpace/Space API。

## 2. 代码版本

- [ ] 已确认本地工作区无未提交业务代码。
- [ ] 已记录当前发布提交哈希。
- [ ] 已确认发布分支为 `main` 或正式发布分支。
- [ ] 已确认 GitHub 远端代码已更新。
- [ ] 已确认 `.env`、数据库备份、报表文件、密钥文件未提交到仓库。

常用命令：

```bash
git status --short --branch
git log --oneline -5
git rev-parse --short HEAD
```

## 3. 环境变量

- [ ] 已创建生产 `.env`。
- [ ] 已设置强数据库密码 `DB_PASSWORD`。
- [ ] 已设置随机 `JWT_SECRET`。
- [ ] 已设置正式管理员账号 `ADMIN_USERNAME`。
- [ ] 已设置符合复杂度要求的 `ADMIN_PASSWORD`。
- [ ] 已设置管理员姓名和邮箱。
- [ ] 已配置 `SPACE_API_BASE_URL`。
- [ ] 已配置 RaySpace/Space 正式认证信息。
- [ ] 已确认 `SPACE_MOCK_MODE=false`。
- [ ] 已确认 `.env` 文件权限合理。

生成 `JWT_SECRET`：

```bash
openssl rand -hex 32
```

## 4. 账号策略

- [ ] 已确认系统不启用演示账号。
- [ ] 已确认旧演示凭据 `admin/admin123` 无法登录。
- [ ] 已确认只保留正式超级管理员。
- [ ] 已通过前端用户管理创建实际运营账号。
- [ ] 已按角色分配超级管理员、运营人员、审计员权限。
- [ ] 已确认离职、测试、临时账号已禁用或删除。

## 5. 数据库与备份

- [ ] 发布前已执行数据库备份。
- [ ] 已确认备份文件生成成功。
- [ ] 已确认备份目录剩余空间充足。
- [ ] 已确认备份保留策略。
- [ ] 已确认恢复脚本可用。
- [ ] 已确认重大升级前有可回滚的数据快照。

备份命令：

```bash
cd /opt/ctem-platform
./ops/backup_db.sh
```

## 6. 发布执行

- [ ] 已确认远端 `.env` 不会被发布包覆盖。
- [ ] 已执行发布脚本。
- [ ] 已确认镜像构建成功。
- [ ] 已确认 Alembic 迁移成功。
- [ ] 已确认 `backend` 容器健康。
- [ ] 已确认 `worker` 容器运行。
- [ ] 已确认 `frontend` 容器运行。
- [ ] 已确认生产访问地址可打开。

发布命令：

```bash
REMOTE_HOST='deploy@example.com' REMOTE_DIR='/opt/ctem-platform' ./ops/deploy_prod.sh
```

检查命令：

```bash
cd /opt/ctem-platform
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=100 backend
```

## 7. 自动验收

- [ ] 已执行基础健康检查。
- [ ] 已执行一键生产验收脚本。
- [ ] 已确认验收输出全部为 `[OK]`。
- [ ] 已确认验收脚本生成的临时数据已清理。

基础健康检查：

```bash
BASE_URL='https://ctem.example.com' ./ops/health_check.sh
```

一键验收：

```bash
BASE_URL='https://ctem.example.com' ADMIN_USERNAME='security-admin' ADMIN_PASSWORD='正式管理员密码' ./ops/acceptance_check.sh
```

## 8. 人工验收

- [ ] 登录页面可正常访问。
- [ ] 正式管理员可登录。
- [ ] 用户管理可创建、禁用、修改密码。
- [ ] 单位管理可创建、编辑、删除单位。
- [ ] 资产管理可筛选、查看详情、人工编辑。
- [ ] 资产列配置可显示端口、单位名称、经纬度、厂商等字段。
- [ ] 数据质量页能统计未归属、缺经纬度、缺端口、缺厂商等问题。
- [ ] RaySpace/Space 配置可测试连接。
- [ ] 条件同步可按城市、端口、服务类型、时间条件拉取。
- [ ] 同步任务中心能展示状态、耗时、入库数和失败详情。
- [ ] 漏洞管理可区分 `CVE版本匹配` 和 `POC已验证命中`。
- [ ] POC 漏洞显示验证时间、验证证据和漏洞描述。
- [ ] 报表模板可创建、编辑、上传 Word 模板。
- [ ] 报表可生成、下载、删除。
- [ ] 大屏展示地图和区域聚合显示正常。
- [ ] 审计日志记录登录、资产、漏洞、模板、报表和同步操作。

## 9. RaySpace/Space 数据接入

- [ ] 已确认 Space API 地址、账号、密码或 API Key 正确。
- [ ] 已确认 token 失效后可重新获取。
- [ ] 已确认查询接口带认证参数。
- [ ] 已确认同步条件模板可保存常用查询。
- [ ] 已确认同步失败会记录错误详情。
- [ ] 已确认同步数据不会覆盖人工修正字段的关键业务含义。
- [ ] 已确认未归属资产可进入资产管理人工归属。

## 10. 安全检查

- [ ] 未在仓库中保存真实 `.env`。
- [ ] 未在仓库中保存数据库备份。
- [ ] 未在仓库中保存 SSH 私钥。
- [ ] 未在仓库中保存 RaySpace/Space 密码、Token、API Key。
- [ ] PostgreSQL 未暴露到公网。
- [ ] Redis 未暴露到公网。
- [ ] 后端 API 如需暴露公网，已通过 HTTPS 和访问控制保护。
- [ ] 生产管理员密码不与服务器密码、数据库密码复用。
- [ ] 已确认报告下载、模板上传没有越权访问。

## 11. 回滚准备

- [ ] 已确认 `/opt/ctem-platform/releases/` 中存在发布前源码备份。
- [ ] 已确认 `/opt/ctem-platform/backups/postgres/` 中存在发布前数据库备份。
- [ ] 已确认回滚脚本可执行。
- [ ] 已确认本次升级是否包含数据库结构变更。
- [ ] 若包含破坏性迁移，已准备数据库恢复方案。

回滚命令：

```bash
cd /opt/ctem-platform
./ops/rollback_prod.sh
```

指定版本回滚：

```bash
./ops/rollback_prod.sh /opt/ctem-platform/releases/predeploy-YYYYmmdd-HHMMSS.tar.gz
```

## 12. 交付记录

交付时建议记录：

| 项目 | 内容 |
| --- | --- |
| 项目名称 | CTEM Platform |
| 部署环境 | 生产 / 测试 / 演示 |
| 访问地址 |  |
| 发布分支 |  |
| 提交哈希 |  |
| 部署时间 |  |
| 部署人员 |  |
| 验收人员 |  |
| 验收结论 | 通过 / 不通过 |
| 回滚包路径 |  |
| 数据库备份路径 |  |
| 备注 |  |

## 13. 交付结论

上线完成需要同时满足：

- 自动验收通过。
- 人工核心流程验收通过。
- 备份和回滚方案确认可用。
- 正式账号策略生效。
- RaySpace/Space 接入可用。
- 文档、账号、访问地址和版本信息已交付。
