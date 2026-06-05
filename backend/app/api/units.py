from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.unit import Unit, UnitStatus
from app.schemas.unit import UnitCreate, UnitRead
from app.services.auth import require_operator, require_reader
from app.services.audit import write_audit_log
from app.models.user import User

router = APIRouter()


def _unit_values(body: UnitCreate) -> dict:
    values = body.model_dump()
    try:
        values["status"] = UnitStatus(values.get("status") or "active")
    except ValueError:
        raise HTTPException(status_code=400, detail="不支持的单位状态")
    return values


async def _ensure_unique_code(db: AsyncSession, code: str, exclude_id: str = "") -> None:
    result = await db.execute(select(Unit).where(Unit.code == code))
    existing = result.scalar_one_or_none()
    if existing and existing.id != exclude_id:
        raise HTTPException(status_code=409, detail="单位编码已存在")


@router.get("/", response_model=list[UnitRead])
async def list_units(
    q: str = Query(""),
    status: str = Query(""),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_reader),
):
    stmt = select(Unit)
    if q:
        stmt = stmt.where(Unit.name.ilike(f"%{q}%") | Unit.code.ilike(f"%{q}%"))
    if status:
        stmt = stmt.where(Unit.status == status)
    stmt = stmt.order_by(Unit.created_at.desc())
    result = await db.execute(stmt)
    return [UnitRead.model_validate(u) for u in result.scalars().all()]


@router.get("/{unit_id}", response_model=UnitRead)
async def get_unit(unit_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_reader)):
    result = await db.execute(select(Unit).where(Unit.id == unit_id))
    unit = result.scalar_one_or_none()
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")
    return UnitRead.model_validate(unit)


@router.post("/", response_model=UnitRead, status_code=201)
async def create_unit(
    body: UnitCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operator),
):
    values = _unit_values(body)
    await _ensure_unique_code(db, values["code"])
    unit = Unit(**values)
    db.add(unit)
    await db.flush()
    await write_audit_log(
        db,
        action="unit.create",
        target_type="unit",
        target_id=unit.id,
        target_name=unit.name,
        detail={"code": unit.code, "status": unit.status.value, "ip_ranges": unit.ip_ranges},
        user=current_user,
        request=request,
    )
    await db.commit()
    await db.refresh(unit)
    return UnitRead.model_validate(unit)


@router.put("/{unit_id}", response_model=UnitRead)
async def update_unit(
    unit_id: str,
    body: UnitCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operator),
):
    result = await db.execute(select(Unit).where(Unit.id == unit_id))
    unit = result.scalar_one_or_none()
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")
    values = _unit_values(body)
    await _ensure_unique_code(db, values["code"], exclude_id=unit_id)
    before = {"name": unit.name, "code": unit.code, "status": unit.status.value, "ip_ranges": unit.ip_ranges}
    for k, v in values.items():
        setattr(unit, k, v)
    await write_audit_log(
        db,
        action="unit.update",
        target_type="unit",
        target_id=unit.id,
        target_name=unit.name,
        detail={
            "before": before,
            "after": {"name": unit.name, "code": unit.code, "status": unit.status.value, "ip_ranges": unit.ip_ranges},
        },
        user=current_user,
        request=request,
    )
    await db.commit()
    await db.refresh(unit)
    return UnitRead.model_validate(unit)


@router.delete("/{unit_id}")
async def delete_unit(
    unit_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operator),
):
    result = await db.execute(select(Unit).where(Unit.id == unit_id))
    unit = result.scalar_one_or_none()
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")
    await write_audit_log(
        db,
        action="unit.delete",
        target_type="unit",
        target_id=unit.id,
        target_name=unit.name,
        detail={"code": unit.code},
        user=current_user,
        request=request,
    )
    await db.delete(unit)
    await db.commit()
    return {"ok": True}
