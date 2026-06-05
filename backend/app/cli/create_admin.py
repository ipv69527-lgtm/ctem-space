import asyncio
import os
from sqlalchemy import select
from app.database import AsyncSessionLocal
from app.models.user import User, UserRole, UserStatus
from app.security.password_policy import validate_password_strength
from app.services.auth import hash_password


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


async def create_admin() -> None:
    username = _required_env("ADMIN_USERNAME")
    password = _required_env("ADMIN_PASSWORD")
    name = os.getenv("ADMIN_NAME", username).strip() or username
    email = os.getenv("ADMIN_EMAIL", "").strip()
    validate_password_strength(password)

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.username == username))
        existing = result.scalar_one_or_none()
        if existing:
            existing.name = name
            existing.email = email
            existing.role = UserRole.SUPER_ADMIN
            existing.status = UserStatus.ACTIVE
            existing.hashed_password = hash_password(password)
            await db.commit()
            print(f"Super admin updated: {username}")
            return

        user = User(
            username=username,
            name=name,
            email=email,
            role=UserRole.SUPER_ADMIN,
            status=UserStatus.ACTIVE,
            hashed_password=hash_password(password),
        )
        db.add(user)
        await db.commit()
        print(f"Super admin created: {username}")


if __name__ == "__main__":
    asyncio.run(create_admin())
