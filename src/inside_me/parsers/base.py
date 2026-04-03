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


class ChatParser(Protocol):
    platform: str

    def parse(self, content: str) -> list[ParsedMessage]: ...
