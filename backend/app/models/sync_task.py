import uuid
from datetime import datetime
from sqlalchemy import String, Text, DateTime, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base

class SyncTask(Base):
    __tablename__ = "sync_tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    unit_id: Mapped[str] = mapped_column(String(36), ForeignKey("units.id", ondelete="CASCADE"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    message: Mapped[str] = mapped_column(Text, default="")
    query_condition: Mapped[str] = mapped_column(Text, default="", nullable=False)
    fetched_assets: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    synced_assets: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    synced_vulns: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error_detail: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
