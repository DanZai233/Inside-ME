from __future__ import annotations

import unittest

from inside_me.openai_compat import (
    ark_multimodal_embeddings_url,
    openai_compatible_chat_completions_url,
    openai_compatible_embeddings_url,
)


class TestOpenAICompat(unittest.TestCase):
    def test_openai_default(self) -> None:
        b = "https://api.openai.com"
        self.assertEqual(
            openai_compatible_chat_completions_url(b),
            "https://api.openai.com/v1/chat/completions",
        )
        self.assertEqual(
            openai_compatible_embeddings_url(b),
            "https://api.openai.com/v1/embeddings",
        )

    def test_volcengine_ark_v3(self) -> None:
        b = "https://ark.cn-beijing.volces.com/api/v3"
        self.assertEqual(
            openai_compatible_chat_completions_url(b),
            "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
        )
        self.assertEqual(
            openai_compatible_embeddings_url(b),
            "https://ark.cn-beijing.volces.com/api/v3/embeddings",
        )
        self.assertEqual(
            ark_multimodal_embeddings_url(b),
            "https://ark.cn-beijing.volces.com/api/v3/embeddings/multimodal",
        )


if __name__ == "__main__":
    unittest.main()
