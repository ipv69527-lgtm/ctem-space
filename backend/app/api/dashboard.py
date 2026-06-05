from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.database import get_db
from app.models.unit import Unit
from app.models.asset import Asset
from app.models.vulnerability import Vulnerability
from app.services.auth import require_reader

router = APIRouter()


def _first_raw_number(raw_data, keys: list[str]):
    if not isinstance(raw_data, list):
        return None
    for item in raw_data:
        if not isinstance(item, dict):
            continue
        for key in keys:
            try:
                value = float(item.get(key))
            except (TypeError, ValueError):
                continue
            return value
    return None


@router.get("/stats")
async def get_dashboard_stats(db: AsyncSession = Depends(get_db), _=Depends(require_reader)):
    total_assets = (await db.execute(select(func.count(Asset.id)))).scalar() or 0
    total_units = (await db.execute(select(func.count(Unit.id)))).scalar() or 0
    total_vulns = (await db.execute(select(func.count(Vulnerability.id)))).scalar() or 0
    critical_high = (await db.execute(
        select(func.count(Vulnerability.id)).where(Vulnerability.severity.in_(["严重", "高危"]))
    )).scalar() or 0

    units = list((await db.execute(select(Unit))).scalars().all())
    assets = list((await db.execute(select(Asset))).scalars().all())
    vulns = list((await db.execute(select(Vulnerability))).scalars().all())
    assets_by_unit: dict[str, list[Asset]] = {}
    for asset in assets:
        assets_by_unit.setdefault(asset.unit_id, []).append(asset)

    severity_weight = {"严重": 10, "高危": 7, "中危": 4, "低危": 1}
    top_risk_units = []
    for unit in units:
        unit_assets = assets_by_unit.get(unit.id, [])
        asset_ids = {asset.id for asset in unit_assets}
        unit_vulns = [v for v in vulns if asset_ids.intersection(set(v.asset_ids or []))]
        critical_count = sum(1 for v in unit_vulns if v.severity == "严重")
        high_count = sum(1 for v in unit_vulns if v.severity == "高危")
        score = len(unit_assets) + sum(severity_weight.get(v.severity, 1) for v in unit_vulns)
        top_risk_units.append({
            "id": unit.id,
            "name": unit.name,
            "code": unit.code,
            "desc": unit.desc,
            "ip_ranges": unit.ip_ranges,
            "contact": unit.contact,
            "email": unit.email,
            "status": unit.status.value,
            "region": unit.region,
            "region_name": unit.region_name,
            "last_sync": unit.last_sync,
            "created_at": unit.created_at,
            "updated_at": unit.updated_at,
            "asset_count": len(unit_assets),
            "vuln_count": len(unit_vulns),
            "critical_vuln": critical_count,
            "high_vuln": high_count,
            "score": score,
        })
    top_risk_units.sort(key=lambda item: item["score"], reverse=True)

    return {
        "total_assets": total_assets,
        "total_units": total_units,
        "total_vulns": total_vulns,
        "critical_high": critical_high,
        "pending_critical": critical_high,
        "top_risk_units": top_risk_units[:10],
    }


@router.get("/asset-locations")
async def get_asset_locations(db: AsyncSession = Depends(get_db), _=Depends(require_reader)):
    assets = list((await db.execute(select(Asset))).scalars().all())
    units = {unit.id: unit.name for unit in (await db.execute(select(Unit))).scalars().all()}
    locations = []
    for asset in assets:
        longitude = _first_raw_number(asset.raw_data, ["longitude", "lng"])
        latitude = _first_raw_number(asset.raw_data, ["latitude", "lat"])
        if longitude is None or latitude is None:
            continue
        locations.append({
            "id": asset.id,
            "name": asset.name,
            "ip": asset.ip,
            "risk": asset.risk,
            "unit_id": asset.unit_id,
            "unit_name": units.get(asset.unit_id, ""),
            "ports": asset.ports,
            "services": asset.services,
            "vuln_count": len(asset.vuln_ids or []),
            "longitude": longitude,
            "latitude": latitude,
        })
    return locations
