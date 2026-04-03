from __future__ import annotations

import unittest

from inside_me.parsers.qq_txt import QQTxtParser


class TestQQTxtParser(unittest.TestCase):
    def test_qq_dt_first_with_qq_number(self) -> None:
        raw = """2023-01-01 12:00:00 张三(123456789)
你好

2023-01-01 12:01:00 李四(987654321)
收到"""
        msgs = QQTxtParser().parse(raw)
        self.assertEqual(len(msgs), 2)
        self.assertEqual(msgs[0].sender, "张三(123456789)")
        self.assertEqual(msgs[0].text, "你好")
        self.assertEqual(msgs[0].platform, "qq_txt")
        self.assertEqual(msgs[1].text, "收到")

    def test_qq_sender_first_line(self) -> None:
        raw = """张三(123456789) 2023-02-01 8:30:00
早"""
        msgs = QQTxtParser().parse(raw)
        self.assertEqual(len(msgs), 1)
        self.assertEqual(msgs[0].sender, "张三(123456789)")
        self.assertEqual(msgs[0].text, "早")

    def test_body_line_with_date_not_split_header(self) -> None:
        raw = """2023-01-01 12:00:00 张三(123456789)
会议定在 2023-06-01 10:00:00 开始

2023-01-01 13:00:00 张三(123456789)
好"""
        msgs = QQTxtParser().parse(raw)
        self.assertEqual(len(msgs), 2)
        self.assertIn("2023-06-01", msgs[0].text)
        self.assertEqual(msgs[1].text, "好")

    def test_plain_wechat_style_no_qq_mark_returns_empty(self) -> None:
        raw = """2023-01-01 12:00:00 张三
仅昵称无 QQ 标记"""
        self.assertEqual(QQTxtParser().parse(raw), [])


if __name__ == "__main__":
    unittest.main()
