#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost}"
ADMIN_USERNAME="${ADMIN_USERNAME:-security-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

if [[ -z "$ADMIN_PASSWORD" ]]; then
  echo "ADMIN_PASSWORD is required" >&2
  echo "Usage: ADMIN_PASSWORD='***' BASE_URL='http://localhost' ./ops/acceptance_check.sh" >&2
  exit 2
fi

python3 - "$BASE_URL" "$ADMIN_USERNAME" "$ADMIN_PASSWORD" <<'PY'
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
import uuid
import zipfile
from io import BytesIO

base_url, username, password = sys.argv[1:4]
base_url = base_url.rstrip("/")
api_url = f"{base_url}/api"


def _json_body(body: object | None) -> bytes | None:
    return None if body is None else json.dumps(body).encode("utf-8")


def request(method: str, path: str, body: object | None = None, token: str = "", expect: int = 200, binary: bool = False):
    req = urllib.request.Request(f"{api_url}{path}", data=_json_body(body), method=method)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = resp.read()
            if resp.status != expect:
                raise AssertionError(f"{method} {path}: expected {expect}, got {resp.status}")
            if binary:
                return payload
            return json.loads(payload.decode("utf-8")) if payload else None
    except urllib.error.HTTPError as exc:
        payload = exc.read().decode("utf-8", errors="ignore")
        if exc.code == expect:
            try:
                return json.loads(payload) if payload else None
            except json.JSONDecodeError:
                return payload
        raise AssertionError(f"{method} {path}: expected {expect}, got {exc.code}, body={payload}") from exc


def request_multipart(path: str, field_name: str, filename: str, content: bytes, token: str = "", expect: int = 200):
    boundary = f"----ctem-{uuid.uuid4().hex}"
    body = b"".join(
        [
            f"--{boundary}\r\n".encode("utf-8"),
            f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\n'.encode("utf-8"),
            b"Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n",
            content,
            b"\r\n",
            f"--{boundary}--\r\n".encode("utf-8"),
        ]
    )
    req = urllib.request.Request(f"{api_url}{path}", data=body, method="POST")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = resp.read()
            if resp.status != expect:
                raise AssertionError(f"POST {path}: expected {expect}, got {resp.status}")
            return json.loads(payload.decode("utf-8")) if payload else None
    except urllib.error.HTTPError as exc:
        payload = exc.read().decode("utf-8", errors="ignore")
        raise AssertionError(f"POST {path}: expected {expect}, got {exc.code}, body={payload}") from exc


def build_docx_template(marker: str) -> bytes:
    document_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>{{{{report_title}}}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>{marker}: {{{{unit_name}}}} / {{{{asset_count}}}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>{{{{asset_table}}}}</w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800"/></w:sectPr>
  </w:body>
</w:document>'''.encode("utf-8")
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>''')
        zf.writestr("_rels/.rels", '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>''')
        zf.writestr("word/document.xml", document_xml)
    return buf.getvalue()


def check(name: str, func) -> None:
    try:
        func()
        print(f"[OK] {name}")
    except Exception as exc:
        print(f"[FAIL] {name}: {exc}", file=sys.stderr)
        raise


token = ""
created_template_id = ""
created_report_id = ""
asset_restore = None


def login_check() -> None:
    global token
    login = request("POST", "/auth/login", {"username": username, "password": password})
    token = login["access_token"]
    user = login["user"]
    assert user["username"] == username
    assert user["role"] == "super_admin"
    me = request("GET", "/auth/me", token=token)
    assert me["username"] == username


def health_check() -> None:
    health = request("GET", "/health")
    assert health["status"] == "ok"
    deep = request("GET", "/health/deep", token=token)
    assert deep["status"] in {"ok", "degraded"}
    for key in ("database", "redis", "space_config"):
        assert key in deep["checks"]


def permission_check() -> None:
    unauth = request("GET", "/sync/config", expect=401)
    assert unauth
    config = request("GET", "/sync/config", token=token)
    assert "auth_type" in config


def core_data_check() -> None:
    units = request("GET", "/units/", token=token)
    assets = request("GET", "/assets/", token=token)
    vulns = request("GET", "/vulnerabilities/", token=token)
    templates = request("GET", "/templates/", token=token)
    reports = request("GET", "/reports/", token=token)
    quality = request("GET", "/assets/quality/summary", token=token)
    assert isinstance(units, list)
    assert isinstance(assets, list)
    assert isinstance(vulns, list)
    assert isinstance(templates, list)
    assert isinstance(reports, list)
    assert "total_assets" in quality
    assert len(templates) >= 4


def validation_check() -> None:
    invalid_asset = request(
        "POST",
        "/assets/",
        {"name": "验收无效资产", "ip": "203.0.113.10", "unit_id": "missing-unit-id"},
        token=token,
        expect=404,
    )
    assert invalid_asset["detail"] == "目标单位不存在"
    invalid_vuln = request(
        "POST",
        "/vulnerabilities/",
        {"title": "验收无效漏洞", "severity": "未知", "status": "待确认", "asset_ids": []},
        token=token,
        expect=400,
    )
    assert invalid_vuln["detail"] == "不支持的漏洞等级"
    invalid_vuln_asset = request(
        "POST",
        "/vulnerabilities/",
        {"title": "验收缺失资产漏洞", "severity": "中危", "status": "待确认", "asset_ids": ["missing-asset-id"]},
        token=token,
        expect=404,
    )
    assert invalid_vuln_asset["detail"].startswith("影响资产不存在")


def asset_edit_check() -> None:
    global asset_restore
    assets = request("GET", "/assets/", token=token)
    if not assets:
        print("[SKIP] asset-edit: no assets")
        return
    asset = assets[0]
    original = {
        "name": asset["name"],
        "ip": asset["ip"],
        "mac": asset.get("mac", ""),
        "type": asset["type"],
        "os": asset.get("os", ""),
        "risk": asset["risk"],
        "unit_id": asset["unit_id"],
        "ports": asset.get("ports", ""),
        "services": asset.get("services", ""),
        "location": asset.get("location", ""),
        "isp": asset.get("isp", ""),
    }
    asset_restore = (asset["id"], original)
    marker = f"验收修正-{int(time.time())}"
    patched = dict(original)
    patched["location"] = marker
    updated = request("PUT", f"/assets/{asset['id']}", patched, token=token)
    assert updated["location"] == marker
    changes = request("GET", f"/assets/{asset['id']}/changes", token=token)
    assert any(item["action"] == "manual_update" for item in changes)


def template_report_check() -> None:
    global created_template_id, created_report_id
    stamp = int(time.time())
    marker = f"P1-0-2验收-{stamp}"
    template = request(
        "POST",
        "/templates/",
        {
            "name": f"{marker}-模板",
            "desc": "自动验收后删除",
            "type": "docx",
            "vars": ["unit_name", "asset_count"],
            "content": f"{marker}: 初始 {{{{unit_name}}}} / {{{{asset_count}}}}",
        },
        token=token,
        expect=201,
    )
    created_template_id = template["id"]
    patched = request(
        "PATCH",
        f"/templates/{created_template_id}",
        {"content": f"{marker}: 已编辑 {{{{unit_name}}}} / {{{{asset_count}}}}"},
        token=token,
    )
    assert patched["content"].startswith(marker)
    uploaded = request_multipart(
        f"/templates/{created_template_id}/file",
        "file",
        f"{marker}.docx",
        build_docx_template(marker),
        token=token,
    )
    assert uploaded["has_file"] is True
    report = request(
        "POST",
        "/reports/",
        {
            "title": f"{marker}-报表",
            "type": patched["name"],
            "format": "docx",
            "template_id": created_template_id,
            "severity_filter": [],
            "status_filter": [],
        },
        token=token,
        expect=201,
    )
    created_report_id = report["id"]
    assert report["status"] == "completed"
    assert report["template_name"] == patched["name"]
    docx = request("GET", f"/reports/{created_report_id}/download", token=token, binary=True)
    with zipfile.ZipFile(BytesIO(docx)) as zf:
        xml = "\n".join(zf.read(name).decode("utf-8", errors="ignore") for name in zf.namelist() if name.endswith(".xml"))
    assert marker in xml
    assert "全量单位" in xml
    assert "资产清单" not in xml or "IP" in xml
    audits = request("GET", "/audit/?target_type=template&limit=20", token=token)
    actions = {item["action"] for item in audits}
    assert {"template.create", "template.update", "template.file_upload"}.issubset(actions)


def cleanup() -> None:
    global created_report_id, created_template_id, asset_restore
    if created_report_id:
        try:
            request("DELETE", f"/reports/{created_report_id}", token=token)
        finally:
            created_report_id = ""
    if created_template_id:
        try:
            request("DELETE", f"/templates/{created_template_id}", token=token)
        finally:
            created_template_id = ""
    if asset_restore:
        asset_id, original = asset_restore
        try:
            request("PUT", f"/assets/{asset_id}", original, token=token)
        finally:
            asset_restore = None


try:
    check("login", login_check)
    check("health", health_check)
    check("permissions", permission_check)
    check("core-data", core_data_check)
    check("validation", validation_check)
    check("asset-edit", asset_edit_check)
    check("template-report", template_report_check)
finally:
    cleanup()

print("[OK] cleanup")
print("Acceptance checks passed")
PY
