from __future__ import annotations

from datetime import datetime
from typing import Optional
from pydantic import BaseModel

class UnitCreate(BaseModel):
    name: str
    code: str
    desc: str = ""
    ip_ranges: list[str] = []
    aliases: list[str] = []
    keywords: list[str] = []
    contact: str = ""
    email: str = ""
    status: str = "active"
    region: str = ""
    region_name: str = ""

class UnitRead(BaseModel):
    id: str
    name: str
    code: str
    desc: str
    ip_ranges: list[str]
    aliases: list[str]
    keywords: list[str]
    contact: str
    email: str
    status: str
    region: str
    region_name: str
    last_sync: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class UnitStats(BaseModel):
    asset_count: int = 0
    vuln_count: int = 0
    critical_vuln: int = 0
    high_vuln: int = 0
