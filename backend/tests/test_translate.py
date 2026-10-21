"""Run with: cd backend && python -m unittest discover tests"""
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import main  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

ORIGINAL = {
    "title": "Sausage Ragu Bianco",
    "description": "A creamy white ragu.",
    "ingredients": [
        {"item": "Italian sausage", "amount": "500", "unit": "g", "group": "Main"},
        {"item": "Parmesan", "amount": "50", "unit": "g", "group": "Topping"},
    ],
    "instructions": ["Brown the sausage.", "Stir in the cream."],
    "prep_time": "10 mins",
    "cook_time": "25 mins",
    "servings": "4 people",
}

DUTCH = {
    "title": "Ragu bianco met worst",
    "description": "Een romige witte ragu.",
    "ingredients": [
        {"item": "Italiaanse worst", "amount": "500", "unit": "g", "group": "Hoofdgerecht"},
        {"item": "Parmezaan", "amount": "50", "unit": "g", "group": "Topping"},
    ],
    "instructions": ["Bak de worst bruin.", "Roer de room erdoor."],
    "prep_time": "10 minuten",
    "cook_time": "25 minuten",
    "servings": "4 personen",
}


class MergeTranslationTest(unittest.TestCase):
    def test_takes_translated_wording(self):
        out = main.merge_translation(ORIGINAL, DUTCH)
        self.assertEqual(out["title"], "Ragu bianco met worst")
        self.assertEqual(out["instructions"], DUTCH["instructions"])
        self.assertEqual(out["ingredients"][1]["item"], "Parmezaan")
        self.assertEqual(out["servings"], "4 personen")

    def test_keeps_amounts_and_main_group_from_original(self):
        tampered = {**DUTCH, "ingredients": [
            {"item": "Italiaanse worst", "amount": "5000", "unit": "g", "group": "Hoofdgerecht"},
            {"item": "Parmezaan", "amount": "1", "unit": "g", "group": "Topping"},
        ]}
        out = main.merge_translation(ORIGINAL, tampered)
        self.assertEqual([i["amount"] for i in out["ingredients"]], ["500", "50"])
        self.assertEqual(out["ingredients"][0]["group"], "Main")

    def test_wrong_line_count_falls_back_to_original_lines(self):
        broken = {**DUTCH, "instructions": ["Alles in een keer."], "ingredients": DUTCH["ingredients"][:1]}
        out = main.merge_translation(ORIGINAL, broken)
        self.assertEqual(out["instructions"], ORIGINAL["instructions"])
        self.assertEqual([i["item"] for i in out["ingredients"]], ["Italian sausage", "Parmesan"])
        self.assertEqual(out["title"], "Ragu bianco met worst")

    def test_garbage_response_returns_original(self):
        out = main.merge_translation(ORIGINAL, {})
        self.assertEqual(out["title"], ORIGINAL["title"])
        self.assertEqual(out["instructions"], ORIGINAL["instructions"])


class TranslateEndpointTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        main._RATE_HITS.clear()

    def test_translates_and_stamps_language(self):
        with mock.patch.dict(os.environ, {"GEMINI_API_KEY": "test"}), \
                mock.patch.object(main, "generate_json", return_value=DUTCH) as gen:
            r = self.client.post("/translate-recipe", json={"recipe": ORIGINAL, "language": "nl"})
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["language"], "nl")
        self.assertEqual(body["title"], "Ragu bianco met worst")
        self.assertIn("Dutch", gen.call_args[0][0])

    def test_rejects_oversized_recipe(self):
        huge = {**ORIGINAL, "instructions": ["x" * 1000] * 30}
        with mock.patch.dict(os.environ, {"GEMINI_API_KEY": "test"}), \
                mock.patch.object(main, "generate_json") as gen:
            r = self.client.post("/translate-recipe", json={"recipe": huge, "language": "en"})
        self.assertEqual(r.status_code, 413)
        gen.assert_not_called()

    def test_normalize_language(self):
        self.assertEqual(main.normalize_language("nl-NL"), "nl")
        self.assertEqual(main.normalize_language("en"), "en")
        self.assertEqual(main.normalize_language("de"), "en")
        self.assertEqual(main.normalize_language(""), "en")


if __name__ == "__main__":
    unittest.main()
