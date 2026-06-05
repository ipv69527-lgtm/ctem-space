from pathlib import Path
import redis.asyncio as redis
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from app.config import settings, validate_required_settings
from app.database import get_db
from app.models.space_config import SpaceConfig
from app.models.user import User
from app.services.auth import require_reader
from app.api import auth, units, assets, vulnerabilities, reports, templates, users, dashboard, sync, search, audit

app = FastAPI(title=settings.APP_NAME, version="1.0.0")


@app.on_event("startup")
async def validate_runtime_config():
    validate_required_settings()
    Path(settings.REPORT_DIR).mkdir(parents=True, exist_ok=True)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["Dashboard"])
app.include_router(units.router, prefix="/api/units", tags=["Units"])
app.include_router(assets.router, prefix="/api/assets", tags=["Assets"])
app.include_router(vulnerabilities.router, prefix="/api/vulnerabilities", tags=["Vulnerabilities"])
app.include_router(reports.router, prefix="/api/reports", tags=["Reports"])
app.include_router(templates.router, prefix="/api/templates", tags=["Templates"])
app.include_router(users.router, prefix="/api/users", tags=["Users"])
app.include_router(sync.router, prefix="/api/sync", tags=["Sync"])
app.include_router(search.router, prefix="/api/search", tags=["Search"])
app.include_router(audit.router, prefix="/api/audit", tags=["Audit"])


@app.get("/api/health")
async def health():
    return {"status": "ok", "app": settings.APP_NAME}


@app.get("/api/health/deep")
async def deep_health(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_reader),
):
    checks = {
        "database": {"ok": False, "message": ""},
        "redis": {"ok": False, "message": ""},
        "space_config": {"ok": False, "message": ""},
    }
    try:
        await db.execute(text("SELECT 1"))
        checks["database"] = {"ok": True, "message": "PostgreSQL 可用"}
    except Exception as exc:
        checks["database"]["message"] = str(exc)

    redis_client = redis.from_url(settings.REDIS_URL, encoding="utf-8", decode_responses=True)
    try:
        pong = await redis_client.ping()
        checks["redis"] = {"ok": bool(pong), "message": "Redis 可用" if pong else "Redis 未响应"}
    except Exception as exc:
        checks["redis"]["message"] = str(exc)
    finally:
        await redis_client.aclose()

    try:
        result = await db.execute(select(SpaceConfig).where(SpaceConfig.id == "default"))
        config = result.scalar_one_or_none()
        if config and config.base_url:
            checks["space_config"] = {
                "ok": True,
                "message": "Space 配置已保存",
                "base_url": config.base_url,
                "auth_type": config.auth_type,
                "mock_mode": config.mock_mode,
                "verify_tls": config.verify_tls,
            }
        else:
            checks["space_config"]["message"] = "Space 配置不存在"
    except Exception as exc:
        checks["space_config"]["message"] = str(exc)

    ok = all(item["ok"] for item in checks.values())
    return {"status": "ok" if ok else "degraded", "app": settings.APP_NAME, "checks": checks}


dist_dir = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if dist_dir.exists():
    app.mount("/assets", StaticFiles(directory=dist_dir / "assets"), name="assets")


@app.get("/", include_in_schema=False)
async def root():
    index_file = dist_dir / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return {"status": "ok", "app": settings.APP_NAME}


@app.get("/shield.svg", include_in_schema=False)
async def shield_icon():
    icon_file = dist_dir / "shield.svg"
    if icon_file.exists():
        return FileResponse(icon_file)
    raise HTTPException(status_code=404, detail="Icon not found")


@app.get("/{full_path:path}", include_in_schema=False)
async def serve_spa(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="API endpoint not found")
    index_file = dist_dir / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    raise HTTPException(status_code=404, detail="Frontend build not found")
