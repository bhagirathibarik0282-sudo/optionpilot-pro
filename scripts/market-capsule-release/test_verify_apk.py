import unittest
from verify_apk import verify

CERT = "ab" * 32
BADGE = "package: name='com.marketcapsule.app.stable' versionCode='10' versionName='0.1.9'\n"
SIGNATURE = ("Verifies\nVerified using v2 scheme (APK Signature Scheme v2): true\n"
             "Verified using v3 scheme (APK Signature Scheme v3): true\n"
             "Number of signers: 1\nSigner #1 certificate SHA-256 digest: " + CERT + "\n")


class StableApkChecks(unittest.TestCase):
    def check_rejected(self, reason, badge=BADGE, signature=SIGNATURE,
                       tag="capsule-v0.1.9", expected=CERT):
        with self.assertRaisesRegex(ValueError, "^" + reason + "$"):
            verify(badge, signature, tag, expected)

    def test_valid_identity_and_formatted_public_fingerprint(self):
        fingerprint = ":".join(["AB"] * 32)
        self.assertEqual(verify(BADGE, SIGNATURE, "capsule-v0.1.9", fingerprint)["version_code"], 10)

    def test_wrong_package(self):
        self.check_rejected("WRONG_STABLE_PACKAGE_ID", badge=BADGE.replace(".stable'", "'"))

    def test_multiple_package_records(self):
        self.check_rejected("INVALID_PACKAGE_RECORD", badge=BADGE + BADGE)

    def test_debuggable_apk(self):
        self.check_rejected("DEBUGGABLE_RELEASE_REJECTED", badge=BADGE + "application-debuggable\n")

    def test_prerelease_suffix_cannot_match_plain_tag(self):
        self.check_rejected("TAG_VERSION_MISMATCH", badge=BADGE.replace("0.1.9", "0.1.9-debug"))

    def test_wrong_version_or_tag(self):
        self.check_rejected("TAG_VERSION_MISMATCH", tag="capsule-v0.1.8")
        self.check_rejected("INVALID_RELEASE_TAG", tag="capsule-v0.1.9; echo unsafe")

    def test_duplicate_attributes(self):
        self.check_rejected("DUPLICATE_PACKAGE_ATTRIBUTE", badge=BADGE.rstrip() + " versionCode='11'\n")

    def test_invalid_version_codes(self):
        for code in ["0", "-1", "1.5", "2100000001", ""]:
            with self.subTest(code=code):
                self.check_rejected("INVALID_VERSION_CODE", badge=BADGE.replace("'10'", repr(code)))

    def test_signature_verification_and_v2_are_required(self):
        self.check_rejected("APK_SIGNATURE_NOT_VERIFIED", signature=SIGNATURE.replace("Verifies\n", ""))
        self.check_rejected("V2_SIGNATURE_REQUIRED", signature=SIGNATURE.replace(": true", ": false"))

    def test_v3_is_required(self):
        self.check_rejected("V3_SIGNATURE_REQUIRED",
                            signature=SIGNATURE.replace("Scheme v3): true", "Scheme v3): false"))

    def test_multiple_or_missing_signers(self):
        self.check_rejected("SINGLE_STABLE_SIGNER_REQUIRED", signature=SIGNATURE.replace("signers: 1", "signers: 2"))
        self.check_rejected("SINGLE_STABLE_SIGNER_REQUIRED", signature=SIGNATURE.replace("Number of signers: 1\n", ""))

    def test_extra_certificate_cannot_hide_behind_signer_one(self):
        self.check_rejected("SINGLE_STABLE_CERTIFICATE_REQUIRED",
                            signature=SIGNATURE + "Signer #2 certificate SHA-256 digest: " + CERT + "\n")

    def test_wrong_or_missing_expected_certificate(self):
        for expected in ["", "cd" * 32, "not-a-fingerprint"]:
            with self.subTest(expected=expected):
                self.check_rejected("UNEXPECTED_SIGNING_CERT", expected=expected)


if __name__ == "__main__":
    unittest.main()
