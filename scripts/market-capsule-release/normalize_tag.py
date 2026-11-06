"""Remove surrounding paste whitespace, then enforce the existing tag format."""
import re
import sys


def normalize_tag(raw):
    tag = raw.strip()
    if not re.fullmatch(r"capsule-v[0-9]+\.[0-9]+\.[0-9]+", tag):
        raise ValueError("INVALID_RELEASE_TAG")
    return tag


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("INVALID_RELEASE_TAG")
    try:
        print(normalize_tag(sys.argv[1]))
    except ValueError:
        sys.exit("INVALID_RELEASE_TAG")
