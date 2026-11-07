#!/usr/bin/env python3
"""Check ELF load segment alignment independently of APK ZIP alignment."""
import argparse
import os
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path


PAGE_SIZE = 16 * 1024


def verify(apk):
    count = 0
    with zipfile.ZipFile(apk) as archive, tempfile.TemporaryDirectory() as temp:
        library = Path(temp) / "native.so"
        for entry in archive.infolist():
            if not (entry.filename.startswith("lib/") and entry.filename.endswith(".so")):
                continue
            with archive.open(entry) as source, library.open("wb") as target:
                shutil.copyfileobj(source, target)
            result = subprocess.run(
                ["readelf", "-lW", library], check=True, capture_output=True, text=True,
                env={**os.environ, "LC_ALL": "C"},
            )
            loads = [line.split() for line in result.stdout.splitlines()
                     if line.lstrip().startswith("LOAD ")]
            if not loads:
                raise ValueError(f"{entry.filename}: no ELF LOAD segments")
            for load in loads:
                offset, address = (int(value, 16) for value in load[1:3])
                alignment = int(load[-1], 16)
                if alignment < PAGE_SIZE or (address - offset) % PAGE_SIZE:
                    raise ValueError(f"{entry.filename}: ELF LOAD segment is not 16 KB aligned")
            count += 1
    return count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", type=Path)
    args = parser.parse_args()
    try:
        count = verify(args.apk)
    except (OSError, ValueError, zipfile.BadZipFile, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Native alignment check failed: {error}\n")
    print(f"16 KB ELF LOAD alignment verified for {count} packaged native libraries.")


if __name__ == "__main__":
    main()
