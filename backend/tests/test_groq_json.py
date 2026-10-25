"""Run with: cd backend && python -m unittest discover tests"""
import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import main  # noqa: E402


class GroqValidationError(Exception):
    def __init__(self, failed_generation=""):
        super().__init__("Error code: 400 - Failed to validate JSON. Please adjust your prompt.")
        self.body = {"error": {"message": "Failed to validate JSON", "failed_generation": failed_generation}}


def reply(text):
    return mock.Mock(choices=[mock.Mock(message=mock.Mock(content=text))])


class ExtractJsonTest(unittest.TestCase):
    def test_finds_object_in_prose_and_fences(self):
        self.assertEqual(json.loads(main.extract_json_object('Sure!\n```json\n{"a": 1}\n```')), {"a": 1})
        self.assertEqual(json.loads(main.extract_json_object('x {"t": "a } b", "n": {"m": 2}} y')),
                         {"t": "a } b", "n": {"m": 2}})

    def test_none_when_absent_or_broken(self):
        self.assertIsNone(main.extract_json_object("no json here"))
        self.assertIsNone(main.extract_json_object('{"a": '))
        self.assertIsNone(main.extract_json_object(""))


class GroqJsonFallbackTest(unittest.TestCase):
    def client(self, *effects):
        c = mock.Mock()
        c.chat.completions.create.side_effect = list(effects)
        return c

    def test_salvages_the_rejected_generation(self):
        c = self.client(GroqValidationError('Here you go: {"results": []}'))
        with mock.patch.object(main, "Groq", return_value=c):
            self.assertEqual(json.loads(main._groq_json("p", "s", "k", "m")), {"results": []})
        self.assertEqual(c.chat.completions.create.call_count, 1)

    def test_retries_as_plain_text_when_nothing_to_salvage(self):
        c = self.client(GroqValidationError(""), reply('```json\n{"title": "Ragu"}\n```'))
        with mock.patch.object(main, "Groq", return_value=c):
            self.assertEqual(json.loads(main._groq_json("p", "s", "k", "m")), {"title": "Ragu"})
        second = c.chat.completions.create.call_args_list[1].kwargs
        self.assertNotIn("response_format", second)

    def test_other_errors_still_raise(self):
        c = self.client(RuntimeError("429 rate limit"))
        with mock.patch.object(main, "Groq", return_value=c):
            with self.assertRaises(RuntimeError):
                main._groq_json("p", "s", "k", "m")

    def test_plain_text_without_json_raises(self):
        c = self.client(GroqValidationError(""), reply("Sorry, I can't."))
        with mock.patch.object(main, "Groq", return_value=c):
            with self.assertRaises(ValueError):
                main._groq_json("p", "s", "k", "m")


if __name__ == "__main__":
    unittest.main()
