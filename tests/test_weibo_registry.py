from __future__ import annotations

import unittest
from pathlib import Path

from inside_me.parsers.registry import parse_chat_file


class TestWeiboRegistry(unittest.TestCase):
    def test_prefers_weibo_over_generic_when_multiple_headers(self) -> None:
        raw = """2023-01-01 12:00:00
第一行正文
第二行正文

2023-01-02 12:00:00
只有一行
"""
        msgs, plat = parse_chat_file(Path("x.txt"), raw)
        self.assertEqual(plat, "weibo_txt")
        self.assertEqual(len(msgs), 2)
        self.assertIn("第一行正文", msgs[0].text)

    def test_single_weibo_block_can_stay_generic(self) -> None:
        raw = """2023-01-01 12:00:00
a
b
"""
        msgs, plat = parse_chat_file(Path("y.txt"), raw)
        self.assertEqual(plat, "generic")


if __name__ == "__main__":
    unittest.main()
