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
