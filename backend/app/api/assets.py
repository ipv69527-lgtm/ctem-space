from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, or_, select
from app.database import get_db
from app.models.asset import Asset
from app.models.asset_change import AssetChange
from app.models.unit import Unit
from app.schemas.asset import AssetBatchUnitUpdate, AssetChangeRead, AssetCreate, AssetRead, AssetUpdate
from app.services.audit import write_audit_log
from app.services.auth import require_operator, require_reader
from app.models.user import User

router = APIRouter()

ASSET_RISKS = {"严重", "高危", "中危", "低危"}
ASSET_EDIT_FIELDS = ("name", "ip", "mac", "type", "os", "risk", "unit_id", "ports", "services", "location", "isp")
MANUFACTURER_KEYS = ("manufacturer", "manufacturer_short", "brand", "model")


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


def _raw_items(asset: Asset) -> list[dict]:
    return [item for item in (asset.raw_data or []) if isinstance(item, dict)]


def _raw_value(asset: Asset, keys: tuple[str, ...]) -> str:
    for item in _raw_items(asset):
        for key in keys:
            value = item.get(key)
            if value not in (None, ""):
                return str(value)
            app_info = item.get("application_info")
            if isinstance(app_info, list):
                for app in app_info:
                    if isinstance(app, dict) and app.get(key) not in (None, ""):
                        return str(app[key])
    return ""


def _quality_sample(asset: Asset, issue: str) -> dict[str, str | None]:
    return {"id": asset.id, "ip": asset.ip, "name": asset.name, "unit_id": asset.unit_id, "issue": issue}


def _asset_matches_quality_issue(asset: Asset, issue: str) -> bool:
    if issue == "missing_unit":
        return not asset.unit_id
    if issue == "missing_ports":
        return not asset.ports
    if issue == "missing_location":
        return not asset.location
    if issue == "missing_coordinates":
        return not (_raw_value(asset, ("longitude", "lng")) and _raw_value(asset, ("latitude", "lat")))
    if issue == "missing_manufacturer":
        return not _raw_value(asset, MANUFACTURER_KEYS)
    if issue == "missing_raw":
        return not _raw_items(asset)
    return True


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
    quality_issue: str = Query(""),
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
    if quality_issue == "missing_unit":
        stmt = stmt.where(Asset.unit_id.is_(None))
    elif quality_issue == "missing_ports":
        stmt = stmt.where(Asset.ports == "")
    elif quality_issue == "missing_location":
        stmt = stmt.where(Asset.location == "")
    elif quality_issue == "missing_raw":
        stmt = stmt.where(func.jsonb_array_length(Asset.raw_data) == 0)
    elif quality_issue and quality_issue not in {"missing_coordinates", "missing_manufacturer"}:
        raise HTTPException(status_code=400, detail="不支持的数据质量筛选项")
    stmt = stmt.order_by(Asset.last_seen.desc().nullslast())
    result = await db.execute(stmt)
    assets = list(result.scalars().all())
    if quality_issue in {"missing_coordinates", "missing_manufacturer"}:
        assets = [asset for asset in assets if _asset_matches_quality_issue(asset, quality_issue)]
    return [AssetRead.model_validate(a) for a in assets]


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


@router.get("/quality/report")
async def asset_quality_report(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_reader),
):
    assets = list((await db.execute(select(Asset).order_by(Asset.updated_at.desc()))).scalars().all())
    total = len(assets)
    assigned = sum(1 for asset in assets if asset.unit_id)
    missing_ports = []
    missing_location = []
    missing_coordinates = []
    missing_manufacturer = []
    missing_raw = []
    raw_org_empty = 0
    raw_org_domain_like = 0
    raw_org_non_empty = 0
    for asset in assets:
        raw_items = _raw_items(asset)
        if not asset.ports:
            missing_ports.append(asset)
        if not asset.location:
            missing_location.append(asset)
        if not (_raw_value(asset, ("longitude", "lng")) and _raw_value(asset, ("latitude", "lat"))):
            missing_coordinates.append(asset)
        if not _raw_value(asset, MANUFACTURER_KEYS):
            missing_manufacturer.append(asset)
        if not raw_items:
            missing_raw.append(asset)
        org_values = [str(item.get("org") or "").strip() for item in raw_items]
        if any(org_values):
            raw_org_non_empty += 1
        else:
            raw_org_empty += 1
        if any("*" in value or "." in value for value in org_values if value):
            raw_org_domain_like += 1

    duplicate_rows = await db.execute(
        select(Asset.unit_id, Asset.ip, func.count(Asset.id).label("count"))
        .group_by(Asset.unit_id, Asset.ip)
        .having(func.count(Asset.id) > 1)
    )
    duplicate_groups = [
        {"unit_id": unit_id, "ip": ip, "count": count}
        for unit_id, ip, count in duplicate_rows.all()
    ]
    issue_specs = [
        ("missing_unit", [asset for asset in assets if not asset.unit_id], "未归属"),
        ("missing_ports", missing_ports, "缺端口"),
        ("missing_location", missing_location, "缺位置"),
        ("missing_coordinates", missing_coordinates, "缺经纬度"),
        ("missing_manufacturer", missing_manufacturer, "缺厂商/品牌/型号"),
        ("missing_raw", missing_raw, "缺原始数据"),
    ]
    action_labels = {
        "missing_unit": "去批量归属",
        "missing_ports": "去补端口",
        "missing_location": "去补位置",
        "missing_coordinates": "去补经纬度",
        "missing_manufacturer": "去补厂商",
        "missing_raw": "查看缺原始数据资产",
    }
    return {
        "total_assets": total,
        "assigned_assets": assigned,
        "unassigned_assets": total - assigned,
        "assigned_rate": round(assigned / total * 100, 2) if total else 0,
        "duplicate_group_count": len(duplicate_groups),
        "duplicate_groups": duplicate_groups[:50],
        "raw_org_non_empty": raw_org_non_empty,
        "raw_org_empty": raw_org_empty,
        "raw_org_domain_like": raw_org_domain_like,
        "issues": [
            {
                "key": key,
                "label": label,
                "count": len(items),
                "rate": round(len(items) / total * 100, 2) if total else 0,
                "samples": [_quality_sample(asset, label) for asset in items[:10]],
                "action_label": action_labels.get(key, "去修正"),
                "action_path": "/assets",
                "action_params": {"quality_issue": key},
            }
            for key, items, label in issue_specs
        ],
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


@router.post("/batch/unit")
async def batch_update_asset_unit(
    body: AssetBatchUnitUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operator),
):
    asset_ids = list(dict.fromkeys([item.strip() for item in body.asset_ids if item and item.strip()]))
    if not asset_ids:
        raise HTTPException(status_code=400, detail="请选择需要归属的资产")
    await _ensure_asset_unit(db, body.unit_id)
    result = await db.execute(select(Asset).where(Asset.id.in_(asset_ids)))
    assets = list(result.scalars().all())
    found_ids = {asset.id for asset in assets}
    missing = [asset_id for asset_id in asset_ids if asset_id not in found_ids]
    if missing:
        raise HTTPException(status_code=404, detail=f"资产不存在：{', '.join(missing[:5])}")
    changed = 0
    for asset in assets:
        before_unit = asset.unit_id or ""
        after_unit = body.unit_id or ""
        if before_unit == after_unit:
            continue
        asset.unit_id = body.unit_id
        db.add(
            AssetChange(
                asset_id=asset.id,
                unit_id=asset.unit_id,
                ip=asset.ip,
                source="manual",
                action="batch_unit_update",
                changes={"unit_id": {"before": before_unit, "after": after_unit}},
            )
        )
        changed += 1
    await write_audit_log(
        db,
        action="asset.batch_unit_update",
        target_type="asset",
        target_id=",".join(asset_ids[:20]),
        target_name=f"{len(asset_ids)} 个资产",
        detail={"asset_count": len(asset_ids), "changed": changed, "unit_id": body.unit_id},
        user=current_user,
        request=request,
    )
    await db.commit()
    return {"ok": True, "asset_count": len(asset_ids), "changed": changed, "unit_id": body.unit_id}


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
