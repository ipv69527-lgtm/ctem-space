from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.asset import Asset
from app.models.unit import Unit
from app.models.user import User
from app.models.vulnerability import Vulnerability
from app.services.auth import require_reader

router = APIRouter()


@router.get("/")
async def global_search(
    q: str = Query(""),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_reader),
):
    keyword = q.strip()
    if not keyword:
        return {"units": [], "assets": [], "vulns": [], "total": 0}

    unit_result = await db.execute(
        select(Unit)
        .where(Unit.name.ilike(f"%{keyword}%") | Unit.code.ilike(f"%{keyword}%"))
        .limit(8)
    )
    asset_result = await db.execute(
        select(Asset)
        .where(Asset.name.ilike(f"%{keyword}%") | Asset.ip.ilike(f"%{keyword}%"))
        .limit(8)
    )
    vuln_result = await db.execute(
        select(Vulnerability)
        .where(Vulnerability.title.ilike(f"%{keyword}%") | Vulnerability.cve.ilike(f"%{keyword}%"))
        .limit(8)
    )

    units = [
        {"id": unit.id, "name": unit.name, "code": unit.code, "type": "unit"}
        for unit in unit_result.scalars().all()
    ]
    assets = [
        {
            "id": asset.id,
            "name": asset.name,
            "ip": asset.ip,
            "risk": asset.risk,
            "unit_id": asset.unit_id,
            "type": "asset",
        }
        for asset in asset_result.scalars().all()
    ]
    vulns = [
        {
            "id": vuln.id,
            "title": vuln.title,
            "cve": vuln.cve,
            "severity": vuln.severity,
            "type": "vuln",
        }
        for vuln in vuln_result.scalars().all()
    ]
    return {"units": units, "assets": assets, "vulns": vulns, "total": len(units) + len(assets) + len(vulns)}
