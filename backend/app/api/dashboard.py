from __future__ import annotations

from collections import defaultdict

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
    asset_rows = list((await db.execute(select(Asset.id, Asset.unit_id))).all())
    asset_unit_by_id = {asset_id: unit_id for asset_id, unit_id in asset_rows if unit_id}
    asset_count_by_unit: dict[str, int] = defaultdict(int)
    for _asset_id, unit_id in asset_rows:
        if unit_id:
            asset_count_by_unit[unit_id] += 1

    vuln_rows = list((await db.execute(select(Vulnerability.severity, Vulnerability.asset_ids))).all())
    severity_weight = {"严重": 10, "高危": 7, "中危": 4, "低危": 1}
    vuln_count_by_unit: dict[str, int] = defaultdict(int)
    critical_count_by_unit: dict[str, int] = defaultdict(int)
    high_count_by_unit: dict[str, int] = defaultdict(int)
    vuln_score_by_unit: dict[str, int] = defaultdict(int)
    for severity, asset_ids in vuln_rows:
        impacted_unit_ids = {
            asset_unit_by_id[asset_id]
            for asset_id in (asset_ids or [])
            if asset_id in asset_unit_by_id
        }
        for unit_id in impacted_unit_ids:
            vuln_count_by_unit[unit_id] += 1
            if severity == "严重":
                critical_count_by_unit[unit_id] += 1
            elif severity == "高危":
                high_count_by_unit[unit_id] += 1
            vuln_score_by_unit[unit_id] += severity_weight.get(severity, 1)

    top_risk_units = []
    for unit in units:
        asset_count = asset_count_by_unit.get(unit.id, 0)
        vuln_count = vuln_count_by_unit.get(unit.id, 0)
        critical_count = critical_count_by_unit.get(unit.id, 0)
        high_count = high_count_by_unit.get(unit.id, 0)
        score = asset_count + vuln_score_by_unit.get(unit.id, 0)
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
            "asset_count": asset_count,
            "vuln_count": vuln_count,
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
