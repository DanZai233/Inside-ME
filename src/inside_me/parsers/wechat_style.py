from __future__ import annotations

import re
from datetime import datetime

from inside_me.parsers.base import ParsedMessage


class WeChatStyleParser:
    """
    常见微信 txt 导出形态示例：
    2023-01-01 12:00:00 昵称
    消息内容（可多行，直到下一条时间行）
    """

    platform = "wechat_txt"

    _header = re.compile(
        r"^(\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$"
    )

    def parse(self, content: str) -> list[ParsedMessage]:
        lines = content.splitlines()
        out: list[ParsedMessage] = []
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            m = self._header.match(line)
            if not m:
                i += 1
                continue
            ts_raw, sender = m.group(1), m.group(2).strip()
            ts: datetime | None = None
            for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
                try:
                    ts = datetime.strptime(ts_raw, fmt)
                    break
                except ValueError:
                    continue
            body_lines: list[str] = []
            i += 1
            while i < len(lines):
                nxt = lines[i]
                if self._header.match(nxt.strip()):
                    break
                body_lines.append(nxt)
                i += 1
            text = "\n".join(body_lines).strip()
            if text:
                out.append(ParsedMessage(text=text, sender=sender, ts=ts, platform=self.platform))
        return out
