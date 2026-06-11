from __future__ import annotations

import asyncio
import base64
import hashlib
import re
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urljoin

import httpx
from sqlalchemy import select

from app.database import AsyncSessionLocal, engine
from app.models.asset import Asset
from app.models.asset_change import AssetChange
from app.models.space_config import SpaceConfig
from app.models.sync_task import SyncTask
from app.models.unit import Unit, UnitStatus
from app.models.vulnerability import Vulnerability

ASSET_PATH_FALLBACKS = ("api/asset/select/query", "api/v1/assets", "api/assets", "assets")
VULNERABILITY_PATH_FALLBACKS = ("api/v1/vulnerabilities", "api/vulnerabilities", "vulnerabilities")
TRACKED_ASSET_FIELDS = ("name", "mac", "type", "os", "risk", "ports", "services", "location", "isp")
CVE_PATTERN = re.compile(r"^CVE-\d{4}-\d{4,}$", re.IGNORECASE)
DOMAIN_LIKE_PATTERN = re.compile(r"^\*?\.?[a-z0-9-]+(\.[a-z0-9-]+)+$", re.IGNORECASE)
IP_LIKE_PATTERN = re.compile(r"^\d{1,3}(\.\d{1,3}){3}$")
CJK_PATTERN = re.compile(r"[\u4e00-\u9fff]")
CVE_DETAIL_PATH = "api/v1/plugin/cve_detail/cveid"
RAYSPACE_CVE_DETAIL_LIMIT = 80


def _items(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("items", "data", "list", "results", "assets", "asset_list", "data_list", "vulnerabilities"):
        value = payload.get(key)
        if isinstance(value, list):
            return [x for x in value if isinstance(x, dict)]
        if isinstance(value, dict):
            nested = _items(value)
            if nested:
                return nested
    return []


def _text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    if isinstance(value, list):
        return ",".join(str(x) for x in value if x is not None)
    return str(value)


def _non_empty_text(value: Any) -> str:
    return _text(value).strip()


def _first_text(*values: Any, default: str = "") -> str:
    for value in values:
        text = _non_empty_text(value)
        if text:
            return text
    return default


def _risk(value: Any) -> str:
    text = _text(value, "中危").strip().lower()
    mapping = {
        "critical": "严重",
        "严重": "严重",
        "high": "高危",
        "高危": "高危",
        "3": "高危",
        "medium": "中危",
        "中危": "中危",
        "2": "中危",
        "low": "低危",
        "低危": "低危",
        "1": "低危",
    }
    return mapping.get(text, "中危")


def _severity(value: Any) -> str:
    return _risk(value)


def _cvss(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _merge_csv(*values: Any) -> str:
    items: list[str] = []
    for value in values:
        for item in re.split(r"[,，\n\r;；]+", _text(value)):
            text = item.strip()
            if text and text not in items:
                items.append(text)
    return ",".join(items)


def _poc_text(raw: dict[str, Any], *, default_from_title: bool = False) -> str:
    text = _first_text(
        raw.get("poc"),
        raw.get("pocs"),
        raw.get("poc_name"),
        raw.get("poc_title"),
        raw.get("poc_id"),
        raw.get("proof"),
        raw.get("exploit"),
    )
    if text:
        return text
    if default_from_title:
        title = _first_text(raw.get("name"), raw.get("title"), raw.get("vuln_name"))
        if title and not CVE_PATTERN.match(title.upper()):
            return title
        return "PoC"
    return ""


def _with_poc_source(vuln: dict[str, Any]) -> dict[str, Any]:
    current = dict(vuln)
    current["poc"] = _merge_csv(current.get("poc"), _poc_text(current, default_from_title=True))
    return current


def _asset_vulns(raw: dict[str, Any]) -> list[dict[str, Any]]:
    for key in ("vulnerabilities", "vulns", "risks", "cves"):
        value = raw.get(key)
        if isinstance(value, list):
            return _dedupe_vulns([v if isinstance(v, dict) else {"cve": str(v), "title": str(v)} for v in value])
    vulns: list[dict[str, Any]] = []
    for detail_key in ("cve_detail", "poc_detail"):
        detail = raw.get(detail_key)
        if isinstance(detail, dict):
            for scope in ("os", "service"):
                scoped = detail.get(scope)
                if isinstance(scoped, dict):
                    items = scoped.get("detail")
                    if isinstance(items, list):
                        for item in items:
                            vuln = item if isinstance(item, dict) else {"title": str(item)}
                            vulns.append(_with_poc_source(vuln) if detail_key == "poc_detail" else vuln)
    for list_key in ("poc_list", "cves", "cve", "pocs"):
        value = raw.get(list_key)
        if isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    vulns.append(_with_poc_source(item) if list_key in {"poc_list", "pocs"} else item)
                else:
                    text = str(item)
                    vulns.append({"poc": text, "title": text} if list_key in {"poc_list", "pocs"} else {"cve": text, "title": text})
    return _dedupe_vulns(vulns)


def _raw_vuln_refs(raw: dict[str, Any]) -> list[dict[str, Any]]:
    vulns: list[dict[str, Any]] = []
    for detail_key in ("cve_detail", "poc_detail"):
        detail = raw.get(detail_key)
        if isinstance(detail, dict):
            for scope in ("os", "service"):
                scoped = detail.get(scope)
                if isinstance(scoped, dict):
                    items = scoped.get("detail")
                    if isinstance(items, list):
                        vulns.extend(item for item in items if isinstance(item, dict))
    for list_key in ("vulnerabilities", "vulns", "risks", "cves", "poc_list", "cves", "cve", "pocs"):
        value = raw.get(list_key)
        if isinstance(value, list):
            vulns.extend(item for item in value if isinstance(item, dict))
    return vulns


def _vuln_display_title(raw: dict[str, Any], cve: str = "") -> str:
    if cve:
        name = _first_text(raw.get("name"), raw.get("vuln_name"))
        if name and name.upper() != cve:
            return name
    return _first_text(raw.get("title"), raw.get("name"), raw.get("vuln_name"), cve, raw.get("cve"), raw.get("cve_id"), default="未命名漏洞")


def _dedupe_vulns(vulns: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_cve: dict[str, dict[str, Any]] = {}
    non_cve: list[dict[str, Any]] = []
    for vuln in vulns:
        cve = _valid_cve(vuln.get("cve") or vuln.get("cve_id"))
        if not cve:
            non_cve.append(vuln)
            continue
        current = dict(vuln)
        current["cve"] = cve
        existing = by_cve.get(cve)
        current["poc"] = _merge_csv(current.get("poc"), _poc_text(current))
        if not existing:
            by_cve[cve] = current
            continue
        merged_poc = _merge_csv(existing.get("poc"), current.get("poc"), _poc_text(existing), _poc_text(current))
        existing_title = _vuln_display_title(existing, cve)
        current_title = _vuln_display_title(current, cve)
        if existing_title.upper() == cve and current_title.upper() != cve:
            current["poc"] = merged_poc
            by_cve[cve] = current
        else:
            existing["poc"] = merged_poc
    return [*by_cve.values(), *non_cve]


def _tokens(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        tokens: list[str] = []
        for item in value:
            if isinstance(item, dict):
                for key in ("port", "service", "name"):
                    if item.get(key) is not None:
                        tokens.append(str(item[key]))
                        break
            else:
                tokens.append(str(item))
        return [token.strip() for token in tokens if token and token.strip()]
    return [token.strip() for token in str(value).split(",") if token.strip()]


def _merge_tokens(existing: Any, incoming: Any, numeric: bool = False) -> str:
    values = list(dict.fromkeys([*_tokens(existing), *_tokens(incoming)]))
    if numeric:
        values.sort(key=lambda item: (0, int(item)) if item.isdigit() else (1, item))
    return ",".join(values)


def _asset_ports(raw: dict[str, Any]) -> str:
    ports = _merge_tokens(raw.get("ports") or raw.get("open_ports"), raw.get("port"), numeric=True)
    return _merge_tokens(ports, raw.get("port_list"), numeric=True)


def _asset_services(raw: dict[str, Any]) -> str:
    services = _merge_tokens(raw.get("services"), raw.get("service"))
    return _merge_tokens(services, raw.get("service_list"))


def _raw_key(raw: dict[str, Any]) -> str:
    return "|".join(
        _text(raw.get(key))
        for key in ("ip", "port", "service", "protocol", "title", "date")
    )


def _merge_raw_data(existing: Any, raw: dict[str, Any]) -> list[dict[str, Any]]:
    items = [item for item in existing if isinstance(item, dict)] if isinstance(existing, list) else []
    keys = {_raw_key(item) for item in items}
    key = _raw_key(raw)
    if key not in keys:
        items.append(raw)
    return items


def _asset_snapshot(asset: Asset) -> dict[str, str]:
    return {field: _text(getattr(asset, field, "")) for field in TRACKED_ASSET_FIELDS}


def _asset_changes(before: dict[str, str], asset: Asset) -> dict[str, dict[str, str]]:
    changes: dict[str, dict[str, str]] = {}
    for field in TRACKED_ASSET_FIELDS:
        old = before.get(field, "")
        new = _text(getattr(asset, field, ""))
        if old != new:
            changes[field] = {"before": old, "after": new}
    return changes


def _set_if_present(asset: Asset, field: str, value: Any, default: str = "") -> None:
    text = _non_empty_text(value)
    if text:
        setattr(asset, field, text)
    elif default and not _non_empty_text(getattr(asset, field, "")):
        setattr(asset, field, default)


def _raw_asset_name(raw: dict[str, Any], fallback: str) -> str:
    return _first_text(raw.get("name"), raw.get("hostname"), raw.get("title"), raw.get("device"), default=fallback)


def _raw_asset_type(raw: dict[str, Any]) -> str:
    return _first_text(raw.get("type"), raw.get("asset_type"), raw.get("device_type"), raw.get("category_sub"))


def _raw_asset_location(raw: dict[str, Any]) -> str:
    return _first_text(raw.get("location"), raw.get("region"), raw.get("province"), raw.get("city"), raw.get("country"))


def _raw_unit_name(raw: dict[str, Any]) -> str:
    return _first_text(
        raw.get("unit_name"),
        raw.get("dept"),
        raw.get("department"),
        raw.get("org"),
        raw.get("organization"),
        raw.get("company"),
    )


def _unit_rule_values(unit: Unit) -> tuple[list[str], list[str]]:
    exact = [unit.name, *(unit.aliases or [])]
    keywords = [*(unit.keywords or [])]
    return (
        [item.strip().lower() for item in exact if item and item.strip()],
        [item.strip().lower() for item in keywords if item and item.strip()],
    )


def unit_id_from_raw(raw: dict[str, Any], units: list[Unit]) -> str | None:
    raw_unit_name = _raw_unit_name(raw).strip().lower()
    raw_text = " ".join(
        _non_empty_text(raw.get(key))
        for key in (
            "unit_name",
            "dept",
            "department",
            "org",
            "organization",
            "company",
            "ip_company_full",
            "source",
            "domain",
            "title",
        )
    ).strip().lower()
    for unit in units:
        exact_values, _ = _unit_rule_values(unit)
        if raw_unit_name and raw_unit_name in exact_values:
            return unit.id
    for unit in units:
        _, keywords = _unit_rule_values(unit)
        if raw_text and any(keyword in raw_text for keyword in keywords):
            return unit.id
    return None


def _unit_code_from_raw_name(name: str) -> str:
    digest = hashlib.sha1(name.strip().encode()).hexdigest()[:16]
    return f"rs-{digest}"


def _usable_raw_unit_name(name: str) -> str:
    text = name.strip()
    if not text or "*" in text or IP_LIKE_PATTERN.match(text) or DOMAIN_LIKE_PATTERN.match(text):
        return ""
    if not CJK_PATTERN.search(text):
        return ""
    return text


async def _record_asset_change(
    db,
    asset: Asset,
    action: str,
    changes: dict[str, Any],
    source: str = "space_sync",
) -> None:
    if not changes:
        return
    db.add(
        AssetChange(
            asset_id=asset.id,
            unit_id=asset.unit_id,
            ip=asset.ip,
            source=source,
            action=action,
            changes=changes,
        )
    )


def _valid_cve(value: Any) -> str:
    text = _non_empty_text(value).upper()
    return text if CVE_PATTERN.match(text) else ""


def space_candidate_paths(primary: str, fallbacks: tuple[str, ...]) -> tuple[str, ...]:
    paths: list[str] = []
    for path in (primary, *fallbacks):
        normalized = (path or "").strip().strip("/")
        if normalized and normalized not in paths:
            paths.append(normalized)
    return tuple(paths)


def space_request_options(config: SpaceConfig) -> tuple[dict[str, str], tuple[str, str] | None]:
    headers = {}
    auth = None
    auth_type = (config.auth_type or "auto").lower()
    if auth_type == "rayspace":
        return headers, None
    if auth_type in {"auto", "bearer"} and config.api_key:
        headers["Authorization"] = f"Bearer {config.api_key}"
    if auth_type in {"auto", "api_key"} and config.api_key:
        headers["X-API-Key"] = config.api_key
    if auth_type in {"auto", "basic"} and config.username and config.password:
        auth = (config.username, config.password)
    return headers, auth


async def fetch_space_payload(
    client: httpx.AsyncClient,
    base_url: str,
    paths: tuple[str, ...],
    params: dict[str, str],
    label: str,
) -> tuple[dict[str, Any] | list[Any], str, int]:
    last_error = ""
    for path in paths:
        try:
            resp = await client.get(urljoin(base_url, path), params=params)
            if resp.status_code < 400:
                return resp.json(), path, resp.status_code
            body = resp.text[:200].replace("\n", " ")
            last_error = f"{label}接口 {path} HTTP {resp.status_code}: {body}"
        except Exception as exc:  # external adapter must surface provider errors
            last_error = f"{label}接口 {path} 连接失败: {exc}"
    raise RuntimeError(last_error or f"{label}接口不可用")


def unit_sync_params(unit: Unit) -> dict[str, str]:
    params = {
        "unit_code": unit.code,
        "unit_name": unit.name,
        "ip_ranges": ",".join(unit.ip_ranges or []),
    }
    return {key: value for key, value in params.items() if value}


def rayspace_query_for_unit(unit: Unit) -> str:
    if unit.ip_ranges:
        terms = [f'ip:"{item}"' for item in unit.ip_ranges if item]
        return " || ".join(terms)
    return f'dept:"{unit.name}"'


def _quote_query_value(value: Any) -> str:
    text = _non_empty_text(value)
    return text.replace("\\", "\\\\").replace('"', '\\"')


def _split_condition_values(value: Any) -> list[str]:
    if isinstance(value, list):
        values = value
    else:
        values = re.split(r"[,，\n\r;；\s]+", _text(value))
    return [item.strip() for item in values if item is not None and item.strip()]


def _condition_term(key: str, value: str) -> str:
    return f'{key}:"{_quote_query_value(value)}"'


def _condition_group(key: str, value: Any, *, split: bool = False) -> str:
    values = _split_condition_values(value) if split else [_non_empty_text(value)]
    terms = [_condition_term(key, item) for item in values if item]
    if not terms:
        return ""
    return terms[0] if len(terms) == 1 else f"({' || '.join(terms)})"


def build_rayspace_query(
    *,
    unit: Unit | None = None,
    advanced_query: str = "",
    startdate: str = "",
    enddate: str = "",
    province: str = "",
    city: str = "",
    county: str = "",
    country: str = "",
    domain: str = "",
    ip: str = "",
    ports: list[str] | None = None,
    protocol: str = "",
    service: str = "",
    status: str = "",
    asn: str = "",
    isp: str = "",
    category: str = "",
    category_main: str = "",
    category_sub: str = "",
    device_type: str = "",
    device_category: str = "",
    os_type: str = "",
    os: str = "",
    support_type: str = "",
    support_category: str = "",
    support_service: str = "",
    middleware: str = "",
    product: str = "",
    title: str = "",
    banner: str = "",
    header: str = "",
    body: str = "",
    server: str = "",
    http_status: str = "",
    cve: str = "",
    cve_name: str = "",
    poc: str = "",
    tag: str = "",
    custom_tag: str = "",
    industry: str = "",
    dept: str = "",
    ip_company_full: str = "",
    keyword: str = "",
) -> str:
    groups: list[str] = []
    if unit:
        unit_query = rayspace_query_for_unit(unit)
        if unit_query:
            groups.append(f"({unit_query})" if " || " in unit_query else unit_query)
    for key, value in (
        ("startdate", startdate),
        ("enddate", enddate),
        ("province", province),
        ("city", city),
        ("county", county),
        ("country", country),
        ("protocol", protocol),
        ("service", service),
        ("status", status),
        ("asn", asn),
        ("isp", isp),
        ("category", category),
        ("category_main", category_main),
        ("category_sub", category_sub),
        ("device_type", device_type),
        ("device_category", device_category),
        ("os_type", os_type),
        ("os", os),
        ("support_type", support_type),
        ("support_category", support_category),
        ("support_service", support_service),
        ("middleware", middleware),
        ("product", product),
        ("title", title),
        ("banner", banner),
        ("header", header),
        ("body", body),
        ("server", server),
        ("http_status", http_status),
        ("cve_name", cve_name),
        ("industry", industry),
        ("dept", dept),
        ("ip_company_full", ip_company_full),
        ("text", keyword),
    ):
        group = _condition_group(key, value)
        if group:
            groups.append(group)
    for key, value in (
        ("ip", ip),
        ("port", ports or []),
        ("domain", domain),
        ("cve", cve),
        ("poc", poc),
        ("tag", tag),
        ("custom_tag", custom_tag),
    ):
        group = _condition_group(key, value, split=True)
        if group:
            groups.append(group)
    raw_query = _non_empty_text(advanced_query)
    if raw_query:
        groups.append(f"({raw_query})")
    return " && ".join(groups)


def sync_query_condition(config: SpaceConfig, unit: Unit) -> str:
    if (config.auth_type or "").lower() == "rayspace":
        return rayspace_query_for_unit(unit)
    return f"unit_code={unit.code}; unit_name={unit.name}; ip_ranges={','.join(unit.ip_ranges or [])}"


async def rayspace_sid(client: httpx.AsyncClient, config: SpaceConfig, base_url: str) -> str:
    resp = await client.post(
        urljoin(base_url, "login/"),
        json={"username": config.username, "password": config.password},
    )
    payload = resp.json()
    sid = _text(payload.get("SID"))
    if resp.status_code >= 400 or not sid or payload.get("success") is False:
        raise RuntimeError(f"RaySpace 登录失败 HTTP {resp.status_code}: {_text(payload.get('msg') or payload)[:200]}")
    return sid


async def _query_rayspace_assets_once(
    client: httpx.AsyncClient,
    base_url: str,
    asset_path: str,
    sid: str,
    query: str,
    page_index: int = 1,
    page_length: int = 1000,
) -> tuple[list[dict[str, Any]] | None, list[str]]:
    payload = {
        "SID": sid,
        "page_index": page_index,
        "page_length": page_length,
        "search_value": base64.b64encode(query.encode()).decode(),
    }
    url_params = {"SID": sid}
    errors: list[str] = []
    requests = (
        ("POST json", lambda: client.post(urljoin(base_url, asset_path), params=url_params, json=payload)),
        ("POST form", lambda: client.post(urljoin(base_url, asset_path), params=url_params, data=payload)),
        ("GET params", lambda: client.get(urljoin(base_url, asset_path), params=payload)),
    )
    for label, request in requests:
        try:
            resp = await request()
            data = resp.json()
        except Exception as exc:
            errors.append(f"{label} 请求失败: {type(exc).__name__}: {_text(exc)[:200]}")
            continue
        code = data.get("code", resp.status_code) if isinstance(data, dict) else resp.status_code
        if resp.status_code < 400 and code in (200, "200", 411, "411"):
            return _items(data), []
        errors.append(f"{label} HTTP {resp.status_code}, code {code}: {_text(data)[:200]}")
    return None, errors


async def _query_rayspace_cve_detail_once(
    client: httpx.AsyncClient,
    base_url: str,
    sid: str,
    cve: str,
) -> tuple[dict[str, Any] | None, str]:
    try:
        resp = await client.get(urljoin(base_url, CVE_DETAIL_PATH), params={"SID": sid, "cve_id": cve})
        data = resp.json()
    except Exception as exc:
        return None, f"CVE详情接口 {cve} 连接失败: {exc}"
    code = data.get("code", resp.status_code) if isinstance(data, dict) else resp.status_code
    if resp.status_code < 400 and code in (200, "200") and isinstance(data, dict):
        detail = data.get("data")
        if isinstance(detail, dict):
            return detail, ""
    return None, f"CVE详情接口 {cve} HTTP {resp.status_code}, code {code}: {_text(data)[:200]}"


async def _rayspace_cve_detail(
    client: httpx.AsyncClient,
    config: SpaceConfig,
    base_url: str,
    sid: str,
    cve: str,
) -> tuple[dict[str, Any] | None, str]:
    detail, error = await _query_rayspace_cve_detail_once(client, base_url, sid, cve)
    if detail is not None:
        return detail, sid
    refreshed_sid = await rayspace_sid(client, config, base_url)
    detail, _ = await _query_rayspace_cve_detail_once(client, base_url, refreshed_sid, cve)
    return detail, refreshed_sid


async def _enrich_rayspace_cve_details(
    client: httpx.AsyncClient,
    config: SpaceConfig,
    base_url: str,
    sid: str,
    assets: list[dict[str, Any]],
) -> str:
    cache: dict[str, dict[str, Any] | None] = {}
    current_sid = sid
    queried = 0
    for asset in assets:
        for vuln in _raw_vuln_refs(asset):
            cve = _valid_cve(vuln.get("cve") or vuln.get("cve_id"))
            if not cve or _non_empty_text(vuln.get("descr")):
                continue
            if cve not in cache:
                if queried >= RAYSPACE_CVE_DETAIL_LIMIT:
                    return current_sid
                detail, current_sid = await _rayspace_cve_detail(client, config, base_url, current_sid, cve)
                cache[cve] = detail
                queried += 1
            detail = cache.get(cve)
            if not detail:
                continue
            for field in ("descr", "solution", "cvss", "cvss_score", "family", "refs"):
                if detail.get(field) is not None and vuln.get(field) in (None, ""):
                    vuln[field] = detail[field]
            detail_name = _first_text(detail.get("name"))
            if detail_name and _vuln_display_title(vuln, cve).upper() == cve:
                vuln["name"] = detail_name
    return current_sid


async def fetch_rayspace_assets(config: SpaceConfig, unit: Unit | None = None, query: str = "") -> list[dict[str, Any]]:
    base_url = config.base_url.rstrip("/") + "/"
    asset_path = space_candidate_paths(config.asset_path, ASSET_PATH_FALLBACKS)[0]
    if not asset_path.endswith("/"):
        asset_path = f"{asset_path}/"
    async with httpx.AsyncClient(timeout=30, verify=config.verify_tls) as client:
        sid = await rayspace_sid(client, config, base_url)
        query = query or (rayspace_query_for_unit(unit) if unit else "")
        if not query:
            raise RuntimeError("RaySpace 查询条件不能为空")
        page_length = 100
        all_assets: list[dict[str, Any]] = []
        current_sid = sid
        for page_index in range(1, 11):
            assets, first_errors = await _query_rayspace_assets_once(
                client, base_url, asset_path, current_sid, query, page_index=page_index, page_length=page_length
            )
            if assets is None:
                current_sid = await rayspace_sid(client, config, base_url)
                assets, second_errors = await _query_rayspace_assets_once(
                    client, base_url, asset_path, current_sid, query, page_index=page_index, page_length=page_length
                )
                if assets is None:
                    if all_assets:
                        break
                    raise RuntimeError(f"RaySpace 资产查询失败；首次：{'；'.join(first_errors)}；刷新token后：{'；'.join(second_errors)}")
            if not assets:
                break
            all_assets.extend(assets)
            if len(assets) < page_length:
                break
        await _enrich_rayspace_cve_details(client, config, base_url, current_sid, all_assets)
        return all_assets


async def _fetch_space(config: SpaceConfig, unit: Unit | None, query: str = "") -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if (config.auth_type or "").lower() == "rayspace":
        raw_assets = await fetch_rayspace_assets(config, unit=unit, query=query)
        return raw_assets, []

    if not unit:
        raise RuntimeError("非 RaySpace 认证方式暂不支持无单位条件拉取")
    headers, auth = space_request_options(config)
    params = unit_sync_params(unit)
    base_url = config.base_url.rstrip("/") + "/"
    asset_paths = space_candidate_paths(config.asset_path, ASSET_PATH_FALLBACKS)
    vulnerability_paths = space_candidate_paths(config.vulnerability_path, VULNERABILITY_PATH_FALLBACKS)
    async with httpx.AsyncClient(timeout=30, verify=config.verify_tls, headers=headers, auth=auth) as client:
        asset_payload, _, _ = await fetch_space_payload(client, base_url, asset_paths, params, "资产")
        try:
            vuln_payload, _, _ = await fetch_space_payload(client, base_url, vulnerability_paths, params, "漏洞")
        except RuntimeError:
            vuln_payload = []

    return _items(asset_payload), _items(vuln_payload)


async def run_space_sync(task_id: str) -> dict[str, int]:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(SyncTask).where(SyncTask.id == task_id))
        task = result.scalar_one_or_none()
        if not task:
            raise RuntimeError("同步任务不存在")

        unit = None
        if task.unit_id:
            unit_result = await db.execute(select(Unit).where(Unit.id == task.unit_id))
            unit = unit_result.scalar_one_or_none()
            if not unit:
                task.status = "failed"
                task.message = "单位不存在"
                await db.commit()
                return {"assets": 0, "vulns": 0}

        config_result = await db.execute(select(SpaceConfig).where(SpaceConfig.id == "default"))
        config = config_result.scalar_one_or_none()
        if not config:
            task.status = "failed"
            task.message = "Space 配置不存在"
            await db.commit()
            return {"assets": 0, "vulns": 0}

        task.status = "running"
        task.message = "同步执行中"
        task.query_condition = task.query_condition or (sync_query_condition(config, unit) if unit else "")
        task.fetched_assets = 0
        task.synced_assets = 0
        task.synced_vulns = 0
        task.error_detail = ""
        await db.commit()

        try:
            if config.mock_mode:
                task.status = "success"
                task.message = "Mock 模式已完成：未拉取真实 Space 数据"
                task.fetched_assets = 0
                task.synced_assets = 0
                task.synced_vulns = 0
                unit.last_sync = datetime.utcnow()
                await db.commit()
                return {"assets": 0, "vulns": 0}

            raw_assets, raw_vulns = await _fetch_space(config, unit, query=task.query_condition)
            task.fetched_assets = len(raw_assets)
            synced_asset_ids: set[str] = set()
            vuln_count = 0
            asset_ids_by_key: dict[str, str] = {}
            units = list((await db.execute(select(Unit))).scalars().all())

            for raw in raw_assets:
                ip = _first_text(raw.get("ip"), raw.get("ip_address"), raw.get("host"))
                if not ip:
                    continue
                raw_unit_id = unit.id if unit else unit_id_from_raw(raw, units)
                raw_unit_name = _usable_raw_unit_name(_raw_unit_name(raw))
                if not raw_unit_id and raw_unit_name:
                    auto_unit = Unit(
                        name=raw_unit_name,
                        code=_unit_code_from_raw_name(raw_unit_name),
                        desc="RaySpace资产同步自动创建",
                        status=UnitStatus.ACTIVE,
                        region_name=_first_text(raw.get("province"), raw.get("city"), raw.get("county")),
                    )
                    db.add(auto_unit)
                    await db.flush()
                    raw_unit_id = auto_unit.id
                    units.append(auto_unit)
                if raw_unit_id:
                    existing = await db.execute(select(Asset).where(Asset.unit_id == raw_unit_id, Asset.ip == ip))
                else:
                    existing = await db.execute(select(Asset).where(Asset.unit_id.is_(None), Asset.ip == ip))
                asset = existing.scalar_one_or_none()
                if not asset and raw_unit_id:
                    existing_unassigned = await db.execute(select(Asset).where(Asset.unit_id.is_(None), Asset.ip == ip))
                    asset = existing_unassigned.scalar_one_or_none()
                is_new = asset is None
                if not asset:
                    asset = Asset(
                        name=_raw_asset_name(raw, ip),
                        ip=ip,
                        unit_id=raw_unit_id,
                    )
                    db.add(asset)
                elif raw_unit_id and not asset.unit_id:
                    asset.unit_id = raw_unit_id

                before = _asset_snapshot(asset)
                _set_if_present(asset, "name", _raw_asset_name(raw, ""), default=ip)
                _set_if_present(asset, "mac", _first_text(raw.get("mac"), raw.get("mac_address")))
                _set_if_present(asset, "type", _raw_asset_type(raw), default="服务器")
                _set_if_present(asset, "os", _first_text(raw.get("os"), raw.get("operating_system")))
                if any(raw.get(key) is not None for key in ("risk", "risk_level", "severity")):
                    asset.risk = _risk(raw.get("risk") or raw.get("risk_level") or raw.get("severity"))
                asset.ports = _merge_tokens(asset.ports, _asset_ports(raw), numeric=True)
                asset.services = _merge_tokens(asset.services, _asset_services(raw))
                _set_if_present(asset, "location", _raw_asset_location(raw))
                _set_if_present(asset, "isp", raw.get("isp"))
                asset.raw_data = _merge_raw_data(asset.raw_data, raw)
                asset.last_seen = datetime.utcnow()
                await db.flush()
                if is_new:
                    await _record_asset_change(db, asset, "create", {"after": _asset_snapshot(asset)})
                else:
                    await _record_asset_change(db, asset, "update", _asset_changes(before, asset))
                asset_ids_by_key[ip] = asset.id
                synced_asset_ids.add(asset.id)

                linked_ids = set(asset.vuln_ids or [])
                for vuln_raw in _asset_vulns(raw):
                    vuln = await _upsert_vuln(db, vuln_raw, asset.id)
                    linked_ids.add(vuln.id)
                    vuln_count += 1
                asset.vuln_ids = list(linked_ids)

            for raw in raw_vulns:
                asset_ip = _text(raw.get("ip") or raw.get("asset_ip") or raw.get("host"))
                asset_id = _text(raw.get("asset_id")) or asset_ids_by_key.get(asset_ip, "")
                if asset_id:
                    await _upsert_vuln(db, raw, asset_id)
                    vuln_count += 1

            task.status = "success"
            task.message = f"同步完成：资产 {len(synced_asset_ids)} 个，漏洞 {vuln_count} 条"
            task.synced_assets = len(synced_asset_ids)
            task.synced_vulns = vuln_count
            task.error_detail = ""
            if unit:
                unit.last_sync = datetime.utcnow()
            await db.commit()
            return {"assets": len(synced_asset_ids), "vulns": vuln_count}
        except Exception as exc:
            error = str(exc)
            task.status = "failed"
            task.message = f"同步失败：{error}"
            task.error_detail = error
            await db.commit()
            return {"assets": 0, "vulns": 0}


async def create_due_sync_tasks() -> list[str]:
    now = datetime.utcnow()
    async with AsyncSessionLocal() as db:
        config_result = await db.execute(select(SpaceConfig).where(SpaceConfig.id == "default"))
        config = config_result.scalar_one_or_none()
        if not config or not config.sync_enabled or config.sync_interval_minutes <= 0:
            return []

        interval = timedelta(minutes=config.sync_interval_minutes)
        unit_result = await db.execute(select(Unit).where(Unit.status == UnitStatus.ACTIVE))
        task_ids: list[str] = []
        for unit in unit_result.scalars().all():
            if unit.last_sync and now - unit.last_sync < interval:
                continue
            running_result = await db.execute(
                select(SyncTask)
                .where(SyncTask.unit_id == unit.id, SyncTask.status.in_(["pending", "running"]))
                .order_by(SyncTask.created_at.desc())
                .limit(1)
            )
            if running_result.scalar_one_or_none():
                continue
            task = SyncTask(
                unit_id=unit.id,
                status="pending",
                message="自动同步等待执行",
            )
            db.add(task)
            await db.flush()
            task_ids.append(task.id)
        await db.commit()
        return task_ids


def create_due_sync_tasks_blocking() -> list[str]:
    async def _run_and_dispose() -> list[str]:
        try:
            return await create_due_sync_tasks()
        finally:
            await engine.dispose()

    return asyncio.run(_run_and_dispose())


async def _upsert_vuln(db, raw: dict[str, Any], asset_id: str) -> Vulnerability:
    cve = _valid_cve(raw.get("cve") or raw.get("cve_id"))
    title = _vuln_display_title(raw, cve)
    stmt = select(Vulnerability)
    if cve:
        stmt = stmt.where(Vulnerability.cve == cve)
    else:
        stmt = stmt.where(Vulnerability.title == title)
    result = await db.execute(stmt)
    vuln = result.scalar_one_or_none()
    if not vuln:
        vuln = Vulnerability(title=title, cve=cve, status=_text(raw.get("status"), "待确认"))
        db.add(vuln)
    if not cve or title.upper() != cve or vuln.title.upper() == cve:
        vuln.title = title
    vuln.poc = _merge_csv(vuln.poc, _poc_text(raw))
    vuln.cvss = _cvss(raw.get("cvss_score") or raw.get("cvss") or raw.get("score"))
    vuln.severity = _severity(raw.get("severity") or raw.get("risk") or raw.get("level"))
    desc = _first_text(raw.get("descr"), raw.get("desc"), raw.get("description"))
    if desc:
        vuln.desc = desc
    vuln.solution = _text(raw.get("solution") or raw.get("remediation") or raw.get("fix"))
    now = datetime.utcnow()
    vuln.first_found = vuln.first_found or now
    vuln.last_found = now
    ids = set(vuln.asset_ids or [])
    ids.add(asset_id)
    vuln.asset_ids = list(ids)
    await db.flush()
    return vuln


def run_space_sync_blocking(task_id: str) -> dict[str, int]:
    async def _run_and_dispose() -> dict[str, int]:
        try:
            return await run_space_sync(task_id)
        finally:
            await engine.dispose()

    return asyncio.run(_run_and_dispose())
