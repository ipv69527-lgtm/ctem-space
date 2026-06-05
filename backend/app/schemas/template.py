from __future__ import annotations

from datetime import datetime
from typing import Optional
from pydantic import BaseModel

class TemplateCreate(BaseModel):
    name: str
    desc: str = ""
    content: str = ""
    type: str = "docx"
    vars: list[str] = []

class TemplateUpdate(BaseModel):
    name: Optional[str] = None
    desc: Optional[str] = None
    content: Optional[str] = None
    type: Optional[str] = None
    vars: Optional[list[str]] = None

class TemplateRead(BaseModel):
    id: str
    name: str
    desc: str
    content: str
    type: str
    vars: list[str]
    source: str
    has_file: bool = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
