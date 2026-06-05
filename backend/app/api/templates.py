from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.config import settings
from app.database import get_db
from app.services.auth import require_operator, require_reader
from app.services.audit import write_audit_log
from app.models.user import User
from app.models.template import Template
from app.schemas.template import TemplateCreate, TemplateRead, TemplateUpdate

router = APIRouter()

TEMPLATE_TYPES = {"docx", "xlsx", "html"}
MAX_TEMPLATE_FILE_BYTES = 10 * 1024 * 1024


def _validate_template_type(value: str | None) -> None:
    if value is not None and value not in TEMPLATE_TYPES:
        raise HTTPException(status_code=400, detail="不支持的模板类型")


def _template_dir() -> Path:
    path = Path(settings.STORAGE_DIR) / "templates"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _delete_template_file(template: Template) -> None:
    if not template.file_path:
        return
    path = Path(template.file_path)
    if path.exists() and path.is_file():
        path.unlink()


@router.get("/", response_model=list[TemplateRead])
async def list_templates(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_reader),
):
    result = await db.execute(select(Template).order_by(Template.created_at.desc()))
    return [TemplateRead.model_validate(template) for template in result.scalars().all()]


@router.post("/", response_model=TemplateRead, status_code=201)
async def create_template(
    body: TemplateCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operator),
):
    _validate_template_type(body.type)
    exists = await db.execute(select(Template).where(Template.name == body.name))
    if exists.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="模板名称已存在")
    template = Template(**body.model_dump(), source="user")
    db.add(template)
    await db.flush()
    await write_audit_log(
        db,
        action="template.create",
        target_type="template",
        target_id=template.id,
        target_name=template.name,
        detail={"type": template.type, "source": template.source},
        user=current_user,
        request=request,
    )
    await db.commit()
    await db.refresh(template)
    return TemplateRead.model_validate(template)


@router.patch("/{template_id}", response_model=TemplateRead)
async def update_template(
    template_id: str,
    body: TemplateUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operator),
):
    result = await db.execute(select(Template).where(Template.id == template_id))
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="模板不存在")
    patch = body.model_dump(exclude_unset=True)
    _validate_template_type(patch.get("type"))
    if "name" in patch and patch["name"] != template.name:
        exists = await db.execute(select(Template).where(Template.name == patch["name"]))
        if exists.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="模板名称已存在")
    before = {"name": template.name, "desc": template.desc, "type": template.type, "vars": template.vars}
    for key, value in patch.items():
        setattr(template, key, value)
    await write_audit_log(
        db,
        action="template.update",
        target_type="template",
        target_id=template.id,
        target_name=template.name,
        detail={
            "before": before,
            "after": {"name": template.name, "desc": template.desc, "type": template.type, "vars": template.vars},
            "content_changed": "content" in patch,
        },
        user=current_user,
        request=request,
    )
    await db.commit()
    await db.refresh(template)
    return TemplateRead.model_validate(template)


@router.post("/{template_id}/file", response_model=TemplateRead)
async def upload_template_file(
    template_id: str,
    request: Request,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operator),
):
    result = await db.execute(select(Template).where(Template.id == template_id))
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="模板不存在")
    filename = file.filename or ""
    if not filename.lower().endswith(".docx"):
        raise HTTPException(status_code=400, detail="仅支持上传 .docx Word 模板")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="模板文件不能为空")
    if len(content) > MAX_TEMPLATE_FILE_BYTES:
        raise HTTPException(status_code=400, detail="模板文件不能超过 10MB")

    target = _template_dir() / f"{template.id}.docx"
    target.write_bytes(content)
    try:
        from docx import Document

        Document(target)
    except Exception as exc:
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"Word 模板无法解析：{exc}")

    old_file_path = template.file_path
    if old_file_path and old_file_path != str(target):
        _delete_template_file(template)
    template.file_path = str(target)
    template.type = "docx"
    await write_audit_log(
        db,
        action="template.file_upload",
        target_type="template",
        target_id=template.id,
        target_name=template.name,
        detail={"filename": filename, "size": len(content)},
        user=current_user,
        request=request,
    )
    await db.commit()
    await db.refresh(template)
    return TemplateRead.model_validate(template)


@router.get("/{template_id}/file")
async def download_template_file(
    template_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_reader),
):
    result = await db.execute(select(Template).where(Template.id == template_id))
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="模板不存在")
    if not template.file_path:
        raise HTTPException(status_code=404, detail="模板文件不存在")
    path = Path(template.file_path)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="模板文件不存在")
    await write_audit_log(
        db,
        action="template.file_download",
        target_type="template",
        target_id=template.id,
        target_name=template.name,
        user=current_user,
        request=request,
    )
    await db.commit()
    return FileResponse(
        path,
        filename=f"{template.name}.docx",
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )


@router.delete("/{template_id}/file", response_model=TemplateRead)
async def delete_template_file(
    template_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operator),
):
    result = await db.execute(select(Template).where(Template.id == template_id))
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="模板不存在")
    _delete_template_file(template)
    template.file_path = None
    await write_audit_log(
        db,
        action="template.file_delete",
        target_type="template",
        target_id=template.id,
        target_name=template.name,
        user=current_user,
        request=request,
    )
    await db.commit()
    await db.refresh(template)
    return TemplateRead.model_validate(template)


@router.delete("/{template_id}")
async def delete_template(
    template_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operator),
):
    result = await db.execute(select(Template).where(Template.id == template_id))
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="模板不存在")
    if template.source == "system":
        raise HTTPException(status_code=400, detail="系统模板不能删除")
    _delete_template_file(template)
    await write_audit_log(
        db,
        action="template.delete",
        target_type="template",
        target_id=template.id,
        target_name=template.name,
        detail={"type": template.type},
        user=current_user,
        request=request,
    )
    await db.delete(template)
    await db.commit()
    return {"ok": True}
