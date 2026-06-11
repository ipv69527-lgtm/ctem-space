from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
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
    pattern = f"%{keyword}%"

    unit_result = await db.execute(
        select(Unit)
        .where(
            or_(
                Unit.name.ilike(pattern),
                Unit.code.ilike(pattern),
                Unit.desc.ilike(pattern),
                Unit.contact.ilike(pattern),
                Unit.region_name.ilike(pattern),
                func.array_to_string(Unit.ip_ranges, " ").ilike(pattern),
                func.array_to_string(Unit.aliases, " ").ilike(pattern),
                func.array_to_string(Unit.keywords, " ").ilike(pattern),
            )
        )
        .limit(8)
    )
    asset_result = await db.execute(
        select(Asset)
        .where(
            or_(
                Asset.name.ilike(pattern),
                Asset.ip.ilike(pattern),
                Asset.mac.ilike(pattern),
                Asset.type.ilike(pattern),
                Asset.os.ilike(pattern),
                Asset.ports.ilike(pattern),
                Asset.services.ilike(pattern),
                Asset.location.ilike(pattern),
                Asset.isp.ilike(pattern),
            )
        )
        .limit(8)
    )
    vuln_result = await db.execute(
        select(Vulnerability)
        .where(
            or_(
                Vulnerability.title.ilike(pattern),
                Vulnerability.cve.ilike(pattern),
                Vulnerability.desc.ilike(pattern),
                Vulnerability.solution.ilike(pattern),
                Vulnerability.status_note.ilike(pattern),
            )
        )
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
