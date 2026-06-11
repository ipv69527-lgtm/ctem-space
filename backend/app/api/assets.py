from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, or_, select
from app.database import get_db
from app.models.asset import Asset
from app.models.asset_change import AssetChange
from app.models.unit import Unit
from app.schemas.asset import AssetChangeRead, AssetCreate, AssetRead, AssetUpdate
from app.services.audit import write_audit_log
from app.services.auth import require_operator, require_reader
from app.models.user import User

router = APIRouter()

ASSET_RISKS = {"严重", "高危", "中危", "低危"}
ASSET_EDIT_FIELDS = ("name", "ip", "mac", "type", "os", "risk", "unit_id", "ports", "services", "location", "isp")


async def _ensure_asset_unit(db: AsyncSession, unit_id: str | None) -> None:
    if not unit_id:
        return
    unit_result = await db.execute(select(Unit).where(Unit.id == unit_id))
    if not unit_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="目标单位不存在")


def _asset_edit_changes(asset: Asset, body: AssetUpdate) -> dict[str, dict[str, str]]:
    values = body.model_dump()
    changes: dict[str, dict[str, str]] = {}
    for field in ASSET_EDIT_FIELDS:
        before = "" if getattr(asset, field, None) is None else str(getattr(asset, field))
        after = "" if values.get(field) is None else str(values.get(field))
        if before != after:
            changes[field] = {"before": before, "after": after}
    return changes


@router.get("/", response_model=list[AssetRead])
async def list_assets(
    q: str = Query(""),
    type: str = Query(""),
    risk: str = Query(""),
    unit_id: str = Query(""),
    port: str = Query(""),
    service: str = Query(""),
    location: str = Query(""),
    isp: str = Query(""),
    has_vulns: str = Query(""),
    db: AsyncSession = Depends(get_db), _: User = Depends(require_reader),
):
    stmt = select(Asset)
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(
            or_(
                Asset.name.ilike(pattern),
                Asset.ip.ilike(pattern),
                Asset.ports.ilike(pattern),
                Asset.services.ilike(pattern),
                Asset.location.ilike(pattern),
                Asset.isp.ilike(pattern),
            )
        )
    if type:
        stmt = stmt.where(Asset.type == type)
    if risk:
        stmt = stmt.where(Asset.risk == risk)
    if unit_id == "__unassigned":
        stmt = stmt.where(Asset.unit_id.is_(None))
    elif unit_id:
        stmt = stmt.where(Asset.unit_id == unit_id)
    if port:
        stmt = stmt.where(Asset.ports.ilike(f"%{port}%"))
    if service:
        stmt = stmt.where(Asset.services.ilike(f"%{service}%"))
    if location:
        stmt = stmt.where(Asset.location.ilike(f"%{location}%"))
    if isp:
        stmt = stmt.where(Asset.isp.ilike(f"%{isp}%"))
    if has_vulns == "yes":
        stmt = stmt.where(Asset.vuln_ids != [])
    elif has_vulns == "no":
        stmt = stmt.where(Asset.vuln_ids == [])
    stmt = stmt.order_by(Asset.last_seen.desc().nullslast())
    result = await db.execute(stmt)
    return [AssetRead.model_validate(a) for a in result.scalars().all()]


@router.get("/quality/summary")
async def asset_quality_summary(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_reader),
):
    total_assets = (await db.execute(select(func.count(Asset.id)))).scalar() or 0
    duplicate_rows = await db.execute(
        select(Asset.unit_id, Asset.ip, func.count(Asset.id).label("count"))
        .group_by(Asset.unit_id, Asset.ip)
        .having(func.count(Asset.id) > 1)
    )
    duplicates = [
        {"unit_id": unit_id, "ip": ip, "count": count}
        for unit_id, ip, count in duplicate_rows.all()
    ]
    no_ports = (await db.execute(select(func.count(Asset.id)).where(Asset.ports == ""))).scalar() or 0
    no_raw_data = (
        await db.execute(select(func.count(Asset.id)).where(func.jsonb_array_length(Asset.raw_data) == 0))
    ).scalar() or 0
    recent_changes = (await db.execute(select(func.count(AssetChange.id)))).scalar() or 0
    return {
        "total_assets": total_assets,
        "duplicate_groups": duplicates,
        "duplicate_group_count": len(duplicates),
        "assets_without_ports": no_ports,
        "assets_without_raw_data": no_raw_data,
        "asset_change_count": recent_changes,
    }


@router.get("/{asset_id}", response_model=AssetRead)
async def get_asset(asset_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_reader)):
    result = await db.execute(select(Asset).where(Asset.id == asset_id))
    asset = result.scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return AssetRead.model_validate(asset)


@router.get("/{asset_id}/changes", response_model=list[AssetChangeRead])
async def list_asset_changes(
    asset_id: str,
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_reader),
):
    result = await db.execute(select(Asset).where(Asset.id == asset_id))
    asset = result.scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    changes = await db.execute(
        select(AssetChange)
        .where(AssetChange.asset_id == asset_id)
        .order_by(AssetChange.created_at.desc())
        .limit(limit)
    )
    return [AssetChangeRead.model_validate(change) for change in changes.scalars().all()]


@router.post("/", response_model=AssetRead, status_code=201)
async def create_asset(
    body: AssetCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operator),
):
    if body.risk not in ASSET_RISKS:
        raise HTTPException(status_code=400, detail="不支持的资产风险等级")
    values = body.model_dump()
    values["unit_id"] = values.get("unit_id") or None
    await _ensure_asset_unit(db, values["unit_id"])
    asset = Asset(**values)
    db.add(asset)
    await db.flush()
    await write_audit_log(
        db,
        action="asset.create",
        target_type="asset",
        target_id=asset.id,
        target_name=asset.ip,
        detail={"unit_id": asset.unit_id, "risk": asset.risk, "ports": asset.ports},
        user=current_user,
        request=request,
    )
    await db.commit()
    await db.refresh(asset)
    return AssetRead.model_validate(asset)


@router.put("/{asset_id}", response_model=AssetRead)
async def update_asset(
    asset_id: str,
    body: AssetUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operator),
):
    if body.risk not in ASSET_RISKS:
        raise HTTPException(status_code=400, detail="不支持的资产风险等级")
    values = body.model_dump()
    values["unit_id"] = values.get("unit_id") or None
    await _ensure_asset_unit(db, values["unit_id"])
    result = await db.execute(select(Asset).where(Asset.id == asset_id))
    asset = result.scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=404, detail="资产不存在")

    changes = _asset_edit_changes(asset, body)
    if (asset.unit_id or "") != (values["unit_id"] or ""):
        changes["unit_id"] = {"before": asset.unit_id or "", "after": values["unit_id"] or ""}
    for field, value in values.items():
        setattr(asset, field, value)
    if changes:
        db.add(
            AssetChange(
                asset_id=asset.id,
                unit_id=asset.unit_id,
                ip=asset.ip,
                source="manual",
                action="manual_update",
                changes=changes,
            )
        )
    await write_audit_log(
        db,
        action="asset.update",
        target_type="asset",
        target_id=asset.id,
        target_name=asset.ip,
        detail={"changes": changes},
        user=current_user,
        request=request,
    )
    await db.commit()
    await db.refresh(asset)
    return AssetRead.model_validate(asset)
