from __future__ import annotations

import unittest

from inside_me.analysis.social import compute_social_stats


class TestSocialStats(unittest.TestCase):
    def test_senders_and_adjacent_pairs(self) -> None:
        rows = [
            {"metadata": {"sender": "甲", "ts": "2024-01-01 10:00:00"}},
            {"metadata": {"sender": "乙", "ts": "2024-01-01 10:01:00"}},
            {"metadata": {"sender": "甲", "ts": "2024-01-01 10:02:00"}},
        ]
        out = compute_social_stats(rows, max_rows=8000)
        self.assertEqual(out["sample_size"], 3)
        names = {x["name"]: x["count"] for x in out["top_senders"]}
        self.assertEqual(names.get("甲"), 2)
        self.assertEqual(names.get("乙"), 1)
        pairs = {(p["a"], p["b"]): p["count"] for p in out["adjacent_pairs"]}
        # 甲→乙 与 乙→甲 合并为同一条无向边（字典序规范化），计数 2
        self.assertEqual(pairs.get(("乙", "甲")), 2)

    def test_empty(self) -> None:
        out = compute_social_stats([], max_rows=100)
        self.assertEqual(out["sample_size"], 0)
        self.assertEqual(out["top_senders"], [])
        self.assertEqual(out["adjacent_pairs"], [])


if __name__ == "__main__":
    unittest.main()
