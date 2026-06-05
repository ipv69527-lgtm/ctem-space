from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AssetChange(Base):
    __tablename__ = "asset_changes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    asset_id: Mapped[str] = mapped_column(String(36), ForeignKey("assets.id", ondelete="CASCADE"), nullable=False, index=True)
    unit_id: Mapped[str] = mapped_column(String(36), ForeignKey("units.id", ondelete="CASCADE"), nullable=False, index=True)
    ip: Mapped[str] = mapped_column(String(45), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(64), default="space_sync")
    action: Mapped[str] = mapped_column(String(32), default="update", index=True)
    changes: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
