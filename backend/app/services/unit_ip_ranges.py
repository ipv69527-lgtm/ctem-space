from __future__ import annotations

import ipaddress
from collections.abc import Iterable

from app.models.unit import Unit


def clean_list(values: Iterable[object] | None) -> list[str]:
    items: list[str] = []
    for item in values or []:
        text = str(item or "").strip()
        if text and text not in items:
            items.append(text)
    return items


def normal_ip(value: object) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    try:
        return str(ipaddress.ip_address(text))
    except ValueError:
        return ""


def _ip_sort_key(value: str) -> tuple[int, int]:
    address = ipaddress.ip_address(value)
    return (address.version, int(address))


def sorted_asset_ips(values: Iterable[object] | None) -> list[str]:
    return sorted({ip for ip in (normal_ip(value) for value in values or []) if ip}, key=_ip_sort_key)


def merge_unit_ip_ranges(unit: Unit, asset_ips: Iterable[object] | None) -> dict:
    current = clean_list(unit.ip_ranges or [])
    suggested = sorted_asset_ips(asset_ips)
    added = [ip for ip in suggested if ip not in current]
    merged = [*current, *added]
    return {
        "unit_id": unit.id,
        "unit_name": unit.name,
        "asset_count": len(suggested),
        "existing_count": len(current),
        "new_count": len(added),
        "before_count": len(current),
        "after_count": len(merged),
        "ip_ranges": suggested,
        "added_ip_ranges": added,
        "merged_ip_ranges": merged,
    }


def complete_unit_ip_ranges(units: Iterable[Unit], ips_by_unit: dict[str, Iterable[object]]) -> list[dict]:
    unit_list = list(units)
    rows = [merge_unit_ip_ranges(unit, ips_by_unit.get(unit.id, [])) for unit in unit_list]
    for unit, row in zip(unit_list, rows):
        if row["new_count"] > 0:
            unit.ip_ranges = row["merged_ip_ranges"]
    return rows
