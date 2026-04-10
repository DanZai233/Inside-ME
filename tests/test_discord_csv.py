from __future__ import annotations

import unittest

from inside_me.parsers.discord_csv import DiscordCsvParser


class TestDiscordCsvParser(unittest.TestCase):
    def test_iso_and_flexible_date(self) -> None:
        raw = """Author,Date,Content
Alice,2024-03-15T14:30:00+00:00,hello iso
Bob,"Mar 16, 2024 8:05 PM",flex date
"""
        msgs = DiscordCsvParser().parse(raw)
        self.assertEqual(len(msgs), 2)
        self.assertEqual(msgs[0].sender, "Alice")
        self.assertEqual(msgs[0].text, "hello iso")
        self.assertIsNotNone(msgs[0].ts)
        self.assertEqual(msgs[1].sender, "Bob")
        self.assertEqual(msgs[1].text, "flex date")
        self.assertIsNotNone(msgs[1].ts)


if __name__ == "__main__":
    unittest.main()
