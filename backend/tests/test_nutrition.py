"""Run with: cd backend && python -m unittest discover tests"""
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import main  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


class CleanNutritionTest(unittest.TestCase):
    def test_keeps_consistent_numbers_and_rounds(self):
        out = main.clean_nutrition({"kcal": 523, "protein": 41.6, "carbs": 48.2, "fat": 17.8, "servings": 4})
        self.assertEqual(out, {"kcal": 520, "protein": 42, "carbs": 48, "fat": 18, "servings": 4})

    def test_recomputes_calories_that_disagree_with_the_macros(self):
        out = main.clean_nutrition({"kcal": 1500, "protein": 40, "carbs": 50, "fat": 20})
        self.assertEqual(out["kcal"], 540)  # 160 + 200 + 180

    def test_rejects_missing_or_absurd_values(self):
        self.assertIsNone(main.clean_nutrition({"kcal": 500, "protein": 30}))
        self.assertIsNone(main.clean_nutrition({"kcal": 500, "protein": -1, "carbs": 10, "fat": 10}))
        self.assertIsNone(main.clean_nutrition({"protein": 0, "carbs": 0, "fat": 0}))
        self.assertIsNone(main.clean_nutrition("nonsense"))


class NutritionEndpointTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        main._RATE_HITS.clear()

    def recipe(self, rid):
        return {"id": rid, "title": "Ragu", "servings": "4 people",
                "ingredients": [{"item": "sausage", "amount": "400", "unit": "g"}, {"item": "pasta", "amount": "300", "unit": "g"}]}

    def test_returns_cleaned_results_for_known_ids_only(self):
        reply = {"results": [
            {"id": "a", "servings": 4, "kcal": 640, "protein": 30, "carbs": 60, "fat": 30},
            {"id": "zzz", "kcal": 100, "protein": 5, "carbs": 5, "fat": 5},
            {"id": "b", "kcal": "x"},
        ]}
        with mock.patch.dict(os.environ, {"GEMINI_API_KEY": "t"}), \
                mock.patch.object(main, "generate_json", return_value=reply) as gen:
            r = self.client.post("/estimate-nutrition", json={"recipes": [self.recipe("a"), self.recipe("b")]})
        self.assertEqual(r.status_code, 200)
        self.assertEqual([x["id"] for x in r.json()["results"]], ["a"])
        self.assertIn("400 g sausage", gen.call_args[0][0])

    def test_limits_batch_size(self):
        with mock.patch.dict(os.environ, {"GEMINI_API_KEY": "t"}), mock.patch.object(main, "generate_json") as gen:
            r = self.client.post("/estimate-nutrition", json={"recipes": [self.recipe(str(i)) for i in range(9)]})
        self.assertEqual(r.status_code, 413)
        gen.assert_not_called()

    def test_skips_the_model_when_nothing_has_ingredients(self):
        with mock.patch.dict(os.environ, {"GEMINI_API_KEY": "t"}), mock.patch.object(main, "generate_json") as gen:
            r = self.client.post("/estimate-nutrition", json={"recipes": [{"id": "x", "ingredients": []}]})
        self.assertEqual(r.json(), {"results": []})
        gen.assert_not_called()


if __name__ == "__main__":
    unittest.main()
