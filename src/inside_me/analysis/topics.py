from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any

from inside_me.analysis.profile import _tokenize


def compute_keyword_topics(
    rows: list[dict[str, Any]],
    *,
    top_terms: int = 18,
    max_sample: int = 4000,
) -> list[dict[str, Any]]:
    """
    轻量「话题簇」：从样本中抽高频词，再将每条消息归入得分最高的词（关键词共现）。
    非向量聚类，便于本地快速计算、可点击跳转记忆库关键词检索。
    """
    sample = rows[:max_sample]
    term_counter: Counter[str] = Counter()
    for row in sample:
        t = row.get("text") or ""
        term_counter.update(_tokenize(str(t)))

    seeds = [w for w, _ in term_counter.most_common(top_terms) if len(w) >= 2]
    if not seeds:
        return []

    # 每条消息：文本 token 集合
    tok_rows: list[tuple[set[str], dict[str, Any]]] = []
    for row in sample:
        toks = set(_tokenize(str(row.get("text") or "")))
        if not toks:
            continue
        tok_rows.append((toks, row))

    bucket_counts: dict[str, int] = defaultdict(int)
    bucket_samples: dict[str, str] = {}
    for toks, row in tok_rows:
        best: str | None = None
        best_score = 0
        for seed in seeds:
            if seed in toks:
                if best is None or term_counter[seed] > best_score:
                    best = seed
                    best_score = term_counter[seed]
        if best is None:
            continue
        bucket_counts[best] += 1
        mid = row.get("id")
        if best not in bucket_samples and isinstance(mid, str) and mid:
            bucket_samples[best] = mid

    out: list[dict[str, Any]] = []
    for label, cnt in sorted(bucket_counts.items(), key=lambda x: (-x[1], x[0])):
        out.append(
            {
                "label": label,
                "count": cnt,
                "sample_id": bucket_samples.get(label) or "",
            }
        )
    return out
