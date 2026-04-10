from __future__ import annotations

from inside_me.sender_aliases import normalize_sender_variants, sender_matches_self


def test_sender_matches_exact_casefold() -> None:
    assert sender_matches_self("Alice", ["alice"])
    assert sender_matches_self("  Bob  ", ["bob"])


def test_sender_matches_qq_style() -> None:
    assert sender_matches_self("小明(123456789)", ["小明"])
    assert sender_matches_self("小明(123456789)", ["小明(123456789)"])


def test_normalize_variants() -> None:
    v = normalize_sender_variants("昵称(888888888)")
    assert "昵称(888888888)" in v
    assert "昵称" in v


def test_empty_alias_no_match() -> None:
    assert not sender_matches_self("anyone", [])


def test_social_stats_marks_self() -> None:
    from inside_me.analysis.social import compute_social_stats

    rows = [
        {"text": "a", "metadata": {"sender": "本人", "ts": "2024-01-01T00:00:00"}},
        {"text": "b", "metadata": {"sender": "他人", "ts": "2024-01-02T00:00:00"}},
    ]
    o = compute_social_stats(rows, self_aliases=["本人"])
    assert o["self_aliases_configured"] is True
    assert o["tagged_self_count"] == 1
    assert o["tagged_other_count"] == 1
    by_name = {x["name"]: x.get("is_self") for x in o["top_senders"]}
    assert by_name.get("本人") is True
    assert by_name.get("他人") is False


def test_adjacent_pairs_involves_self() -> None:
    from inside_me.analysis.social import compute_social_stats

    rows = [
        {"metadata": {"sender": "本人", "ts": "2024-01-01T10:00:00"}},
        {"metadata": {"sender": "他人", "ts": "2024-01-01T10:01:00"}},
    ]
    o = compute_social_stats(rows, self_aliases=["本人"])
    pairs = o["adjacent_pairs"]
    assert len(pairs) == 1
    p = pairs[0]
    assert p["involves_self"] is True
    assert p["a_is_self"] is False
    assert p["b_is_self"] is True
