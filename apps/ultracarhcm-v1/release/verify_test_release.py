#!/usr/bin/env python3
"""Validate public (non-secret) UltraCar TEST release metadata; no signing."""
import hashlib
import json
import re
import sys
from pathlib import Path

MANIFEST = Path(__file__).with_name("test-release-manifest.json")
CERT = "71617043eace89e5f220ea9168b0a9592808111b0f17eaa219f5e6eceb569558"


def require(condition: bool, reason: str):
    if not condition:
        raise SystemExit("RELEASE_CONTRACT_FAIL:" + reason)


def validate(payload):
    require(payload.get("schema") == 1 and payload.get("channel") == "TEST", "SCHEMA_CHANNEL")
    require(payload.get("packageName") == "com.tigeriq.dexsplit", "PACKAGE")
    code = payload.get("versionCode")
    require(type(code) is int and code >= 309, "VERSION_CODE")
    name = payload.get("versionName", "")
    require(bool(re.fullmatch(r"TigerIQ_HCM_v1\.0\.\d+", name)), "VERSION_NAME")
    version = name.removeprefix("TigerIQ_HCM_")
    prefix = f"UltraCar_{version}_{code}_"
    aligned = payload.get("alignedName", "")
    signed = payload.get("signedName", "")
    require(aligned.startswith(prefix) and aligned.endswith("_aligned_TEST.apk"), "ALIGNED_FILENAME")
    require(signed == aligned.replace("_aligned_TEST.apk", "_signed_TEST.apk"), "SIGNED_FILENAME")
    require(payload.get("driveName") == f"UltraCar_{version}_TEST.apk", "DRIVE_FILENAME")
    require(payload.get("signReceiptName") == f"UltraCar_{version}_{code}_sign_receipt.json", "RECEIPT")
    require(payload.get("candidateDraftTag") == f"ultracar-{version}-test-candidate", "DRAFT_TAG")
    require(bool(re.fullmatch(r"[0-9A-F]{64}", payload.get("alignedSHA256", ""))), "ALIGNED_SHA")
    require(payload.get("certificateSHA256") == CERT, "SIGNER_CERT")
    require(payload.get("releaseState") == "CANDIDATE_UNSIGNED_NOT_PUBLISHED", "CANDIDATE_STATE")
    require(not any("pass" in k.lower() or "keystore" in k.lower() or "token" in k.lower()
                    for k in payload.keys()), "SECRET_FIELD_IN_MANIFEST")
    return payload


def main():
    manifest = validate(json.loads(MANIFEST.read_text(encoding="utf-8")))
    if len(sys.argv) == 2:
        apk = Path(sys.argv[1])
        require(apk.is_file() and apk.name == manifest["alignedName"], "INPUT_PATH")
        actual = hashlib.sha256(apk.read_bytes()).hexdigest().upper()
        require(actual == manifest["alignedSHA256"], "INPUT_SHA")
    elif len(sys.argv) != 1:
        raise SystemExit("USAGE: verify_test_release.py [ALIGNED_APK]")
    print("ULTRACAR_TEST_RELEASE_CONTRACT_PASS")
    print("VERSION_CODE=" + str(manifest["versionCode"]))
    print("ALIGNED_SHA256=" + manifest["alignedSHA256"])


if __name__ == "__main__":
    main()
