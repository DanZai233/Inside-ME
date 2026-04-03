from __future__ import annotations

import unittest

from inside_me.embedding_http import _extract_first_embedding


class TestExtractEmbedding(unittest.TestCase):
    def test_openai_list_shape(self) -> None:
        data = {"data": [{"index": 0, "embedding": [0.1, 0.2, -0.3]}]}
        self.assertEqual(_extract_first_embedding(data), [0.1, 0.2, -0.3])

    def test_ark_multimodal_dict_shape(self) -> None:
        data = {"created": 1, "data": {"embedding": [0.5, -0.25]}}
        self.assertEqual(_extract_first_embedding(data), [0.5, -0.25])

    def test_top_level_embedding(self) -> None:
        data = {"embedding": [1.0, 2.0]}
        self.assertEqual(_extract_first_embedding(data), [1.0, 2.0])


if __name__ == "__main__":
    unittest.main()
