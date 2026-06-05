# 安装手册

## 环境要求

- Docker 24+
- Docker Compose v2
- Git
- 至少 2 CPU、4 GB 内存、20 GB 磁盘

## 获取代码

```bash
git clone https://github.com/your-org/ctem-platform.git
cd ctem-platform
```

## 配置环境变量

```bash
cp .env.example .env
```

必须修改：

```env
DB_PASSWORD=replace-with-a-strong-database-password
JWT_SECRET=replace-with-a-random-64-char-hex-secret
ADMIN_USERNAME=security-admin
ADMIN_PASSWORD=replace-with-a-strong-admin-password
ADMIN_NAME=Security Administrator
ADMIN_EMAIL=security-admin@example.com
```

可选配置 RaySpace/Space 接入：

```env
SPACE_API_BASE_URL=https://space-api.example.com
SPACE_API_USERNAME=
SPACE_API_PASSWORD=
SPACE_API_KEY=
SPACE_MOCK_MODE=false
```

不要把真实 `.env` 提交到 Git。

## 本地开发启动

```bash
docker compose up -d
docker compose exec backend alembic upgrade head
docker compose exec backend python -m app.cli.init_db
docker compose exec backend python -m app.cli.create_admin
```

访问：

- 前端开发服务：`http://localhost:5173`
- 后端 API：`http://localhost:8000`
- API 文档：`http://localhost:8000/docs`

## 生产部署

在服务器准备 `.env` 后：

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

或从本机发布到远端：

```bash
REMOTE_HOST='deploy@example.com' REMOTE_DIR='/opt/ctem-platform' ./ops/deploy_prod.sh
```

部署后验收：

```bash
BASE_URL='https://ctem.example.com' ADMIN_USERNAME='security-admin' ADMIN_PASSWORD='正式管理员密码' ./ops/acceptance_check.sh
```

## 账号策略

- 系统不启用演示账号和默认密码。
- 初始超级管理员由 `python -m app.cli.create_admin` 创建。
- 密码至少 12 位，必须包含大写字母、小写字母、数字和特殊字符。
- 旧演示凭据 `admin/admin123` 会被拒绝。

## 备份与恢复

备份：

```bash
./ops/backup_db.sh
```

恢复：

```bash
CONFIRM_RESTORE=YES ./ops/restore_db.sh /opt/ctem-platform/backups/postgres/ctem-YYYYmmdd-HHMMSS.dump
```

更多细节见 [运维手册](operations.md)。
