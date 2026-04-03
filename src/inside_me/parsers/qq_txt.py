from __future__ import annotations

import re
from datetime import datetime

from inside_me.parsers.base import ParsedMessage


class QQTxtParser:
    """
    常见 QQ PC/手机导出 txt：
    - 2023-01-01 12:34:56 昵称(123456789)
    - 2023-01-01 12:34:56 昵称<<邮箱@qq.com>>
    - 昵称(123456789) 2023-01-01 12:34:56
    消息可多行，直到下一条时间行。
    """

    platform = "qq_txt"

    _qq_sender_mark = re.compile(
        r"(?:\(\d{5,}\))|(?:<<[^>\s]+@[^>\s]+>>)|(?:@[\w.-]+\.(?:com|cn|net|org)\b)",
        re.IGNORECASE,
    )

    _dt_first = re.compile(
        r"^(\d{4}-\d{1,2}-\d{1,2})\s+(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$"
    )

    # 发送者在前、日期时间在行尾，避免 `.+?` 在「昵称(qq)」的括号处过早截断
    _sender_first = re.compile(
        r"^(.+)\s+(\d{4}-\d{1,2}-\d{1,2})\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*$"
    )

    def _parse_ts(self, date_part: str, time_part: str) -> datetime | None:
        raw = f"{date_part} {time_part}"
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
            try:
                return datetime.strptime(raw, fmt)
            except ValueError:
                continue
        return None

    def _is_qq_header(self, s: str) -> bool:
        m1 = self._dt_first.match(s)
        if m1 and self._qq_sender_mark.search(m1.group(3)):
            return True
        m2 = self._sender_first.match(s)
        return bool(m2 and self._qq_sender_mark.search(m2.group(1)))

    def parse(self, content: str) -> list[ParsedMessage]:
        lines = content.splitlines()
        out: list[ParsedMessage] = []
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            sender: str | None = None
            ts: datetime | None = None

            m1 = self._dt_first.match(line)
            if m1:
                sender = m1.group(3).strip()
                if not self._qq_sender_mark.search(sender):
                    i += 1
                    continue
                ts = self._parse_ts(m1.group(1), m1.group(2))
            else:
                m2 = self._sender_first.match(line)
                if not m2:
                    i += 1
                    continue
                sender = m2.group(1).strip()
                if not self._qq_sender_mark.search(sender):
                    i += 1
                    continue
                ts = self._parse_ts(m2.group(2), m2.group(3))

            body_lines: list[str] = []
            i += 1
            while i < len(lines):
                nxt = lines[i]
                s = nxt.strip()
                if self._is_qq_header(s):
                    break
                body_lines.append(nxt)
                i += 1

            text = "\n".join(body_lines).strip()
            if text and sender:
                out.append(
                    ParsedMessage(text=text, sender=sender, ts=ts, platform=self.platform)
                )
        return out
