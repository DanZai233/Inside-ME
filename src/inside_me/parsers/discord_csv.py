"""DiscordChatExporter 等 CSV：Author, Date, Content 或 author,content 列。"""

from __future__ import annotations

import csv
import io
from datetime import datetime

from dateutil import parser as date_parser

from inside_me.parsers.base import ChatParser, ParsedMessage


class DiscordCsvParser(ChatParser):
    platform = "discord_csv"

    def parse(self, content: str) -> list[ParsedMessage]:
        if not content.strip() or content.count("\n") < 1:
            return []
        sample = content[:4096].lower()
        if "author" not in sample and "content" not in sample:
            return []
        try:
            reader = csv.DictReader(io.StringIO(content))
        except Exception:
            return []
        if not reader.fieldnames:
            return []
        # map common headers
        def col(row: dict[str, str], *names: str) -> str:
            for n in names:
                for k, v in row.items():
                    if k and k.strip().lower() == n:
                        return (v or "").strip()
            return ""

        out: list[ParsedMessage] = []
        for row in reader:
            if not isinstance(row, dict):
                continue
            text = col(row, "content", "message", "body", "text")
            if not text:
                continue
            author = col(row, "author", "username", "name", "sender")
            ts_raw = col(row, "date", "timestamp", "time", "datetime")
            ts: datetime | None = None
            if ts_raw:
                raw = ts_raw.strip()
                try:
                    ts = datetime.fromisoformat(raw.replace("Z", "+00:00"))
                except ValueError:
                    try:
                        ts = date_parser.parse(raw)
                    except (ValueError, TypeError, OverflowError):
                        ts = None
            out.append(
                ParsedMessage(text=text, sender=author or None, ts=ts, platform=self.platform)
            )
        return out if len(out) >= 1 else []
