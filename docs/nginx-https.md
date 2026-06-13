# Nginx 与 HTTPS 反向代理

本文档说明 CTEM Platform 在生产环境中通过 Nginx 和 HTTPS 对外提供访问的推荐方式。示例中的域名、证书路径和端口请按实际环境替换。

## 1. 推荐拓扑

推荐只对外暴露 HTTPS 入口，由外部 Nginx 负责 TLS 证书和反向代理。

```text
用户浏览器
  |
  | HTTPS 443
  v
外部 Nginx / 网关
  |
  | HTTP 内网
  v
CTEM frontend:80
  |
  | /api 转发
  v
CTEM backend:8000
```

推荐策略：

- 公网或办公网只开放 `443`。
- 如需兼容 HTTP，`80` 只做跳转到 HTTPS。
- PostgreSQL `5432` 和 Redis `6379` 不对外开放。
- 后端 `8000` 优先只允许内网访问。

## 2. DNS 与证书

准备：

- 域名：`ctem.example.com`
- 证书文件：`/etc/nginx/certs/ctem.example.com.crt`
- 私钥文件：`/etc/nginx/certs/ctem.example.com.key`

证书要求：

- 使用可信 CA 或企业内部 CA。
- 私钥文件权限限制为 root 或 Nginx 用户可读。
- 不要把证书私钥提交到 Git。
- 证书过期前要更新并重载 Nginx。

## 3. Nginx 反代示例

以下示例适用于 Nginx 部署在宿主机，CTEM 前端暴露在本机 `127.0.0.1:80`，后端暴露在本机 `127.0.0.1:8000`。

```nginx
server {
    listen 80;
    server_name ctem.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ctem.example.com;

    ssl_certificate /etc/nginx/certs/ctem.example.com.crt;
    ssl_certificate_key /etc/nginx/certs/ctem.example.com.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    client_max_body_size 50m;

    proxy_connect_timeout 30s;
    proxy_send_timeout 300s;
    proxy_read_timeout 300s;

    location /api/ {
        proxy_pass http://127.0.0.1:8000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }

    location /docs {
        proxy_pass http://127.0.0.1:8000/docs;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }

    location /openapi.json {
        proxy_pass http://127.0.0.1:8000/openapi.json;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }

    location / {
        proxy_pass http://127.0.0.1:80;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

检查配置：

```bash
nginx -t
systemctl reload nginx
```

## 4. Compose 端口收敛

如果外部 Nginx 与 CTEM 在同一台服务器，建议把 Compose 端口绑定到本机回环地址，降低暴露面。

可将 `docker-compose.prod.yml` 中端口调整为：

```yaml
frontend:
  ports:
    - "127.0.0.1:80:80"

backend:
  ports:
    - "127.0.0.1:8000:8000"
```

调整后重启：

```bash
docker compose -f docker-compose.prod.yml up -d frontend backend
```

如果 Nginx 部署在其他机器，需使用内网地址并通过防火墙限制来源。

## 5. 环境变量建议

生产 `.env` 中建议设置允许来源：

```env
CORS_ORIGINS=https://ctem.example.com
```

如同时保留本地访问或测试域名，可用逗号分隔：

```env
CORS_ORIGINS=https://ctem.example.com,http://127.0.0.1
```

修改 `.env` 后重启后端：

```bash
docker compose -f docker-compose.prod.yml up -d backend worker
```

## 6. 上传和下载

系统支持 Word 模板上传和报表下载，反代需注意：

- `client_max_body_size` 不要过小，建议至少 `50m`。
- `proxy_read_timeout` 不要过短，报表生成或大文件下载可能需要更长时间。
- 下载失败时先看 Nginx 错误日志和后端日志。

查看日志：

```bash
journalctl -u nginx -n 200 --no-pager
docker compose -f docker-compose.prod.yml logs --tail=200 backend
```

## 7. 安全加固

建议：

- 关闭或限制 `/docs` 和 `/openapi.json` 的公网访问。
- 对管理后台入口增加 VPN、堡垒机或办公网访问限制。
- 配置访问日志和错误日志轮转。
- 禁止 Nginx 暴露目录索引。
- 禁止将真实证书私钥写入仓库。
- 数据库和 Redis 只允许 Docker 内部网络访问。

限制 API 文档访问示例：

```nginx
location /docs {
    allow 10.0.0.0/8;
    allow 192.168.0.0/16;
    deny all;
    proxy_pass http://127.0.0.1:8000/docs;
}
```

## 8. 验收

HTTPS 配置完成后执行：

```bash
curl -I https://ctem.example.com/
curl -fsS https://ctem.example.com/api/health
BASE_URL='https://ctem.example.com' ./ops/health_check.sh
```

再执行一键验收：

```bash
BASE_URL='https://ctem.example.com' ADMIN_USERNAME='security-admin' ADMIN_PASSWORD='正式管理员密码' ./ops/acceptance_check.sh
```

浏览器人工检查：

- 地址栏显示 HTTPS。
- 登录后刷新页面不丢失路由。
- 资产、漏洞、报表、同步页面接口请求正常。
- Word 模板上传和报表下载正常。
- 大屏展示地图资源加载正常。
