from __future__ import annotations

import re
from datetime import datetime

from inside_me.parsers.base import ParsedMessage


class GenericLineParser:
    """每行一条消息；可选前缀 `发送者:` 或 `[时间]`."""

    platform = "generic"

    _ts_bracket = re.compile(r"^\[(\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?)\]\s*")
    _sender_prefix = re.compile(r"^([^:：]{1,32})[:：]\s*(.+)$", re.DOTALL)

    def parse(self, content: str) -> list[ParsedMessage]:
        out: list[ParsedMessage] = []
        for line in content.splitlines():
            line = line.strip()
            if not line:
                continue
            ts: datetime | None = None
            m_ts = self._ts_bracket.match(line)
            if m_ts:
                raw = m_ts.group(1).replace("/", "-")
                for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S"):
                    try:
                        ts = datetime.strptime(raw, fmt)
                        break
                    except ValueError:
                        continue
                line = line[m_ts.end() :].strip()
            sender: str | None = None
            m_s = self._sender_prefix.match(line)
            if m_s:
                sender = m_s.group(1).strip()
                line = m_s.group(2).strip()
            out.append(ParsedMessage(text=line, sender=sender, ts=ts, platform=self.platform))
        return out
