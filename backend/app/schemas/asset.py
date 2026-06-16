from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel

class AssetCreate(BaseModel):
    name: str
    ip: str
    mac: str = ""
    type: str = "服务器"
    os: str = ""
    risk: str = "中危"
    unit_id: Optional[str] = None
    ports: str = ""
    services: str = ""
    location: str = ""
    isp: str = ""
    raw_data: list[dict[str, Any]] = []

class AssetUpdate(BaseModel):
    name: str
    ip: str
    mac: str = ""
    type: str = "服务器"
    os: str = ""
    risk: str = "中危"
    unit_id: Optional[str] = None
    ports: str = ""
    services: str = ""
    location: str = ""
    isp: str = ""


class AssetBatchUnitUpdate(BaseModel):
    asset_ids: list[str]
    unit_id: Optional[str] = None

class AssetRead(BaseModel):
    id: str
    name: str
    ip: str
    mac: str
    type: str
    os: str
    risk: str
    unit_id: Optional[str] = None
    vuln_ids: list[str]
    ports: str
    services: str
    location: str
    isp: str
    country: str = ""
    province: str = ""
    city: str = ""
    county: str = ""
    longitude: Optional[float] = None
    latitude: Optional[float] = None
    manufacturer: str = ""
    brand: str = ""
    model: str = ""
    product: str = ""
    device: str = ""
    device_type: str = ""
    raw_data: list[dict[str, Any]]
    last_seen: Optional[datetime] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class AssetChangeRead(BaseModel):
    id: str
    asset_id: str
    unit_id: Optional[str] = None
    ip: str
    source: str
    action: str
    changes: dict[str, Any]
    created_at: datetime

    class Config:
        from_attributes = True
