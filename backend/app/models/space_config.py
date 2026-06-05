from __future__ import annotations

from datetime import datetime
from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class SpaceConfig(Base):
    __tablename__ = "space_configs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default="default")
    base_url: Mapped[str] = mapped_column(String(512), nullable=False)
    username: Mapped[str] = mapped_column(String(128), default="")
    password: Mapped[str] = mapped_column(String(512), default="")
    api_key: Mapped[str] = mapped_column(String(512), default="")
    auth_type: Mapped[str] = mapped_column(String(32), default="rayspace", nullable=False)
    asset_path: Mapped[str] = mapped_column(String(256), default="api/asset/select/query", nullable=False)
    vulnerability_path: Mapped[str] = mapped_column(String(256), default="api/v1/vulnerabilities", nullable=False)
    verify_tls: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    mock_mode: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sync_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sync_interval_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
