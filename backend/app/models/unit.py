from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Text, DateTime, Enum as SAEnum, ARRAY
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
import enum

class UnitStatus(str, enum.Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"

class Unit(Base):
    __tablename__ = "units"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(256), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    desc: Mapped[str] = mapped_column(Text, default="")
    ip_ranges: Mapped[list] = mapped_column(ARRAY(String), default=[])
    aliases: Mapped[list] = mapped_column(ARRAY(String), default=[])
    keywords: Mapped[list] = mapped_column(ARRAY(String), default=[])
    contact: Mapped[str] = mapped_column(String(128), default="")
    email: Mapped[str] = mapped_column(String(256), default="")
    status: Mapped[UnitStatus] = mapped_column(SAEnum(UnitStatus), default=UnitStatus.ACTIVE, nullable=False)
    region: Mapped[str] = mapped_column(String(32), default="")
    region_name: Mapped[str] = mapped_column(String(128), default="")
    last_sync: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
