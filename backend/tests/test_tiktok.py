"""Run with: cd backend && python -m unittest discover tests"""
import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import main  # noqa: E402

URL = "https://www.tiktok.com/@hotplate_harry/video/7698055729399254294"

SHELL_PAGE = "<html><head><title>TikTok - Make Your Day</title></head><body></body></html>"


def video_page(desc="Sausage ragu bianco: 500 g sausage, 1 onion..."):
    data = {"__DEFAULT_SCOPE__": {"webapp.video-detail": {"itemInfo": {"itemStruct": {
        "desc": desc,
        "video": {"cover": "https://p16.tiktokcdn.com/cover.jpg", "subtitleInfos": []},
    }}}}}
    return ('<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">'
            + json.dumps(data) + "</script></html>")


class FakeSession:
    """Serves the given pages in order and records the user agents used."""

    def __init__(self, pages):
        self.pages = list(pages)
        self.agents = []

    def get(self, url, headers=None, timeout=None):
        self.agents.append((headers or {}).get("User-Agent"))
        page = self.pages.pop(0) if self.pages else SHELL_PAGE
        return mock.Mock(text=page, status_code=200)


class TikTokPageRetryTest(unittest.TestCase):
    def test_returns_caption_from_first_good_page(self):
        sess = FakeSession([video_page()])
        out = main.tiktok_page_extract(URL, session=sess, sleep=lambda s: None)
        self.assertIn("Sausage ragu", out["desc"])
        self.assertEqual(out["thumbnail"], "https://p16.tiktokcdn.com/cover.jpg")
        self.assertEqual(len(sess.agents), 1)

    def test_retries_after_empty_shell_and_switches_user_agent(self):
        sess = FakeSession([SHELL_PAGE, video_page()])
        waits = []
        out = main.tiktok_page_extract(URL, session=sess, sleep=waits.append)
        self.assertIn("Sausage ragu", out["desc"])
        self.assertEqual(len(sess.agents), 2)
        self.assertNotEqual(sess.agents[0], sess.agents[1])
        self.assertEqual(len(waits), 1)

    def test_gives_up_after_max_attempts(self):
        sess = FakeSession([SHELL_PAGE] * 10)
        out = main.tiktok_page_extract(URL, session=sess, sleep=lambda s: None)
        self.assertEqual(out, {"desc": "", "thumbnail": "", "subtitles": ""})
        self.assertEqual(len(sess.agents), main.TIKTOK_PAGE_ATTEMPTS)

    def test_survives_a_network_error(self):
        sess = FakeSession([video_page()])
        real_get = sess.get
        calls = {"n": 0}

        def flaky_get(*a, **kw):
            calls["n"] += 1
            if calls["n"] == 1:
                raise ConnectionError("reset")
            return real_get(*a, **kw)

        sess.get = flaky_get
        out = main.tiktok_page_extract(URL, session=sess, sleep=lambda s: None)
        self.assertIn("Sausage ragu", out["desc"])


class TikTokEmptyDetectionTest(unittest.TestCase):
    def test_placeholder_page_counts_as_empty(self):
        self.assertTrue(main.tiktok_served_empty("Title: TikTok - Make Your Day\nDescription: "))
        self.assertTrue(main.tiktok_served_empty(""))
        self.assertTrue(main.tiktok_served_empty("Title: TikTok video\nDescription: "))

    def test_real_caption_is_not_empty(self):
        text = "Title: Sausage ragu\nDescription: 500 g sausage, 1 onion, 200 ml cream, rigatoni"
        self.assertFalse(main.tiktok_served_empty(text))

    def test_is_tiktok(self):
        self.assertTrue(main._is_tiktok(URL))
        self.assertTrue(main._is_tiktok("https://vm.tiktok.com/ZMabc/"))
        self.assertFalse(main._is_tiktok("https://nottiktok.com/x"))
        self.assertFalse(main._is_tiktok("https://www.instagram.com/reel/abc/"))


class TikTokOEmbedRetryTest(unittest.TestCase):
    def test_retries_once_then_returns_data(self):
        bad = mock.Mock(status_code=503)
        good = mock.Mock(status_code=200)
        good.json.return_value = {"title": "Ragu caption"}
        with mock.patch.object(main.requests, "get", side_effect=[bad, good]) as get:
            self.assertEqual(main.tiktok_oembed(URL, sleep=lambda s: None)["title"], "Ragu caption")
            self.assertEqual(get.call_count, 2)

    def test_returns_empty_dict_when_both_fail(self):
        with mock.patch.object(main.requests, "get", side_effect=ConnectionError("x")):
            self.assertEqual(main.tiktok_oembed(URL, sleep=lambda s: None), {})


def embed_page(covers):
    state = {"source": {"data": {"/embed/v2/1": {"videoData": {
        "itemInfos": {"covers": covers},
        "authorInfos": {"covers": ["https://p16.tiktokcdn.com/avatar.jpg"]}}}}}}
    return ('<html><script id="__FRONTITY_CONNECT_STATE__" type="application/json">'
            + json.dumps(state) + "</script></html>")


class TikTokThumbnailTest(unittest.TestCase):
    def test_embed_cover_is_the_video_cover_not_the_avatar(self):
        self.assertEqual(main.tiktok_embed_cover(embed_page(["https://p16.tiktokcdn.com/cover.jpg"])),
                         "https://p16.tiktokcdn.com/cover.jpg")
        self.assertIsNone(main.tiktok_embed_cover(embed_page([])))
        self.assertIsNone(main.tiktok_embed_cover("<html>nothing</html>"))

    def test_oembed_without_thumbnail_falls_back_to_embed_page(self):
        oembed = mock.Mock(status_code=200)
        oembed.json.return_value = {"type": "video", "html": "<iframe>"}
        embed = mock.Mock(status_code=200, text=embed_page(["https://p16.tiktokcdn.com/cover.jpg"]))
        with mock.patch.object(main.requests, "get", side_effect=[oembed, embed]) as get:
            self.assertEqual(main.resolve_tiktok_thumbnail("7698055729399254294"),
                             "https://p16.tiktokcdn.com/cover.jpg")
        self.assertIn("/embed/v2/7698055729399254294", get.call_args[0][0])

    def test_oembed_thumbnail_still_used_when_present(self):
        oembed = mock.Mock(status_code=200)
        oembed.json.return_value = {"thumbnail_url": "https://p16.tiktokcdn.com/o.jpg"}
        with mock.patch.object(main.requests, "get", return_value=oembed) as get:
            self.assertEqual(main.resolve_tiktok_thumbnail("1"), "https://p16.tiktokcdn.com/o.jpg")
        self.assertEqual(get.call_count, 1)


if __name__ == "__main__":
    unittest.main()
