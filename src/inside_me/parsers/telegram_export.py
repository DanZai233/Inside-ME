"""Telegram Desktop / JSON 导出：messages 数组或 result.messages。"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from inside_me.parsers.base import ChatParser, ParsedMessage


def _parse_ts(v: Any) -> datetime | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(float(v), tz=timezone.utc)
    s = str(v).strip()
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def _text_from_msg(obj: dict[str, Any]) -> str:
    t = obj.get("text")
    if isinstance(t, str):
        return t.strip()
    if isinstance(t, list):
        parts: list[str] = []
        for x in t:
            if isinstance(x, str):
                parts.append(x)
            elif isinstance(x, dict) and isinstance(x.get("text"), str):
                parts.append(x["text"])
        return "".join(parts).strip()
    return ""


class TelegramExportParser(ChatParser):
    platform = "telegram_json"

    def parse(self, content: str) -> list[ParsedMessage]:
        raw = content.strip()
        if not raw.startswith(("[", "{")):
            return []
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return []
        rows: list[dict[str, Any]] = []
        if isinstance(data, list):
            rows = [x for x in data if isinstance(x, dict)]
        elif isinstance(data, dict):
            if isinstance(data.get("messages"), list):
                rows = [x for x in data["messages"] if isinstance(x, dict)]
            elif isinstance(data.get("result"), dict) and isinstance(data["result"].get("messages"), list):
                rows = [x for x in data["result"]["messages"] if isinstance(x, dict)]
        out: list[ParsedMessage] = []
        for m in rows:
            text = _text_from_msg(m)
            if not text:
                continue
            sender = ""
            if isinstance(m.get("from"), str):
                sender = m["from"]
            elif isinstance(m.get("from"), dict):
                sender = str(m["from"].get("first_name") or m["from"].get("username") or "")
            ts = _parse_ts(m.get("date") or m.get("date_unixtime"))
            out.append(ParsedMessage(text=text, sender=sender or None, ts=ts, platform=self.platform))
        return out
