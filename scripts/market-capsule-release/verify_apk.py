#!/usr/bin/env python3
"""Validate successful aapt/apksigner output; never reads signing private keys."""
import argparse
import json
import re
from pathlib import Path


def verify(badging, signature, tag, expected_cert):
    def require(condition, reason):
        if not condition:
            raise ValueError(reason)

    require(re.fullmatch(r"capsule-v[0-9]+\.[0-9]+\.[0-9]+", tag), "INVALID_RELEASE_TAG")
    packages = [line for line in badging.splitlines() if line.startswith("package: ")]
    require(len(packages) == 1, "INVALID_PACKAGE_RECORD")
    attributes = re.findall(r"(\w+)='([^']*)'", packages[0])
    require(len({key for key, _ in attributes}) == len(attributes), "DUPLICATE_PACKAGE_ATTRIBUTE")
    package = dict(attributes)
    require(package.get("name") == "com.marketcapsule.app.stable", "WRONG_STABLE_PACKAGE_ID")
    require(not any(line.strip().startswith("application-debuggable")
                    for line in badging.splitlines()), "DEBUGGABLE_RELEASE_REJECTED")
    require(package.get("versionName") == tag.removeprefix("capsule-v"), "TAG_VERSION_MISMATCH")
    code = package.get("versionCode", "")
    require(bool(re.fullmatch(r"[1-9][0-9]*", code)) and int(code) <= 2100000000,
            "INVALID_VERSION_CODE")
    require(re.search(r"(?m)^Verifies\s*$", signature), "APK_SIGNATURE_NOT_VERIFIED")
    require(re.search(r"(?m)^Verified using v2 scheme \(APK Signature Scheme v2\): true\s*$",
                      signature), "V2_SIGNATURE_REQUIRED")
    require(re.search(r"(?m)^Verified using v3 scheme \(APK Signature Scheme v3\): true\s*$",
                      signature), "V3_SIGNATURE_REQUIRED")
    counts = re.findall(r"(?m)^Number of signers: (\d+)\s*$", signature)
    require(counts == ["1"], "SINGLE_STABLE_SIGNER_REQUIRED")
    certs = re.findall(r"(?m)^Signer #\d+ certificate SHA-256 digest: (\S+)\s*$", signature)
    require(len(certs) == 1, "SINGLE_STABLE_CERTIFICATE_REQUIRED")
    expected = expected_cert.strip().replace(":", "").lower()
    actual = certs[0].lower()
    require(bool(re.fullmatch(r"[a-f0-9]{64}", expected)) and actual == expected,
            "UNEXPECTED_SIGNING_CERT")
    return {"package_id": package["name"], "version_name": package["versionName"],
            "version_code": int(code), "certificate_sha256": actual}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--badging", required=True, type=Path)
    parser.add_argument("--signature", required=True, type=Path)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--expected-cert", required=True)
    args = parser.parse_args()
    try:
        result = verify(args.badging.read_text(), args.signature.read_text(),
                        args.tag, args.expected_cert)
    except (ValueError, OSError) as error:
        # Do not echo input blobs or private signing material on failure.
        parser.exit(1, str(error) + "\n" if isinstance(error, ValueError) else "APK_REPORT_UNREADABLE\n")
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
