import subprocess
import sys
import unittest
from pathlib import Path
from normalize_tag import normalize_tag


class TagInputChecks(unittest.TestCase):
    def test_valid_tag_unchanged(self):
        self.assertEqual(normalize_tag("capsule-v0.1.9"), "capsule-v0.1.9")

    def test_actual_failed_input_and_surrounding_whitespace(self):
        for raw in ["\tcapsule-v0.1.9", " capsule-v0.1.9 \r\n", "\u00a0capsule-v0.1.9\u00a0"]:
            with self.subTest(raw=repr(raw)):
                self.assertEqual(normalize_tag(raw), "capsule-v0.1.9")

    def test_invalid_internal_content_is_still_rejected(self):
        for raw in ["", " \t", "capsule-v0.1.9-debug", "capsule-v0. 1.9", "capsule-v0.1.9;echo bad"]:
            with self.subTest(raw=repr(raw)):
                with self.assertRaisesRegex(ValueError, "^INVALID_RELEASE_TAG$"):
                    normalize_tag(raw)

    def test_cli_prints_only_valid_normalized_tag(self):
        script = str(Path(__file__).with_name("normalize_tag.py"))
        ok = subprocess.run([sys.executable, script, "\tcapsule-v0.1.9 "], capture_output=True, text=True)
        self.assertEqual(ok.returncode, 0)
        self.assertEqual(ok.stdout, "capsule-v0.1.9\n")
        bad = subprocess.run([sys.executable, script, "capsule-v0.1.9\nbad"], capture_output=True, text=True)
        self.assertNotEqual(bad.returncode, 0)
        self.assertEqual(bad.stdout, "")
        self.assertEqual(bad.stderr.strip(), "INVALID_RELEASE_TAG")


if __name__ == "__main__":
    unittest.main()
