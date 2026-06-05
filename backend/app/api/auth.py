from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.user import User
from app.schemas.user import UserLogin, UserRead, TokenResponse
from app.services.auth import verify_password, create_token, get_current_user
from app.services.audit import write_audit_log
from app.security.password_policy import is_demo_credential

router = APIRouter()


@router.post("/login", response_model=TokenResponse)
async def login(body: UserLogin, request: Request, db: AsyncSession = Depends(get_db)):
    if is_demo_credential(body.username, body.password):
        await write_audit_log(
            db,
            action="auth.login",
            target_type="user",
            target_name=body.username,
            result="failed",
            detail={"reason": "demo credential blocked"},
            username=body.username,
            request=request,
        )
        await db.commit()
        raise HTTPException(status_code=401, detail="演示账号已关闭，请使用正式账号登录")

    result = await db.execute(select(User).where(User.username == body.username))
    user = result.scalar_one_or_none()
    if not user or not verify_password(body.password, user.hashed_password):
        await write_audit_log(
            db,
            action="auth.login",
            target_type="user",
            target_name=body.username,
            result="failed",
            detail={"reason": "invalid credential"},
            username=body.username,
            request=request,
        )
        await db.commit()
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    if user.status.value == "disabled":
        await write_audit_log(
            db,
            action="auth.login",
            target_type="user",
            target_id=user.id,
            target_name=user.username,
            result="failed",
            detail={"reason": "disabled"},
            user=user,
            request=request,
        )
        await db.commit()
        raise HTTPException(status_code=401, detail="用户已禁用")

    user.last_login = datetime.utcnow()
    await write_audit_log(
        db,
        action="auth.login",
        target_type="user",
        target_id=user.id,
        target_name=user.username,
        user=user,
        request=request,
    )
    await db.commit()
    await db.refresh(user)
    token = create_token(user.id)
    return TokenResponse(
        access_token=token,
        user=UserRead.model_validate(user),
    )


@router.get("/me", response_model=UserRead)
async def me(user: User = Depends(get_current_user)):
    return UserRead.model_validate(user)
