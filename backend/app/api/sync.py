from __future__ import annotations

from datetime import datetime, timedelta
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, or_, select

from app.config import settings
from app.database import get_db
from app.models.space_config import SpaceConfig
from app.models.sync_query_template import SyncQueryTemplate
from app.models.sync_task import SyncTask
from app.models.unit import Unit
from app.models.user import User
from app.schemas.sync import SpaceConfigRead, SpaceConfigUpdate, SpaceQueryRequest, SyncQueryTemplateCreate, SyncQueryTemplateRead, SyncQueryTemplateUpdate
from app.services.audit import write_audit_log
from app.services.auth import require_admin, require_operator, require_reader
from app.services.space_sync import (
    ASSET_PATH_FALLBACKS,
    VULNERABILITY_PATH_FALLBACKS,
    create_due_sync_tasks,
    fetch_space_payload,
    fetch_rayspace_assets,
    build_rayspace_query,
    run_space_sync,
    space_candidate_paths,
    space_request_options,
    unit_sync_params,
)

router = APIRouter()


async def _get_or_create_config(db: AsyncSession) -> SpaceConfig:
    result = await db.execute(select(SpaceConfig).where(SpaceConfig.id == "default"))
    config = result.scalar_one_or_none()
    if config:
        return config
    config = SpaceConfig(
        id="default",
        base_url=settings.SPACE_API_BASE_URL,
        username=settings.SPACE_API_USERNAME,
        password=settings.SPACE_API_PASSWORD,
        api_key=settings.SPACE_API_KEY,
        auth_type=settings.SPACE_AUTH_TYPE,
        asset_path=settings.SPACE_ASSET_PATH,
        vulnerability_path=settings.SPACE_VULNERABILITY_PATH,
        verify_tls=settings.SPACE_VERIFY_TLS,
        mock_mode=settings.SPACE_MOCK_MODE,
        sync_enabled=False,
        sync_interval_minutes=0,
    )
    db.add(config)
    await db.commit()
    await db.refresh(config)
    return config


def _enqueue_sync_task(task_id: str, background_tasks: BackgroundTasks) -> str:
    try:
        from app.tasks.worker import sync_space_data

        sync_space_data.delay(task_id)
        return "同步任务已提交到后台队列"
    except Exception:
        background_tasks.add_task(run_space_sync, task_id)
        return "同步任务已提交到本地后台执行"


async def _unit_from_optional_id(db: AsyncSession, unit_id: str | None) -> Unit | None:
    unit_id = (unit_id or "").strip()
    if not unit_id:
        return None
    result = await db.execute(select(Unit).where(Unit.id == unit_id))
    unit = result.scalar_one_or_none()
    if not unit:
        raise HTTPException(status_code=404, detail="目标单位不存在")
    return unit


def _query_payload(body: SpaceQueryRequest, unit: Unit | None) -> str:
    query = build_rayspace_query(
        unit=unit,
        advanced_query=body.advanced_query,
        startdate=body.startdate,
        enddate=body.enddate,
        province=body.province,
        city=body.city,
        county=body.county,
        country=body.country,
        domain=body.domain,
        ip=body.ip,
        ports=body.ports,
        protocol=body.protocol,
        service=body.service,
        status=body.status,
        asn=body.asn,
        isp=body.isp,
        category=body.category,
        category_main=body.category_main,
        category_sub=body.category_sub,
        device_type=body.device_type,
        device_category=body.device_category,
        os_type=body.os_type,
        os=body.os,
        support_type=body.support_type,
        support_category=body.support_category,
        support_service=body.support_service,
        middleware=body.middleware,
        product=body.product,
        title=body.title,
        banner=body.banner,
        header=body.header,
        body=body.body,
        server=body.server,
        http_status=body.http_status,
        cve=body.cve,
        cve_name=body.cve_name,
        poc=body.poc,
        tag=body.tag,
        custom_tag=body.custom_tag,
        industry=body.industry,
        dept=body.dept,
        ip_company_full=body.ip_company_full,
        keyword=body.keyword,
    )
    if not query:
        raise HTTPException(status_code=400, detail="请至少填写一个查询条件")
    return query


def _clean_query_payload(body: SpaceQueryRequest) -> dict:
    payload = body.model_dump()
    return {key: value for key, value in payload.items() if value not in (None, "", [])}


@router.get("/query-templates", response_model=list[SyncQueryTemplateRead])
async def list_query_templates(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_reader),
):
    result = await db.execute(select(SyncQueryTemplate).order_by(SyncQueryTemplate.updated_at.desc().nullslast(), SyncQueryTemplate.created_at.desc()))
    return [SyncQueryTemplateRead.model_validate(item) for item in result.scalars().all()]


@router.post("/query-templates", response_model=SyncQueryTemplateRead, status_code=201)
async def create_query_template(
    body: SyncQueryTemplateCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operator),
):
    query_body = SpaceQueryRequest.model_validate(body.query_payload or {})
    unit = await _unit_from_optional_id(db, query_body.unit_id)
    query_condition = _query_payload(query_body, unit)
    template = SyncQueryTemplate(
        name=body.name.strip(),
        desc=body.desc.strip(),
        query_payload=_clean_query_payload(query_body),
        query_condition=query_condition,
        created_by=current_user.username,
    )
    db.add(template)
    await db.flush()
    await write_audit_log(
        db,
        action="sync.query_template.create",
        target_type="sync_query_template",
        target_id=template.id,
        target_name=template.name,
        detail={"query_condition": query_condition},
        user=current_user,
        request=request,
    )
    await db.commit()
    await db.refresh(template)
    return SyncQueryTemplateRead.model_validate(template)


@router.put("/query-templates/{template_id}", response_model=SyncQueryTemplateRead)
async def update_query_template(
    template_id: str,
    body: SyncQueryTemplateUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operator),
):
    result = await db.execute(select(SyncQueryTemplate).where(SyncQueryTemplate.id == template_id))
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="同步条件模板不存在")
    query_body = SpaceQueryRequest.model_validate(body.query_payload or {})
    unit = await _unit_from_optional_id(db, query_body.unit_id)
    query_condition = _query_payload(query_body, unit)
    before = {"name": template.name, "query_condition": template.query_condition}
    template.name = body.name.strip()
    template.desc = body.desc.strip()
    template.query_payload = _clean_query_payload(query_body)
    template.query_condition = query_condition
    await write_audit_log(
        db,
        action="sync.query_template.update",
        target_type="sync_query_template",
        target_id=template.id,
        target_name=template.name,
        detail={"before": before, "after": {"name": template.name, "query_condition": query_condition}},
        user=current_user,
        request=request,
    )
    await db.commit()
    await db.refresh(template)
    return SyncQueryTemplateRead.model_validate(template)


@router.delete("/query-templates/{template_id}")
async def delete_query_template(
    template_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operator),
):
    result = await db.execute(select(SyncQueryTemplate).where(SyncQueryTemplate.id == template_id))
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="同步条件模板不存在")
    await db.delete(template)
    await write_audit_log(
        db,
        action="sync.query_template.delete",
        target_type="sync_query_template",
        target_id=template.id,
        target_name=template.name,
        detail={"query_condition": template.query_condition},
        user=current_user,
        request=request,
    )
    await db.commit()
    return {"ok": True}


@router.get("/config", response_model=SpaceConfigRead)
async def get_config(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    config = await _get_or_create_config(db)
    return SpaceConfigRead(
        base_url=config.base_url,
        username=config.username,
        api_key=config.api_key,
        auth_type=config.auth_type,
        asset_path=config.asset_path,
        vulnerability_path=config.vulnerability_path,
        verify_tls=config.verify_tls,
        mock_mode=config.mock_mode,
        sync_enabled=config.sync_enabled,
        sync_interval_minutes=config.sync_interval_minutes,
        updated_at=config.updated_at,
    )


@router.post("/config", response_model=SpaceConfigRead)
async def save_config(
    body: SpaceConfigUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    config = await _get_or_create_config(db)
    config.base_url = body.base_url.rstrip("/")
    config.username = body.username
    if body.password:
        config.password = body.password
    config.api_key = body.api_key
    config.auth_type = body.auth_type
    config.asset_path = body.asset_path.strip().strip("/")
    config.vulnerability_path = body.vulnerability_path.strip().strip("/")
    if body.sync_enabled and body.sync_interval_minutes <= 0:
        raise HTTPException(status_code=400, detail="开启自动同步时必须选择同步周期")
    config.verify_tls = body.verify_tls
    config.mock_mode = body.mock_mode
    config.sync_enabled = body.sync_enabled
    config.sync_interval_minutes = body.sync_interval_minutes if body.sync_enabled else 0
    await write_audit_log(
        db,
        action="space_config.update",
        target_type="space_config",
        target_id=config.id,
        target_name=config.base_url,
        detail={
            "base_url": config.base_url,
            "username": config.username,
            "auth_type": config.auth_type,
            "asset_path": config.asset_path,
            "vulnerability_path": config.vulnerability_path,
            "verify_tls": config.verify_tls,
            "mock_mode": config.mock_mode,
            "sync_enabled": config.sync_enabled,
            "sync_interval_minutes": config.sync_interval_minutes,
            "password_changed": bool(body.password),
        },
        user=current_user,
        request=request,
    )
    await db.commit()
    await db.refresh(config)
    return SpaceConfigRead(
        base_url=config.base_url,
        username=config.username,
        api_key=config.api_key,
        auth_type=config.auth_type,
        asset_path=config.asset_path,
        vulnerability_path=config.vulnerability_path,
        verify_tls=config.verify_tls,
        mock_mode=config.mock_mode,
        sync_enabled=config.sync_enabled,
        sync_interval_minutes=config.sync_interval_minutes,
        updated_at=config.updated_at,
    )


async def _latest_task_for_unit(db: AsyncSession, unit_id: str) -> SyncTask | None:
    result = await db.execute(
        select(SyncTask)
        .where(SyncTask.unit_id == unit_id)
        .order_by(SyncTask.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _active_task_for_unit(db: AsyncSession, unit_id: str) -> SyncTask | None:
    result = await db.execute(
        select(SyncTask)
        .where(SyncTask.unit_id == unit_id, SyncTask.status.in_(["pending", "running"]))
        .order_by(SyncTask.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


def _task_duration_seconds(task: SyncTask) -> int:
    if not task.created_at or not task.updated_at:
        return 0
    return max(0, int((task.updated_at - task.created_at).total_seconds()))


def _task_payload(task: SyncTask, unit_names: dict[str, str] | None = None) -> dict:
    unit_names = unit_names or {}
    return {
        "id": task.id,
        "unit_id": task.unit_id,
        "unit_name": unit_names.get(task.unit_id or "", "") if task.unit_id else "未指定单位",
        "status": task.status,
        "message": task.message,
        "query_condition": task.query_condition,
        "fetched_assets": task.fetched_assets,
        "synced_assets": task.synced_assets,
        "synced_vulns": task.synced_vulns,
        "error_detail": task.error_detail,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
        "duration_seconds": _task_duration_seconds(task),
    }


@router.get("/schedule")
async def get_sync_schedule(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_reader),
):
    config = await _get_or_create_config(db)
    now = datetime.utcnow()
    interval = timedelta(minutes=config.sync_interval_minutes) if config.sync_interval_minutes > 0 else None
    units_result = await db.execute(select(Unit).order_by(Unit.created_at.desc()))
    items = []
    for unit in units_result.scalars().all():
        latest_task = await _latest_task_for_unit(db, unit.id)
        active_task = latest_task if latest_task and latest_task.status in {"pending", "running"} else await _active_task_for_unit(db, unit.id)
        next_sync = unit.last_sync + interval if interval and unit.last_sync else None
        due = bool(config.sync_enabled and interval and (unit.last_sync is None or now >= next_sync) and not active_task)
        items.append({
            "unit_id": unit.id,
            "unit_name": unit.name,
            "unit_status": unit.status.value,
            "last_sync": unit.last_sync,
            "next_sync": next_sync,
            "due": due,
            "active_task_id": active_task.id if active_task else "",
            "active_task_status": active_task.status if active_task else "",
            "last_task_status": latest_task.status if latest_task else "",
            "last_task_message": latest_task.message if latest_task else "",
            "last_task_updated_at": latest_task.updated_at if latest_task else None,
        })
    return {
        "sync_enabled": config.sync_enabled,
        "sync_interval_minutes": config.sync_interval_minutes,
        "now": now,
        "units": items,
    }


@router.get("/task-summary")
async def sync_task_summary(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_reader),
):
    total = (await db.execute(select(func.count(SyncTask.id)))).scalar() or 0
    status_rows = await db.execute(select(SyncTask.status, func.count(SyncTask.id)).group_by(SyncTask.status))
    status_counts = {status: count for status, count in status_rows.all()}
    failed_result = await db.execute(
        select(SyncTask).where(SyncTask.status == "failed").order_by(SyncTask.updated_at.desc()).limit(5)
    )
    success_count = status_counts.get("success", 0)
    finished_count = success_count + status_counts.get("failed", 0)
    return {
        "total": total,
        "pending": status_counts.get("pending", 0),
        "running": status_counts.get("running", 0),
        "success": success_count,
        "failed": status_counts.get("failed", 0),
        "success_rate": round(success_count / finished_count * 100, 2) if finished_count else 0,
        "recent_failed": [_task_payload(task) for task in failed_result.scalars().all()],
    }


@router.post("/schedule/run-due")
async def run_due_schedule(
    background_tasks: BackgroundTasks,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operator),
):
    task_ids = await create_due_sync_tasks()
    for task_id in task_ids:
        _enqueue_sync_task(task_id, background_tasks)
    await write_audit_log(
        db,
        action="sync.schedule_run_due",
        target_type="sync_schedule",
        target_id="default",
        target_name="定时同步策略",
        detail={"created": len(task_ids), "task_ids": task_ids},
        user=current_user,
        request=request,
    )
    await db.commit()
    return {"ok": True, "created": len(task_ids), "task_ids": task_ids}


@router.post("/test-connection")
async def test_connection(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operator),
):
    config = await _get_or_create_config(db)
    if config.mock_mode:
        await write_audit_log(
            db,
            action="sync.test_connection",
            target_type="space_config",
            target_id=config.id,
            target_name=config.base_url,
            detail={"ok": True, "mode": "mock"},
            user=current_user,
            request=request,
        )
        await db.commit()
        return {"ok": True, "message": "Mock 模式在线，真实 Space 接口未调用"}
    if not config.base_url:
        return {"ok": False, "message": "请先配置 Space API 地址"}
    if config.auth_type == "rayspace" and not (config.username and config.password):
        return {"ok": False, "message": "请配置 RaySpace 用户名和密码"}
    if config.auth_type not in {"none", "rayspace"} and not config.api_key and not (config.username and config.password):
        return {"ok": False, "message": "请配置 API Key 或 Basic Auth 用户名密码"}
    headers, auth = space_request_options(config)
    unit_result = await db.execute(select(Unit).order_by(Unit.created_at.desc()))
    unit = unit_result.scalars().first()
    if config.auth_type == "rayspace":
        if not unit:
            return {"ok": False, "message": "RaySpace 登录配置已保存，请先创建单位后再按单位范围测试数据查询"}
        try:
            assets = await fetch_rayspace_assets(config, unit=unit)
            await write_audit_log(
                db,
                action="sync.test_connection",
                target_type="space_config",
                target_id=config.id,
                target_name=config.base_url,
                detail={"ok": True, "fetched_assets": len(assets)},
                user=current_user,
                request=request,
            )
            await db.commit()
            return {"ok": True, "message": f"RaySpace 连接成功，按单位范围预检资产 {len(assets)} 条"}
        except Exception as exc:
            await write_audit_log(
                db,
                action="sync.test_connection",
                target_type="space_config",
                target_id=config.id,
                target_name=config.base_url,
                result="failed",
                detail={"error": str(exc)},
                user=current_user,
                request=request,
            )
            await db.commit()
            return {"ok": False, "message": f"RaySpace 连接失败：{exc}"}
    params = unit_sync_params(unit) if unit else {}
    base_url = config.base_url.rstrip("/") + "/"
    asset_paths = space_candidate_paths(config.asset_path, ASSET_PATH_FALLBACKS)
    vulnerability_paths = space_candidate_paths(config.vulnerability_path, VULNERABILITY_PATH_FALLBACKS)
    try:
        async with httpx.AsyncClient(timeout=10, verify=config.verify_tls, headers=headers, auth=auth) as client:
            _, asset_path, asset_status = await fetch_space_payload(client, base_url, asset_paths, params, "资产")
            vuln_message = ""
            try:
                _, vuln_path, vuln_status = await fetch_space_payload(
                    client,
                    base_url,
                    vulnerability_paths,
                    params,
                    "漏洞",
                )
                vuln_message = f"，漏洞接口 {vuln_path} HTTP {vuln_status}"
            except RuntimeError as exc:
                vuln_message = f"，漏洞接口暂不可用：{exc}"
        await write_audit_log(
            db,
            action="sync.test_connection",
            target_type="space_config",
            target_id=config.id,
            target_name=config.base_url,
            detail={"ok": True, "asset_path": asset_path, "asset_status": asset_status},
            user=current_user,
            request=request,
        )
        await db.commit()
        return {"ok": True, "message": f"Space 资产接口 {asset_path} HTTP {asset_status}{vuln_message}"}
    except Exception as exc:
        await write_audit_log(
            db,
            action="sync.test_connection",
            target_type="space_config",
            target_id=config.id,
            target_name=config.base_url,
            result="failed",
            detail={"error": str(exc)},
            user=current_user,
            request=request,
        )
        await db.commit()
        return {"ok": False, "message": f"Space 连接失败：{exc}"}


@router.post("/trigger/{unit_id}")
async def trigger_sync(
    unit_id: str,
    background_tasks: BackgroundTasks,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operator),
):
    result = await db.execute(select(Unit).where(Unit.id == unit_id))
    unit = result.scalar_one_or_none()
    if not unit:
        raise HTTPException(status_code=404, detail="单位不存在")
    active_task = await _active_task_for_unit(db, unit_id)
    if active_task:
        raise HTTPException(status_code=409, detail=f"该单位已有同步任务正在执行：{active_task.id}")

    task = SyncTask(unit_id=unit_id, status="pending", message="等待执行")
    db.add(task)
    await db.flush()
    await write_audit_log(
        db,
        action="sync.trigger",
        target_type="unit",
        target_id=unit.id,
        target_name=unit.name,
        detail={"task_id": task.id},
        user=current_user,
        request=request,
    )
    await db.commit()
    await db.refresh(task)

    message = _enqueue_sync_task(task.id, background_tasks)

    return {
        "ok": True,
        "task_id": task.id,
        "unit_id": unit_id,
        "status": task.status,
        "message": message,
    }


@router.post("/query-preview")
async def preview_query(
    body: SpaceQueryRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_operator),
):
    unit = await _unit_from_optional_id(db, body.unit_id)
    query = _query_payload(body, unit)
    return {"query_condition": query}


@router.post("/query-trigger")
async def trigger_query_sync(
    body: SpaceQueryRequest,
    background_tasks: BackgroundTasks,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operator),
):
    config = await _get_or_create_config(db)
    if (config.auth_type or "").lower() != "rayspace":
        raise HTTPException(status_code=400, detail="条件拉取目前仅支持 RaySpace 查询语法")
    unit = await _unit_from_optional_id(db, body.unit_id)
    query = _query_payload(body, unit)
    task = SyncTask(unit_id=unit.id if unit else None, status="pending", message="条件拉取等待执行", query_condition=query)
    db.add(task)
    await db.flush()
    await write_audit_log(
        db,
        action="sync.query_trigger",
        target_type="sync_query",
        target_id=task.id,
        target_name=unit.name if unit else "未指定单位条件拉取",
        detail={"task_id": task.id, "unit_id": task.unit_id, "query_condition": query},
        user=current_user,
        request=request,
    )
    await db.commit()
    await db.refresh(task)
    message = _enqueue_sync_task(task.id, background_tasks)
    return {"ok": True, "task_id": task.id, "unit_id": task.unit_id, "status": task.status, "query_condition": query, "message": message}


@router.post("/retry/{task_id}")
async def retry_sync(
    task_id: str,
    background_tasks: BackgroundTasks,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operator),
):
    result = await db.execute(select(SyncTask).where(SyncTask.id == task_id))
    source_task = result.scalar_one_or_none()
    if not source_task:
        raise HTTPException(status_code=404, detail="同步任务不存在")

    unit = await _unit_from_optional_id(db, source_task.unit_id)

    task = SyncTask(
        unit_id=source_task.unit_id,
        status="pending",
        message=f"由任务 {source_task.id} 重试",
        query_condition=source_task.query_condition,
    )
    db.add(task)
    await db.flush()
    await write_audit_log(
        db,
        action="sync.retry",
        target_type="sync_task",
        target_id=source_task.id,
        target_name=unit.name if unit else "条件拉取任务",
        detail={"new_task_id": task.id, "unit_id": task.unit_id},
        user=current_user,
        request=request,
    )
    await db.commit()
    await db.refresh(task)

    message = _enqueue_sync_task(task.id, background_tasks)
    return {
        "ok": True,
        "task_id": task.id,
        "unit_id": task.unit_id,
        "status": task.status,
        "message": message,
    }


@router.get("/tasks")
async def list_all_tasks(
    unit_id: str = Query(""),
    status: str = Query(""),
    q: str = Query(""),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_reader),
):
    stmt = select(SyncTask)
    if unit_id == "__unassigned":
        stmt = stmt.where(SyncTask.unit_id.is_(None))
    elif unit_id:
        stmt = stmt.where(SyncTask.unit_id == unit_id)
    if status:
        stmt = stmt.where(SyncTask.status == status)
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(
            or_(
                SyncTask.id.ilike(pattern),
                SyncTask.message.ilike(pattern),
                SyncTask.query_condition.ilike(pattern),
                SyncTask.error_detail.ilike(pattern),
            )
        )
    stmt = stmt.order_by(SyncTask.created_at.desc()).limit(limit)
    result = await db.execute(stmt)
    tasks = list(result.scalars().all())
    unit_ids = sorted({task.unit_id for task in tasks if task.unit_id})
    unit_names: dict[str, str] = {}
    if unit_ids:
        unit_result = await db.execute(select(Unit.id, Unit.name).where(Unit.id.in_(unit_ids)))
        unit_names = {unit_id: name for unit_id, name in unit_result.all()}
    return [_task_payload(task, unit_names) for task in tasks]


@router.get("/tasks/{unit_id}")
async def list_tasks(
    unit_id: str,
    status: str = Query(""),
    q: str = Query(""),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_reader),
):
    stmt = select(SyncTask).where(SyncTask.unit_id == unit_id)
    if status:
        stmt = stmt.where(SyncTask.status == status)
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(
            SyncTask.message.ilike(pattern)
            | SyncTask.query_condition.ilike(pattern)
            | SyncTask.error_detail.ilike(pattern)
        )
    stmt = stmt.order_by(SyncTask.created_at.desc()).limit(limit)
    result = await db.execute(stmt)
    return [_task_payload(task) for task in result.scalars().all()]
