from __future__ import annotations

from pathlib import Path

from inside_me.parsers.base import ParsedMessage
from inside_me.parsers.generic import GenericLineParser
from inside_me.parsers.qq_txt import QQTxtParser
from inside_me.parsers.wechat_style import WeChatStyleParser
from inside_me.parsers.weibo_style import WeiboStyleParser

_PARSERS = [QQTxtParser(), WeChatStyleParser(), WeiboStyleParser(), GenericLineParser()]


def _weibo_only_header_lines(content: str) -> int:
    return sum(
        1 for line in content.splitlines() if WeiboStyleParser._header.match(line.strip())
    )


def parse_chat_file(path: Path, content: str | None = None) -> tuple[list[ParsedMessage], str]:
    raw = content if content is not None else path.read_text(encoding="utf-8", errors="replace")
    best: list[ParsedMessage] = []
    best_platform = "generic"
    by_platform: dict[str, list[ParsedMessage]] = {}
    for p in _PARSERS:
        msgs = p.parse(raw)
        by_platform[p.platform] = msgs
        if len(msgs) > len(best):
            best = msgs
            best_platform = p.platform

    # 微博多行块会被 generic 拆成更多「单行消息」而误胜；若存在多条「仅时间」头行，则优先微博解析结果。
    if best_platform == "generic":
        wb = by_platform.get("weibo_txt") or []
        if len(wb) > 0 and _weibo_only_header_lines(raw) >= 2:
            best = wb
            best_platform = "weibo_txt"

    return best, best_platform
