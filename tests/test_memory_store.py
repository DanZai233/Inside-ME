from __future__ import annotations

import re

from inside_me.api.schemas import UserSettings
from inside_me.config import Settings
from inside_me.store import MessageStore, _where_document_ci_substring


def test_where_document_ci_substring_escapes_regex() -> None:
    d = _where_document_ci_substring("a+b.c")
    assert d is not None
    pat = d["$regex"]
    assert pat.startswith("(?i)")
    assert re.search(pat, "prefix A+B.C suffix") is not None


def test_browse_memory_case_insensitive(tmp_path) -> None:
    s = Settings(data_dir=tmp_path)
    store = MessageStore(s, UserSettings())
    store.add_messages(
        ["Hello WORLD wide"],
        [{"sender": "u", "platform": "qq_txt", "ts": "2020-01-01"}],
        source="t",
    )
    low, m1 = store.browse_memory(limit=10, q="world")
    assert len(low) == 1
    assert m1.get("total_matching") is None
    up, m2 = store.browse_memory(limit=10, q="WORLD")
    assert len(up) == 1


def test_browse_memory_sender_self_only(tmp_path) -> None:
    s = Settings(data_dir=tmp_path)
    store = MessageStore(s, UserSettings())
    store.add_messages(
        ["mine", "theirs"],
        [
            {"sender": "我", "platform": "p", "ts": "2024-01-02T12:00:00"},
            {"sender": "对方", "platform": "p", "ts": "2024-01-01T12:00:00"},
        ],
        "t",
    )
    page, meta = store.browse_memory(
        limit=10,
        offset=0,
        sender_mode="self_only",
        self_aliases=["我"],
    )
    assert len(page) == 1
    assert page[0]["document"] == "mine"
    assert meta.get("total_matching") == 1


def test_browse_memory_ts_range(tmp_path) -> None:
    s = Settings(data_dir=tmp_path)
    store = MessageStore(s, UserSettings())
    store.add_messages(
        ["early", "late"],
        [
            {"sender": "", "platform": "p", "ts": "2024-01-15T12:00:00"},
            {"sender": "", "platform": "p", "ts": "2024-06-01T12:00:00"},
        ],
        "t",
    )
    page, meta = store.browse_memory(limit=10, ts_from="2024-01-01", ts_to="2024-03-01")
    assert len(page) == 1
    assert page[0]["document"] == "early"
    assert meta.get("total_matching") == 1


def test_query_respects_platform(tmp_path) -> None:
    s = Settings(data_dir=tmp_path)
    store = MessageStore(s, UserSettings())
    store.add_messages(
        ["only on wx unique phrase xyz123"],
        [{"sender": "a", "platform": "wx_style", "ts": "2024-01-01T12:00:00"}],
        "t",
    )
    store.add_messages(
        ["qq different content abc999"],
        [{"sender": "b", "platform": "qq_txt", "ts": "2024-01-01T12:00:00"}],
        "t",
    )
    hits_all = store.query("unique phrase xyz123", n=5)
    assert len(hits_all) >= 1
    hits_wx = store.query("unique phrase xyz123", n=5, platform="wx_style")
    assert len(hits_wx) >= 1
    assert "xyz123" in (hits_wx[0].get("document") or "")
    assert (hits_wx[0].get("metadata") or {}).get("platform") == "wx_style"
    hits_qq = store.query("unique phrase xyz123", n=5, platform="qq_txt")
    for h in hits_qq:
        assert (h.get("metadata") or {}).get("platform") == "qq_txt"


def test_query_respects_ts_range(tmp_path) -> None:
    s = Settings(data_dir=tmp_path)
    store = MessageStore(s, UserSettings())
    store.add_messages(
        ["summer mood keyword qqqZZZ"],
        [{"sender": "", "platform": "p", "ts": "2024-07-01T12:00:00"}],
        "t",
    )
    store.add_messages(
        ["winter mood keyword qqqZZZ"],
        [{"sender": "", "platform": "p", "ts": "2024-01-15T12:00:00"}],
        "t",
    )
    h = store.query("qqqZZZ", n=8, ts_from="2024-01-01", ts_to="2024-03-01")
    assert len(h) == 1
    assert "winter" in (h[0].get("document") or "")


def test_update_message_text_and_meta(tmp_path) -> None:
    s = Settings(data_dir=tmp_path)
    store = MessageStore(s, UserSettings())
    store.add_messages(
        ["original"],
        [{"sender": "a", "platform": "p1", "ts": "t1"}],
        source="src",
    )
    rows, _ = store.browse_memory(limit=1)
    mid = rows[0]["id"]
    assert store.update_message(mid, document="patched", sender="b", platform="p2", ts="t2")
    rows2, _ = store.browse_memory(limit=1)
    row = rows2[0]
    assert row["document"] == "patched"
    assert row["metadata"]["sender"] == "b"
    assert row["metadata"]["platform"] == "p2"
    assert row["metadata"]["ts"] == "t2"
    assert len(row["metadata"].get("content_sha256", "")) == 64
