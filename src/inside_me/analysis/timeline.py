from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any, Literal

from dateutil import parser as date_parser

Granularity = Literal["day", "week"]


def _row_dt(meta: dict[str, Any]) -> datetime | None:
    ts = str(meta.get("ts") or "").strip()
    if not ts:
        return None
    try:
        return date_parser.parse(ts)
    except (ValueError, TypeError, OverflowError):
        return None


def _week_key(dt: datetime) -> str:
    """ISO 周：YYYY-Www。"""
    iso = dt.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def compute_timeline(
    rows: list[dict[str, Any]],
    *,
    granularity: Granularity = "day",
    max_buckets: int = 120,
) -> list[dict[str, Any]]:
    """按日或周聚合有有效 ts 的消息条数。"""
    counts: dict[str, int] = defaultdict(int)
    for row in rows:
        meta = row.get("metadata") or {}
        if not isinstance(meta, dict):
            continue
        dt = _row_dt(meta)
        if dt is None:
            continue
        if granularity == "day":
            k = dt.date().isoformat()
        else:
            k = _week_key(dt)
        counts[k] += 1

    keys = sorted(counts.keys())
    if len(keys) > max_buckets:
        keys = keys[-max_buckets:]
    return [{"period": k, "count": counts[k]} for k in keys]
