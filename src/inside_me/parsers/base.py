from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol


@dataclass
class ParsedMessage:
    text: str
    sender: str | None
    ts: datetime | None
    platform: str
    """群名 / Discord 频道等，便于仪表盘与 RAG 按会话切片；无则空。"""
    thread: str | None = None


class ChatParser(Protocol):
    platform: str

    def parse(self, content: str) -> list[ParsedMessage]: ...
