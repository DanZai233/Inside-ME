from __future__ import annotations

from inside_me.analysis.filters import filter_message_rows
from inside_me.analysis.timeline import compute_timeline
from inside_me.analysis.topics import compute_keyword_topics


def test_filter_message_rows_platform() -> None:
    rows = [
        {"id": "1", "text": "a", "metadata": {"platform": "qq_txt", "sender": "x", "ts": "2024-01-01T10:00:00"}},
        {"id": "2", "text": "b", "metadata": {"platform": "wechat_txt", "sender": "y", "ts": "2024-01-02T10:00:00"}},
    ]
    out = filter_message_rows(rows, platform="qq_txt")
    assert len(out) == 1
    assert out[0]["id"] == "1"


def test_filter_message_rows_thread() -> None:
    rows = [
        {"text": "a", "metadata": {"platform": "discord_csv", "thread": "general", "ts": "2024-01-01T10:00:00"}},
        {"text": "b", "metadata": {"platform": "discord_csv", "thread": "random", "ts": "2024-01-02T10:00:00"}},
    ]
    out = filter_message_rows(rows, thread="general")
    assert len(out) == 1


def test_timeline_day() -> None:
    rows = [
        {"text": "a", "metadata": {"ts": "2024-06-01T12:00:00"}},
        {"text": "b", "metadata": {"ts": "2024-06-01T13:00:00"}},
        {"text": "c", "metadata": {"ts": "2024-06-02T10:00:00"}},
    ]
    tl = compute_timeline(rows, granularity="day")
    by = {x["period"]: x["count"] for x in tl}
    assert by.get("2024-06-01") == 2
    assert by.get("2024-06-02") == 1


def test_keyword_topics_nonempty() -> None:
    rows = [
        {"id": "x1", "text": "programming design ideas here", "metadata": {"ts": "2024-01-01T10:00:00"}},
        {"id": "x2", "text": "programming relax time now", "metadata": {"ts": "2024-01-02T10:00:00"}},
    ]
    topics = compute_keyword_topics(rows, top_terms=10, max_sample=100)
    labels = {t["label"] for t in topics}
    assert "programming" in labels
