from __future__ import annotations

import re

# QQ 导出常见：昵称(123456789)
_QQ_TAIL = re.compile(r"^(.+?)\(\d{5,}\)\s*$")
# 尾部 <<email@qq.com>>
_EMAIL_TAIL = re.compile(r"<<[^>]+>>\s*$")


def normalize_sender_variants(sender: str) -> list[str]:
    """为别名匹配生成若干等价串（完整昵称、去 QQ 号括号、去邮箱尾缀等）。"""
    s = (sender or "").strip()
    if not s:
        return []
    out: list[str] = [s]
    m = _QQ_TAIL.match(s)
    if m:
        base = m.group(1).strip()
        if base and base not in out:
            out.append(base)
    s2 = _EMAIL_TAIL.sub("", s).strip()
    if s2 and s2 not in out:
        out.append(s2)
        m2 = _QQ_TAIL.match(s2)
        if m2:
            b2 = m2.group(1).strip()
            if b2 and b2 not in out:
                out.append(b2)
    return out


def sender_matches_self(sender: str, aliases: list[str]) -> bool:
    """sender 是否与任一别名匹配（大小写不敏感；支持 QQ 昵称括号形态）。"""
    af = {a.strip().casefold() for a in aliases if a and str(a).strip()}
    if not af:
        return False
    for cand in normalize_sender_variants(sender):
        if cand.casefold() in af:
            return True
    return False
