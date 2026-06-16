from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.asset import Asset
from app.models.unit import Unit, UnitStatus
from app.schemas.unit import UnitCreate, UnitRead
from app.services.auth import require_operator, require_reader
from app.services.audit import write_audit_log
from app.services.unit_ip_ranges import clean_list, complete_unit_ip_ranges, merge_unit_ip_ranges
from app.models.user import User

router = APIRouter()


def _unit_values(body: UnitCreate) -> dict:
    values = body.model_dump()
    values["ip_ranges"] = clean_list(values.get("ip_ranges"))
    values["aliases"] = clean_list(values.get("aliases"))
    values["keywords"] = clean_list(values.get("keywords"))
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


@router.post("/ip-ranges/batch-complete")
async def batch_complete_unit_ip_ranges(
    request: Request,
    dry_run: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operator),
):
    units = list((await db.execute(select(Unit).order_by(Unit.created_at.desc()))).scalars().all())
    asset_rows = await db.execute(select(Asset.unit_id, Asset.ip).where(Asset.unit_id.is_not(None)))
    ips_by_unit: dict[str, list[str]] = {}
    for unit_id, ip in asset_rows.all():
        if unit_id:
            ips_by_unit.setdefault(unit_id, []).append(ip)

    rows = [merge_unit_ip_ranges(unit, ips_by_unit.get(unit.id, [])) for unit in units]
    changed_rows = [row for row in rows if row["new_count"] > 0]
    if not dry_run:
        rows = complete_unit_ip_ranges(units, ips_by_unit)
        changed_rows = [row for row in rows if row["new_count"] > 0]
        await write_audit_log(
            db,
            action="unit.ip_ranges.batch_complete",
            target_type="unit",
            target_id="*",
            target_name="批量补全单位IP范围",
            detail={
                "unit_count": len(units),
                "updated_units": len(changed_rows),
                "added_ip_count": sum(row["new_count"] for row in changed_rows),
                "items": [
                    {
                        "unit_id": row["unit_id"],
                        "unit_name": row["unit_name"],
                        "added": row["added_ip_ranges"],
                    }
                    for row in changed_rows[:100]
                ],
            },
            user=current_user,
            request=request,
        )
        await db.commit()

    return {
        "dry_run": dry_run,
        "unit_count": len(units),
        "updated_units": len(changed_rows),
        "added_ip_count": sum(row["new_count"] for row in changed_rows),
        "items": rows,
    }


@router.get("/{unit_id}", response_model=UnitRead)
async def get_unit(unit_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_reader)):
    result = await db.execute(select(Unit).where(Unit.id == unit_id))
    unit = result.scalar_one_or_none()
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")
    return UnitRead.model_validate(unit)


@router.get("/{unit_id}/ip-ranges/suggestions")
async def suggest_unit_ip_ranges(
    unit_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_reader),
):
    unit_result = await db.execute(select(Unit).where(Unit.id == unit_id))
    unit = unit_result.scalar_one_or_none()
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")

    asset_rows = await db.execute(select(Asset.ip).where(Asset.unit_id == unit_id))
    row = merge_unit_ip_ranges(unit, [item[0] for item in asset_rows.all()])
    return {
        "unit_id": unit.id,
        "unit_name": unit.name,
        "asset_count": row["asset_count"],
        "existing_count": row["existing_count"],
        "new_count": row["new_count"],
        "ip_ranges": row["ip_ranges"],
    }


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
    before = {
        "name": unit.name,
        "code": unit.code,
        "status": unit.status.value,
        "ip_ranges": unit.ip_ranges,
        "aliases": unit.aliases,
        "keywords": unit.keywords,
    }
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
            "after": {
                "name": unit.name,
                "code": unit.code,
                "status": unit.status.value,
                "ip_ranges": unit.ip_ranges,
                "aliases": unit.aliases,
                "keywords": unit.keywords,
            },
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
