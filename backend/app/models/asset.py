from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Text, DateTime, ARRAY, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base

class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(256), nullable=False, index=True)
    ip: Mapped[str] = mapped_column(String(45), nullable=False, index=True)
    mac: Mapped[str] = mapped_column(String(32), default="")
    type: Mapped[str] = mapped_column(String(64), default="服务器")
    os: Mapped[str] = mapped_column(String(256), default="")
    risk: Mapped[str] = mapped_column(String(16), default="中危")
    unit_id: Mapped[str] = mapped_column(String(36), ForeignKey("units.id", ondelete="CASCADE"), nullable=False, index=True)
    vuln_ids: Mapped[list] = mapped_column(ARRAY(String), default=[])
    ports: Mapped[str] = mapped_column(String(512), default="")
    services: Mapped[str] = mapped_column(Text, default="")
    location: Mapped[str] = mapped_column(String(256), default="")
    isp: Mapped[str] = mapped_column(String(64), default="")
    raw_data: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    last_seen: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
