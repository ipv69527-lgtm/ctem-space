from __future__ import annotations

from typing import Any

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditLog
from app.models.user import User


def _client_ip(request: Request | None) -> str:
    if not request:
        return ""
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",", 1)[0].strip()
    return request.client.host if request.client else ""


async def write_audit_log(
    db: AsyncSession,
    *,
    action: str,
    target_type: str = "",
    target_id: str = "",
    target_name: str = "",
    result: str = "success",
    detail: dict[str, Any] | None = None,
    user: User | None = None,
    username: str = "",
    request: Request | None = None,
) -> None:
    db.add(
        AuditLog(
            user_id=user.id if user else "",
            username=user.username if user else username,
            action=action,
            target_type=target_type,
            target_id=target_id,
            target_name=target_name,
            result=result,
            ip=_client_ip(request),
            user_agent=request.headers.get("user-agent", "") if request else "",
            detail=detail or {},
        )
    )
