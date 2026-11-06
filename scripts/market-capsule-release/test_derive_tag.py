import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from derive_tag import derive_tag


class AutomaticTagChecks(unittest.TestCase):
    def test_tag_comes_from_source_version(self):
        self.assertEqual(derive_tag('    versionName = "0.1.9"\n'), "capsule-v0.1.9")

    def test_missing_and_ambiguous_versions_are_rejected(self):
        for source in ["", '// versionName = "0.1.9"',
                       'versionName = "0.1.9"\nversionName = "0.2.0"']:
            with self.subTest(source=source):
                with self.assertRaisesRegex(ValueError, "^INVALID_SOURCE_VERSION$"):
                    derive_tag(source)

    def test_invalid_versions_remain_rejected(self):
        for version in ["0.1.9-debug", " 0.1.9", "feature/market-capsule-android", "0.1"]:
            with self.subTest(version=version):
                with self.assertRaisesRegex(ValueError, "^INVALID_SOURCE_VERSION$"):
                    derive_tag('versionName = "' + version + '"\n')

    def test_cli_reads_source_and_fails_for_missing_file(self):
        script = str(Path(__file__).with_name("derive_tag.py"))
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "build.gradle.kts"
            source.write_text('versionName = "0.1.9"\n')
            result = subprocess.run([sys.executable, script, str(source)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout, "capsule-v0.1.9\n")
            source.unlink()
            missing = subprocess.run([sys.executable, script, str(source)], capture_output=True, text=True)
            self.assertNotEqual(missing.returncode, 0)
            self.assertEqual(missing.stdout, "")


if __name__ == "__main__":
    unittest.main()
