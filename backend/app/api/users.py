from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.services.audit import write_audit_log
from app.services.auth import hash_password, require_role
from app.models.user import User, UserRole, UserStatus
from app.schemas.user import UserCreate, UserPasswordUpdate, UserRead, UserUpdate

router = APIRouter()


@router.get("/", response_model=list[UserRead])
async def list_users(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("super_admin")),
):
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    return [UserRead.model_validate(user) for user in result.scalars().all()]


@router.post("/", response_model=UserRead, status_code=201)
async def create_user(
    body: UserCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("super_admin")),
):
    exists = await db.execute(select(User).where(User.username == body.username))
    if exists.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="用户名已存在")

    try:
        role = UserRole(body.role)
    except ValueError:
        raise HTTPException(status_code=422, detail="角色无效")

    user = User(
        username=body.username,
        name=body.name,
        hashed_password=hash_password(body.password),
        role=role,
        email=body.email,
    )
    db.add(user)
    await db.flush()
    await write_audit_log(
        db,
        action="user.create",
        target_type="user",
        target_id=user.id,
        target_name=user.username,
        detail={"role": user.role.value, "email": user.email},
        user=current_user,
        request=request,
    )
    await db.commit()
    await db.refresh(user)
    return UserRead.model_validate(user)


@router.put("/{user_id}", response_model=UserRead)
async def update_user(
    user_id: str,
    body: UserUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("super_admin")),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    try:
        role = UserRole(body.role)
    except ValueError:
        raise HTTPException(status_code=422, detail="角色无效")
    if user.id == current_user.id and role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=400, detail="不能降低当前登录账号的管理员角色")

    before = {"name": user.name, "role": user.role.value, "email": user.email}
    user.name = body.name
    user.role = role
    user.email = body.email
    await write_audit_log(
        db,
        action="user.update",
        target_type="user",
        target_id=user.id,
        target_name=user.username,
        detail={"before": before, "after": {"name": user.name, "role": user.role.value, "email": user.email}},
        user=current_user,
        request=request,
    )
    await db.commit()
    await db.refresh(user)
    return UserRead.model_validate(user)


@router.put("/{user_id}/password", response_model=UserRead)
async def update_password(
    user_id: str,
    body: UserPasswordUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("super_admin")),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    user.hashed_password = hash_password(body.password)
    await write_audit_log(
        db,
        action="user.password_update",
        target_type="user",
        target_id=user.id,
        target_name=user.username,
        user=current_user,
        request=request,
    )
    await db.commit()
    await db.refresh(user)
    return UserRead.model_validate(user)


@router.put("/{user_id}/toggle-status")
async def toggle_user(
    user_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("super_admin")),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="不能禁用当前登录用户")

    user.status = UserStatus.DISABLED if user.status == UserStatus.ACTIVE else UserStatus.ACTIVE
    await write_audit_log(
        db,
        action="user.toggle_status",
        target_type="user",
        target_id=user.id,
        target_name=user.username,
        detail={"status": user.status.value},
        user=current_user,
        request=request,
    )
    await db.commit()
    await db.refresh(user)
    return UserRead.model_validate(user)
