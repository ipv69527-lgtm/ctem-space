from datetime import datetime, timedelta
import base64
import hashlib
import hmac
import os
from jose import JWTError, jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.config import settings, validate_required_settings
from app.database import get_db
from app.models.user import User

PASSWORD_HASH_ALGORITHM = "pbkdf2_sha256"
PASSWORD_HASH_ITERATIONS = 310_000
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        algorithm, iterations, salt, digest = hashed.split("$", 3)
        if algorithm != PASSWORD_HASH_ALGORITHM:
            return False
        derived = hashlib.pbkdf2_hmac(
            "sha256",
            plain.encode("utf-8"),
            base64.b64decode(salt),
            int(iterations),
        )
        expected = base64.b64decode(digest)
        return hmac.compare_digest(derived, expected)
    except (ValueError, TypeError):
        return False


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    derived = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PASSWORD_HASH_ITERATIONS,
    )
    return "$".join(
        [
            PASSWORD_HASH_ALGORITHM,
            str(PASSWORD_HASH_ITERATIONS),
            base64.b64encode(salt).decode("ascii"),
            base64.b64encode(derived).decode("ascii"),
        ]
    )


def create_token(user_id: str) -> str:
    validate_required_settings()
    expire = datetime.utcnow() + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    return jwt.encode({"sub": user_id, "exp": expire}, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or user.status.value == "disabled":
        raise HTTPException(status_code=401, detail="User not found or disabled")
    return user


def require_role(*roles: str):
    async def checker(user: User = Depends(get_current_user)):
        if user.role.value not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return checker


require_admin = require_role("super_admin")
require_operator = require_role("super_admin", "operator")
require_reader = require_role("super_admin", "operator", "auditor")
