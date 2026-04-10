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
