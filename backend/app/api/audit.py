from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.audit_log import AuditLog
from app.models.user import User
from app.schemas.audit import AuditLogRead
from app.services.auth import require_admin

router = APIRouter()


@router.get("/", response_model=list[AuditLogRead])
async def list_audit_logs(
    q: str = Query(""),
    action: str = Query(""),
    target_type: str = Query(""),
    result: str = Query(""),
    username: str = Query(""),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    stmt = select(AuditLog)
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(
            or_(
                AuditLog.username.ilike(pattern),
                AuditLog.action.ilike(pattern),
                AuditLog.target_type.ilike(pattern),
                AuditLog.target_name.ilike(pattern),
                AuditLog.target_id.ilike(pattern),
            )
        )
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if target_type:
        stmt = stmt.where(AuditLog.target_type == target_type)
    if result:
        stmt = stmt.where(AuditLog.result == result)
    if username:
        stmt = stmt.where(AuditLog.username.ilike(f"%{username}%"))
    stmt = stmt.order_by(AuditLog.created_at.desc()).limit(limit)
    result_set = await db.execute(stmt)
    return [AuditLogRead.model_validate(log) for log in result_set.scalars().all()]
