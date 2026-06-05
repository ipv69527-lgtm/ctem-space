from __future__ import annotations

from datetime import datetime
from typing import Optional
from pydantic import BaseModel

class ReportCreate(BaseModel):
    title: str
    type: str = "单位报表"
    format: str = "docx"
    unit_id: Optional[str] = None
    severity_filter: list[str] = []
    status_filter: list[str] = []
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    template_id: Optional[str] = None

class ReportRead(BaseModel):
    id: str
    title: str
    type: str
    format: str
    unit_id: Optional[str] = None
    unit_name: Optional[str] = None
    template_id: Optional[str] = None
    template_name: Optional[str] = None
    status: str
    file_path: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True
