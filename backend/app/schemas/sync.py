from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field

SpaceAuthType = Literal["auto", "rayspace", "bearer", "api_key", "basic", "none"]


class SpaceConfigRead(BaseModel):
    base_url: str
    username: str = ""
    api_key: str = ""
    auth_type: SpaceAuthType = "rayspace"
    asset_path: str = "api/asset/select/query"
    vulnerability_path: str = "api/v1/vulnerabilities"
    verify_tls: bool = False
    mock_mode: bool = False
    sync_enabled: bool = False
    sync_interval_minutes: int = 0
    updated_at: Optional[datetime] = None


class SpaceConfigUpdate(BaseModel):
    base_url: str = Field(..., min_length=1)
    username: str = ""
    password: str = ""
    api_key: str = ""
    auth_type: SpaceAuthType = "rayspace"
    asset_path: str = Field("api/asset/select/query", min_length=1)
    vulnerability_path: str = Field("api/v1/vulnerabilities", min_length=1)
    verify_tls: bool = False
    mock_mode: bool = False
    sync_enabled: bool = False
    sync_interval_minutes: int = Field(0, ge=0, le=10080)


class SpaceQueryRequest(BaseModel):
    unit_id: Optional[str] = None
    advanced_query: str = ""
    startdate: str = ""
    enddate: str = ""
    province: str = ""
    city: str = ""
    county: str = ""
    country: str = ""
    domain: str = ""
    ip: str = ""
    ports: list[str] = []
    protocol: str = ""
    service: str = ""
    status: str = ""
    asn: str = ""
    isp: str = ""
    category: str = ""
    category_main: str = ""
    category_sub: str = ""
    device_type: str = ""
    device_category: str = ""
    os_type: str = ""
    os: str = ""
    support_type: str = ""
    support_category: str = ""
    support_service: str = ""
    middleware: str = ""
    product: str = ""
    title: str = ""
    banner: str = ""
    header: str = ""
    body: str = ""
    server: str = ""
    http_status: str = ""
    cve: str = ""
    cve_name: str = ""
    poc: str = ""
    tag: str = ""
    custom_tag: str = ""
    industry: str = ""
    dept: str = ""
    ip_company_full: str = ""
    keyword: str = ""
