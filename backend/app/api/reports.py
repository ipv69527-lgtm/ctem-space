from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.report import Report
from app.models.template import Template
from app.models.unit import Unit
from app.models.user import User
from app.schemas.report import ReportCreate, ReportRead
from app.services.audit import write_audit_log
from app.services.auth import require_operator, require_reader
from app.services.reporting import generate_report_file

router = APIRouter()

REPORT_FORMATS = {"docx", "xlsx", "html"}
REPORT_MEDIA_TYPES = {
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "html": "text/html; charset=utf-8",
}


async def _report_reads(db: AsyncSession, reports: list[Report]) -> list[ReportRead]:
    unit_ids = {report.unit_id for report in reports if report.unit_id}
    template_ids = {report.template_id for report in reports if report.template_id}
    units_by_id: dict[str, str] = {}
    templates_by_id: dict[str, str] = {}
    if unit_ids:
        result = await db.execute(select(Unit).where(Unit.id.in_(unit_ids)))
        units_by_id = {unit.id: unit.name for unit in result.scalars().all()}
    if template_ids:
        result = await db.execute(select(Template).where(Template.id.in_(template_ids)))
        templates_by_id = {template.id: template.name for template in result.scalars().all()}
    return [
        ReportRead(
            id=report.id,
            title=report.title,
            type=report.type,
            format=report.format,
            unit_id=report.unit_id,
            unit_name=units_by_id.get(report.unit_id or ""),
            template_id=report.template_id,
            template_name=templates_by_id.get(report.template_id or ""),
            status=report.status,
            file_path=report.file_path,
            created_at=report.created_at,
        )
        for report in reports
    ]


@router.get("/", response_model=list[ReportRead])
async def list_reports(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_reader),
):
    result = await db.execute(select(Report).order_by(Report.created_at.desc()))
    return await _report_reads(db, list(result.scalars().all()))


@router.post("/", response_model=ReportRead, status_code=201)
async def create_report(
    body: ReportCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operator),
):
    if body.format not in REPORT_FORMATS:
        raise HTTPException(status_code=400, detail="不支持的报表格式")
    if body.unit_id:
        unit_result = await db.execute(select(Unit).where(Unit.id == body.unit_id))
        if not unit_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="目标单位不存在")
    template = None
    if body.template_id:
        template_result = await db.execute(select(Template).where(Template.id == body.template_id))
        template = template_result.scalar_one_or_none()
        if not template:
            raise HTTPException(status_code=404, detail="目标模板不存在")

    report = Report(
        title=body.title,
        type=body.type,
        format=body.format,
        unit_id=body.unit_id,
        template_id=body.template_id,
        status="processing",
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)

    try:
        report.file_path = await generate_report_file(
            db,
            report,
            template=template,
            severity_filter=body.severity_filter,
            status_filter=body.status_filter,
        )
        report.status = "completed"
        await write_audit_log(
            db,
            action="report.create",
            target_type="report",
            target_id=report.id,
            target_name=report.title,
            detail={
                "format": report.format,
                "type": report.type,
                "template_id": report.template_id,
                "unit_id": report.unit_id,
                "severity_filter": body.severity_filter,
                "status_filter": body.status_filter,
            },
            user=current_user,
            request=request,
        )
    except Exception as exc:
        report.status = "failed"
        await write_audit_log(
            db,
            action="report.create",
            target_type="report",
            target_id=report.id,
            target_name=report.title,
            result="failed",
            detail={"error": str(exc), "format": report.format, "unit_id": report.unit_id},
            user=current_user,
            request=request,
        )
        await db.commit()
        raise HTTPException(status_code=500, detail=f"报表生成失败：{exc}")

    await db.commit()
    await db.refresh(report)
    return (await _report_reads(db, [report]))[0]


@router.get("/{report_id}/download")
async def download_report(
    report_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_reader),
):
    result = await db.execute(select(Report).where(Report.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="报表不存在")
    if report.status != "completed" or not report.file_path:
        raise HTTPException(status_code=400, detail="报表尚未生成完成")

    path = Path(report.file_path)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="报表文件不存在")
    await write_audit_log(
        db,
        action="report.download",
        target_type="report",
        target_id=report.id,
        target_name=report.title,
        detail={"format": report.format},
        user=current_user,
        request=request,
    )
    await db.commit()
    return FileResponse(
        path,
        filename=f"{report.title}.{report.format}",
        media_type=REPORT_MEDIA_TYPES.get(report.format, "application/octet-stream"),
    )


@router.delete("/{report_id}")
async def delete_report(
    report_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operator),
):
    result = await db.execute(select(Report).where(Report.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="报表不存在")
    if report.file_path:
        path = Path(report.file_path)
        if path.exists() and path.is_file():
            path.unlink()
    await write_audit_log(
        db,
        action="report.delete",
        target_type="report",
        target_id=report.id,
        target_name=report.title,
        detail={"format": report.format, "status": report.status},
        user=current_user,
        request=request,
    )
    await db.delete(report)
    await db.commit()
    return {"ok": True}
