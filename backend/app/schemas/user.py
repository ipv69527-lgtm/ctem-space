from __future__ import annotations

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, field_validator
from app.security.password_policy import validate_password_strength

class UserLogin(BaseModel):
    username: str
    password: str

class UserCreate(BaseModel):
    username: str
    name: str
    password: str
    role: str = "operator"
    email: str = ""

    @field_validator("password")
    @classmethod
    def password_must_be_strong(cls, value: str) -> str:
        return validate_password_strength(value)

class UserUpdate(BaseModel):
    name: str
    role: str = "operator"
    email: str = ""

class UserPasswordUpdate(BaseModel):
    password: str

    @field_validator("password")
    @classmethod
    def password_must_be_strong(cls, value: str) -> str:
        return validate_password_strength(value)

class UserRead(BaseModel):
    id: str
    username: str
    name: str
    role: str
    email: str
    status: str
    last_login: Optional[datetime] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserRead
