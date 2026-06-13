# CTEM Platform

CTEM Platform 是持续威胁暴露管理平台，面向资产接入、单位管理、漏洞处置、态势展示、商用报表和生产运维验收。

## 文档

- [部署手册](docs/installation.md)
- [功能介绍](docs/features.md)
- [运维手册](docs/operations.md)
- [上线交付清单](docs/release-checklist.md)
- [Nginx 与 HTTPS 反向代理](docs/nginx-https.md)

## 核心功能

- RaySpace/Space 数据接入与同步任务管理。
- 单位管理、资产管理、资产画像和人工字段修正。
- 漏洞管理、影响资产关联和处置状态跟踪。
- 全局态势、大屏展示和区域地图。
- Word/Excel/HTML 报表生成。
- 文本模板和 `.docx` Word 模板上传渲染。
- 用户、角色权限和审计日志。
- 备份、恢复、回滚和一键验收脚本。

## 技术栈

- Backend: Python FastAPI + SQLAlchemy + Celery + Redis
- Frontend: React 18 + TypeScript + Vite + Ant Design + ECharts
- Database: PostgreSQL 16
- Deployment: Docker Compose

## 快速开始

```bash
cp .env.example .env
# 修改 .env，设置 DB_PASSWORD、JWT_SECRET、ADMIN_USERNAME、ADMIN_PASSWORD
docker compose up -d
docker compose exec backend alembic upgrade head
docker compose exec backend python -m app.cli.init_db
docker compose exec backend python -m app.cli.create_admin
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs

## 账号策略

- No demo account or default password is enabled.
- The initial super admin must be bootstrapped with `python -m app.cli.create_admin`.
- User passwords must be at least 12 characters and include uppercase, lowercase, number, and special character.
- The legacy `admin/admin123` credential is rejected even if it exists in an old database.

## 生产注意事项

- Database schema is managed by Alembic. Run `alembic upgrade head` before starting production traffic.
- `python -m app.cli.init_db` creates missing tables for single-node recovery and seeds the default Space config.
- Report files are written under `REPORT_DIR`; mount this path to persistent storage in production.
- Space sync is task based. With Redis/Celery running, sync jobs are handled by the worker; otherwise the API falls back to local background execution.
- Do not commit `.env`, database dumps, report files, SSH keys, tokens, API keys, or production credentials.
