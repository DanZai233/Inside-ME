from __future__ import annotations

from collections import Counter
from datetime import datetime
from typing import Any

from inside_me.sender_aliases import sender_matches_self


def _parse_ts(meta: dict[str, Any]) -> datetime | None:
    raw = str((meta or {}).get("ts") or "").strip()
    if not raw:
        return None
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    return None


def _norm_pair(a: str, b: str) -> tuple[str, str]:
    return (a, b) if a <= b else (b, a)


def _sender_label_is_self(name: str, aliases: list[str]) -> bool:
    if not aliases or name == "（未标注发送者）":
        return False
    return sender_matches_self(name, aliases)


def compute_social_stats(
    rows: list[dict[str, Any]],
    *,
    max_rows: int = 8000,
    self_aliases: list[str] | None = None,
) -> dict[str, Any]:
    """
    基于消息元数据中的 sender、ts：
    - top_senders：发送者出现条数（可带 is_self，依据 self_sender_aliases）
    - adjacent_pairs：按时间排序后，相邻两条且发送者不同则计一次无向边（粗略反映对话来回）
    """
    aliases = [a.strip() for a in (self_aliases or []) if a.strip()]
    slice_rows = rows[:max_rows]
    ordered = sorted(
        enumerate(slice_rows),
        key=lambda iv: (_parse_ts((iv[1].get("metadata") or {})) or datetime.max, iv[0]),
    )

    sender_counts: Counter[str] = Counter()
    pair_counts: Counter[tuple[str, str]] = Counter()
    tagged_self = 0
    tagged_other = 0
    untagged_sender = 0

    prev_sender: str | None = None
    for _, row in ordered:
        meta = row.get("metadata") or {}
        raw = str(meta.get("sender") or "").strip()
        if not raw:
            untagged_sender += 1
        elif aliases and sender_matches_self(raw, aliases):
            tagged_self += 1
        elif raw:
            tagged_other += 1
        s = raw or "（未标注发送者）"
        sender_counts[s] += 1
        if prev_sender is not None and prev_sender != s:
            x, y = _norm_pair(prev_sender, s)
            pair_counts[(x, y)] += 1
        prev_sender = s

    top_senders: list[dict[str, Any]] = []
    for n, c in sender_counts.most_common(25):
        row: dict[str, Any] = {"name": n, "count": c}
        if aliases and n != "（未标注发送者）":
            row["is_self"] = sender_matches_self(n, aliases)
        else:
            row["is_self"] = False
        top_senders.append(row)
    top_pairs: list[dict[str, Any]] = []
    for (a, b), c in pair_counts.most_common(30):
        if a == b:
            continue
        prow: dict[str, Any] = {"a": a, "b": b, "count": c}
        if aliases:
            a_self = _sender_label_is_self(a, aliases)
            b_self = _sender_label_is_self(b, aliases)
            prow["a_is_self"] = a_self
            prow["b_is_self"] = b_self
            prow["involves_self"] = a_self or b_self
        top_pairs.append(prow)

    out: dict[str, Any] = {
        "sample_size": len(slice_rows),
        "top_senders": top_senders,
        "adjacent_pairs": top_pairs,
        "self_aliases_configured": bool(aliases),
    }
    if aliases:
        out["tagged_self_count"] = tagged_self
        out["tagged_other_count"] = tagged_other
        out["untagged_sender_count"] = untagged_sender
    return out
