"""Derive the release tag from the checked-out Android source, not form input."""
import re
import sys
from pathlib import Path


def derive_tag(source):
    versions = re.findall(r'^\s*versionName\s*=\s*"([^"]*)"\s*$', source, flags=re.MULTILINE)
    if len(versions) != 1 or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", versions[0]):
        raise ValueError("INVALID_SOURCE_VERSION")
    return "capsule-v" + versions[0]


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("INVALID_SOURCE_VERSION")
    try:
        print(derive_tag(Path(sys.argv[1]).read_text()))
    except (ValueError, OSError):
        sys.exit("INVALID_SOURCE_VERSION")
