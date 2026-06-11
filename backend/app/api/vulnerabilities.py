from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import false, or_, select
from app.database import get_db
from app.services.auth import require_operator, require_reader
from app.models.user import User
from app.models.asset import Asset
from app.models.unit import Unit
from app.models.vulnerability import Vulnerability
from app.schemas.vulnerability import VulnerabilityCreate, VulnerabilityRead, VulnerabilityStatusUpdate
from app.services.audit import write_audit_log

router = APIRouter()

VULN_STATUSES = {"待确认", "待整改", "整改中", "待复测", "已修复", "误报", "接受风险"}
VULN_SEVERITIES = {"严重", "高危", "中危", "低危"}


async def _validate_vuln_payload(db: AsyncSession, body: VulnerabilityCreate) -> None:
    if body.status not in VULN_STATUSES:
        raise HTTPException(status_code=400, detail="不支持的漏洞状态")
    if body.severity not in VULN_SEVERITIES:
        raise HTTPException(status_code=400, detail="不支持的漏洞等级")
    if body.cvss < 0 or body.cvss > 10:
        raise HTTPException(status_code=400, detail="CVSS 必须在 0 到 10 之间")
    asset_ids = list(dict.fromkeys(body.asset_ids or []))
    if asset_ids:
        result = await db.execute(select(Asset.id).where(Asset.id.in_(asset_ids)))
        existing = {row[0] for row in result.all()}
        missing = [asset_id for asset_id in asset_ids if asset_id not in existing]
        if missing:
            raise HTTPException(status_code=404, detail=f"影响资产不存在：{missing[0]}")


@router.get("/", response_model=list[VulnerabilityRead])
async def list_vulns(
    q: str = Query(""),
    severity: str = Query(""),
    status: str = Query(""),
    asset_id: str = Query(""),
    unit_id: str = Query(""),
    ip: str = Query(""),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_reader),
):
    stmt = select(Vulnerability)
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(
            or_(
                Vulnerability.title.ilike(pattern),
                Vulnerability.cve.ilike(pattern),
                Vulnerability.desc.ilike(pattern),
                Vulnerability.solution.ilike(pattern),
                Vulnerability.status_note.ilike(pattern),
            )
        )
    if severity:
        stmt = stmt.where(Vulnerability.severity == severity)
    if status:
        stmt = stmt.where(Vulnerability.status == status)
    if asset_id:
        stmt = stmt.where(Vulnerability.asset_ids.any(asset_id))
    if unit_id or ip:
        asset_stmt = select(Asset.id)
        if unit_id:
            asset_stmt = asset_stmt.where(Asset.unit_id == unit_id)
        if ip:
            asset_stmt = asset_stmt.where(Asset.ip.ilike(f"%{ip}%"))
        asset_ids = [row[0] for row in (await db.execute(asset_stmt)).all()]
        if asset_ids:
            stmt = stmt.where(Vulnerability.asset_ids.op("&&")(asset_ids))
        else:
            stmt = stmt.where(false())
    stmt = stmt.order_by(Vulnerability.cvss.desc(), Vulnerability.created_at.desc())
    result = await db.execute(stmt)
    return [VulnerabilityRead.model_validate(vuln) for vuln in result.scalars().all()]


@router.get("/{vuln_id}", response_model=VulnerabilityRead)
async def get_vuln(vuln_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_reader)):
    result = await db.execute(select(Vulnerability).where(Vulnerability.id == vuln_id))
    vuln = result.scalar_one_or_none()
    if not vuln:
        raise HTTPException(status_code=404, detail="漏洞不存在")
    return VulnerabilityRead.model_validate(vuln)


@router.post("/", response_model=VulnerabilityRead, status_code=201)
async def create_vuln(
    body: VulnerabilityCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operator),
):
    await _validate_vuln_payload(db, body)
    vuln = Vulnerability(**body.model_dump())
    db.add(vuln)
    await db.flush()
    await write_audit_log(
        db,
        action="vulnerability.create",
        target_type="vulnerability",
        target_id=vuln.id,
        target_name=vuln.title,
        detail={"severity": vuln.severity, "status": vuln.status, "asset_count": len(vuln.asset_ids or [])},
        user=current_user,
        request=request,
    )
    await db.commit()
    await db.refresh(vuln)
    return VulnerabilityRead.model_validate(vuln)


@router.put("/{vuln_id}", response_model=VulnerabilityRead)
async def update_vuln(
    vuln_id: str,
    body: VulnerabilityCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operator),
):
    result = await db.execute(select(Vulnerability).where(Vulnerability.id == vuln_id))
    vuln = result.scalar_one_or_none()
    if not vuln:
        raise HTTPException(status_code=404, detail="漏洞不存在")
    await _validate_vuln_payload(db, body)
    before = {"title": vuln.title, "severity": vuln.severity, "status": vuln.status}
    for key, value in body.model_dump().items():
        setattr(vuln, key, value)
    await write_audit_log(
        db,
        action="vulnerability.update",
        target_type="vulnerability",
        target_id=vuln.id,
        target_name=vuln.title,
        detail={"before": before, "after": {"title": vuln.title, "severity": vuln.severity, "status": vuln.status}},
        user=current_user,
        request=request,
    )
    await db.commit()
    await db.refresh(vuln)
    return VulnerabilityRead.model_validate(vuln)


@router.patch("/{vuln_id}/status", response_model=VulnerabilityRead)
async def update_vuln_status(
    vuln_id: str,
    body: VulnerabilityStatusUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operator),
):
    if body.status not in VULN_STATUSES:
        raise HTTPException(status_code=400, detail="不支持的漏洞状态")
    result = await db.execute(select(Vulnerability).where(Vulnerability.id == vuln_id))
    vuln = result.scalar_one_or_none()
    if not vuln:
        raise HTTPException(status_code=404, detail="漏洞不存在")
    before = {"status": vuln.status, "status_note": vuln.status_note}
    vuln.status = body.status
    vuln.status_note = body.status_note
    vuln.status_updated_at = datetime.utcnow()
    await write_audit_log(
        db,
        action="vulnerability.status_update",
        target_type="vulnerability",
        target_id=vuln.id,
        target_name=vuln.title,
        detail={"before": before, "after": {"status": vuln.status, "status_note": vuln.status_note}},
        user=current_user,
        request=request,
    )
    await db.commit()
    await db.refresh(vuln)
    return VulnerabilityRead.model_validate(vuln)


@router.get("/{vuln_id}/assets")
async def get_vuln_assets(vuln_id: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_reader)):
    result = await db.execute(select(Vulnerability).where(Vulnerability.id == vuln_id))
    vuln = result.scalar_one_or_none()
    if not vuln:
        raise HTTPException(status_code=404, detail="漏洞不存在")
    if not vuln.asset_ids:
        return {"vuln_id": vuln_id, "assets": [], "total": 0}

    assets_result = await db.execute(
        select(Asset, Unit)
        .outerjoin(Unit, Unit.id == Asset.unit_id)
        .where(Asset.id.in_(vuln.asset_ids))
    )
    assets = [
        {
            "id": asset.id,
            "name": asset.name,
            "ip": asset.ip,
            "risk": asset.risk,
            "unit_id": asset.unit_id,
            "unit_name": unit.name if unit else "",
            "ports": asset.ports,
            "services": asset.services,
        }
        for asset, unit in assets_result.all()
    ]
    return {"vuln_id": vuln_id, "assets": assets, "total": len(assets)}
