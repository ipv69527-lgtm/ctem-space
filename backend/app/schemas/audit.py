from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel


class AuditLogRead(BaseModel):
    id: str
    user_id: str
    username: str
    action: str
    target_type: str
    target_id: str
    target_name: str
    result: str
    ip: str
    user_agent: str
    detail: dict[str, Any]
    created_at: datetime

    class Config:
        from_attributes = True
