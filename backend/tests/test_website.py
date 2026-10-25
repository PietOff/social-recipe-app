"""Run with: cd backend && python -m unittest discover tests"""
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import website  # noqa: E402

GRAPH_PAGE = """
<html><head>
<meta property="og:image" content="https://cdn.example.com/og.jpg">
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
  {"@type":"WebPage","name":"Page"},
  {"@type":["Recipe","NewsArticle"],"name":"Stamppot boerenkool &amp; worst",
   "description":"<p>Winters</p>",
   "recipeYield":["4","4 personen"],
   "prepTime":"PT15M","cookTime":"PT1H5M",
   "image":{"@type":"ImageObject","url":"/img/stamppot.jpg"},
   "recipeIngredient":["1 kg kruimige aardappelen","500 g boerenkool","1 rookworst"],
   "recipeInstructions":[
     {"@type":"HowToSection","name":"Stamppot","itemListElement":[
       {"@type":"HowToStep","text":"Kook de aardappelen."},
       {"@type":"HowToStep","text":"Stamp met de boerenkool."}]},
     {"@type":"HowToStep","text":"Serveer met de worst."}]}
]}
</script></head><body><p>Hallo</p></body></html>
"""


class JsonLdTests(unittest.TestCase):
    def test_finds_recipe_in_graph_with_type_list(self):
        recipe = website.find_recipe_jsonld(GRAPH_PAGE)
        self.assertIsNotNone(recipe)
        text = website.recipe_jsonld_to_text(recipe)
        self.assertIn("Title: Stamppot boerenkool & worst", text)
        self.assertIn("Servings: 4 personen", text)
        self.assertIn("Prep time: 15 min", text)
        self.assertIn("Cook time: 1 h 5 min", text)
        self.assertIn("- 500 g boerenkool", text)
        self.assertIn("1. [Stamppot]", text)
        self.assertIn("3. Stamp met de boerenkool.", text)
        self.assertIn("4. Serveer met de worst.", text)
        self.assertIn("Description: Winters", text)

    def test_string_instructions_and_bad_json_blocks(self):
        page = """
        <script type="application/ld+json">{ not json </script>
        <script type='application/ld+json'>[{"@type":"Recipe","name":"Pannenkoeken",
          "recipeIngredient":"250 g bloem",
          "recipeInstructions":"Meng alles.<br>Bak ze goudbruin.\\nEet smakelijk."}]</script>"""
        recipe = website.find_recipe_jsonld(page)
        text = website.recipe_jsonld_to_text(recipe)
        self.assertIn("- 250 g bloem", text)
        self.assertIn("2. Bak ze goudbruin.", text)
        self.assertIn("3. Eet smakelijk.", text)

    def test_durations(self):
        self.assertEqual(website.iso_duration_to_text("PT90M"), "1 h 30 min")
        self.assertEqual(website.iso_duration_to_text("PT2H"), "2 h")
        self.assertEqual(website.iso_duration_to_text("P0DT0H20M"), "20 min")
        self.assertEqual(website.iso_duration_to_text("20 minuten"), "20 minuten")
        self.assertEqual(website.iso_duration_to_text("PT0S"), "")


class UrlSafetyTests(unittest.TestCase):
    def test_shape(self):
        self.assertTrue(website.is_web_url("https://www.ah.nl/allerhande/recept/R-R123/stamppot"))
        self.assertTrue(website.is_web_url("http://example.com/recipe"))
        for bad in ("ftp://example.com/x", "https://localhost/x", "http://127.0.0.1/x",
                    "http://169.254.169.254/latest/meta-data", "http://10.0.0.1/", "https://intranet/x",
                    "https://example.com:8443/x", "https://user:pw@example.com/", "javascript:alert(1)",
                    "http://[::1]/", "https://printer.local/"):
            self.assertFalse(website.is_web_url(bad), bad)

    def test_dns_must_resolve_public(self):
        with mock.patch("socket.getaddrinfo", return_value=[(0, 0, 0, "", ("10.1.2.3", 0))]):
            with self.assertRaises(website.WebsiteError):
                website.assert_public_url("https://evil.example.com/")
        with mock.patch("socket.getaddrinfo", return_value=[(0, 0, 0, "", ("93.184.216.34", 0))]):
            website.assert_public_url("https://example.com/")

    def test_canonical(self):
        self.assertEqual(
            website.canonicalize_web_url("https://WWW.Example.com/r/1?utm_source=x&id=5&fbclid=y#comments"),
            "https://www.example.com/r/1?id=5")


class FakeResponse:
    def __init__(self, status, headers=None, body=b""):
        self.status_code = status
        self.headers = headers or {}
        self.body = body
        self.encoding = "utf-8"

    def iter_content(self, chunk_size=1):
        yield self.body

    def close(self):
        pass


class FetchTests(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch("socket.getaddrinfo", side_effect=self.resolve)
        patcher.start()
        self.addCleanup(patcher.stop)
        reader = mock.patch.object(website, "fetch_via_reader", return_value=None)
        self.reader = reader.start()
        self.addCleanup(reader.stop)

    @staticmethod
    def resolve(host, *_):
        ip = "10.0.0.5" if host == "internal.example.com" else "93.184.216.34"
        return [(0, 0, 0, "", (ip, 0))]

    def test_redirect_to_private_host_is_refused(self):
        session = mock.Mock()
        session.get.return_value = FakeResponse(302, {"Location": "https://internal.example.com/admin"})
        with self.assertRaises(website.WebsiteError):
            website.fetch_page("https://example.com/r", session)
        self.assertEqual(session.get.call_count, 1)

    def test_extracts_structured_recipe_after_redirect(self):
        session = mock.Mock()
        session.get.side_effect = [
            FakeResponse(301, {"Location": "/recepten/stamppot"}),
            FakeResponse(200, {"Content-Type": "text/html; charset=utf-8"}, GRAPH_PAGE.encode()),
        ]
        page = website.extract_website("https://example.com/r", session)
        self.assertTrue(page["structured"])
        self.assertEqual(page["final_url"], "https://example.com/recepten/stamppot")
        self.assertEqual(page["image"], "https://example.com/img/stamppot.jpg")

    def test_falls_back_to_page_text(self):
        body = ("<html><head><title>Oma's appeltaart</title><script>var x=1</script></head><body>"
                "<nav>Menu Home</nav><article><h1>Appeltaart</h1><ul><li>200 g boter</li></ul>"
                "<p>" + "Bak de taart in de oven. " * 30 + "</p></article><footer>Cookies</footer></body></html>")
        session = mock.Mock()
        session.get.return_value = FakeResponse(200, {"Content-Type": "text/html"}, body.encode())
        page = website.extract_website("https://example.com/taart", session)
        self.assertFalse(page["structured"])
        self.assertIn("Title: Oma's appeltaart", page["raw_text"])
        self.assertIn("200 g boter", page["raw_text"])
        self.assertNotIn("var x", page["raw_text"])
        self.assertNotIn("Menu Home", page["raw_text"])
        self.assertNotIn("Cookies", page["raw_text"])

    def test_blocked_and_non_html(self):
        session = mock.Mock()
        session.get.return_value = FakeResponse(403)
        with self.assertRaisesRegex(website.WebsiteError, "blocks"):
            website.fetch_page("https://example.com/r", session)
        session.get.return_value = FakeResponse(200, {"Content-Type": "application/pdf"})
        with self.assertRaisesRegex(website.WebsiteError, "not a web page"):
            website.fetch_page("https://example.com/r.pdf", session)

    def test_structured_direct_fetch_does_not_use_reader(self):
        session = mock.Mock()
        session.get.return_value = FakeResponse(200, {"Content-Type": "text/html"}, GRAPH_PAGE.encode())
        website.extract_website("https://example.com/r", session)
        self.reader.assert_not_called()

    def test_stripped_page_uses_reader_copy_with_recipe(self):
        session = mock.Mock()
        session.get.return_value = FakeResponse(
            200, {"Content-Type": "text/html"}, b"<html><title>Just a moment...</title></html>")
        self.reader.return_value = GRAPH_PAGE
        page = website.extract_website("https://example.com/r", session)
        self.assertTrue(page["structured"])
        self.assertIn("500 g boerenkool", page["raw_text"])
        self.reader.assert_called_once_with("https://example.com/r")

    def test_reader_without_recipe_keeps_direct_page_text(self):
        body = "<html><title>Appeltaart</title><body><p>200 g boter</p></body></html>"
        session = mock.Mock()
        session.get.return_value = FakeResponse(200, {"Content-Type": "text/html"}, body.encode())
        self.reader.return_value = "<html><title>Other</title><body>nothing</body></html>"
        page = website.extract_website("https://example.com/r", session)
        self.assertFalse(page["structured"])
        self.assertIn("200 g boter", page["raw_text"])

    def test_blocked_site_falls_back_to_reader(self):
        session = mock.Mock()
        session.get.return_value = FakeResponse(403)
        self.reader.return_value = GRAPH_PAGE
        self.assertTrue(website.extract_website("https://example.com/r", session)["structured"])
        self.reader.return_value = None
        with self.assertRaisesRegex(website.WebsiteError, "blocks"):
            website.extract_website("https://example.com/r", session)

    def test_other_errors_do_not_use_reader(self):
        session = mock.Mock()
        session.get.return_value = FakeResponse(404)
        with self.assertRaisesRegex(website.WebsiteError, "404"):
            website.extract_website("https://example.com/r", session)
        self.reader.assert_not_called()


class ReaderTests(unittest.TestCase):
    def test_reader_request_and_failures(self):
        ok = FakeResponse(200, {}, b"<html>hi</html>")
        with mock.patch.object(website.requests, "get", return_value=ok) as get:
            self.assertEqual(website.fetch_via_reader("https://example.com/r"), "<html>hi</html>")
            self.assertEqual(get.call_args[0][0], "https://r.jina.ai/https://example.com/r")
            self.assertEqual(get.call_args[1]["headers"]["X-Return-Format"], "html")
        with mock.patch.object(website.requests, "get", return_value=FakeResponse(451)):
            self.assertIsNone(website.fetch_via_reader("https://example.com/r"))
        with mock.patch.object(website.requests, "get", side_effect=website.requests.ConnectionError()):
            self.assertIsNone(website.fetch_via_reader("https://example.com/r"))


if __name__ == "__main__":
    unittest.main()
