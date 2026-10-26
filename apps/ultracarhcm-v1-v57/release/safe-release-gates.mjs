// Pure preflight contract. Does not sign, edit PC01, or access Drive.
const ALIGNED = /^UltraCar_v1\.0\.(\d+)_(\d+)_aligned_TEST\.apk$/;
const SIGNED = /^UltraCar_v1\.0\.(\d+)_(\d+)_signed_TEST\.apk$/;
export function parseApktoolVersion(yaml) {
  if (typeof yaml !== "string") throw Error("INVALID_APKTOOL_YAML");
  const c = yaml.match(/^\s*versionCode:\s*['"]?(\d+)['"]?\s*$/m);
  const n = yaml.match(/^\s*versionName:\s*['"]?(TigerIQ_HCM_v1\.0\.(\d+))['"]?\s*$/m);
  if (!c || !n) throw Error("VERSION_METADATA_MISSING");
  return { code: Number(c[1]), minor: Number(n[2]), name: n[1] };
}
export function planSignedCandidate({ alignedName, metadata, expectedMinor, expectedCode, existingSignedNames = [] }) {
  const meta = typeof metadata === "string" ? parseApktoolVersion(metadata) : metadata;
  if (!Number.isInteger(expectedCode) || !Number.isInteger(expectedMinor))
    throw Error("EXPECTED_VERSION_REQUIRED");
  if (meta.code !== expectedCode || meta.minor !== expectedMinor)
    throw Error("STAGE_VERSION_MISMATCH");
  const match = typeof alignedName === "string" && alignedName.match(ALIGNED);
  if (!match || Number(match[1]) !== expectedMinor || Number(match[2]) !== expectedCode)
    throw Error("ALIGNED_NAME_MISMATCH");
  const signedName = alignedName.replace("_aligned_TEST.apk", "_signed_TEST.apk");
  if (existingSignedNames.includes(signedName)) throw Error("SIGNED_EXISTS_NO_OVERWRITE");
  return { signedName, expectedCode, expectedMinor };
}
export function selectSignedForSync({ signedName, expectedMinor, expectedCode }) {
  const match = typeof signedName === "string" && signedName.match(SIGNED);
  if (!match) throw Error("ONLY_SIGNED_TEST_APK_ALLOWED");
  if (Number(match[1]) !== expectedMinor || Number(match[2]) !== expectedCode)
    throw Error("SIGNED_VERSION_MISMATCH");
  return "UltraCar_v1.0." + expectedMinor + "_TEST.apk";
}
export function destinationDecision({ sourceSha256, existingSha256 = null }) {
  if (!/^[0-9a-fA-F]{64}$/.test(sourceSha256 || "")) throw Error("SOURCE_HASH_REQUIRED");
  if (existingSha256 === null) return "CREATE";
  if (!/^[0-9a-fA-F]{64}$/.test(existingSha256)) throw Error("DESTINATION_HASH_INVALID");
  if (existingSha256.toLowerCase() !== sourceSha256.toLowerCase())
    throw Error("DRIVE_COLLISION_HASH_MISMATCH");
  return "IDENTICAL_ALREADY_STAGED";
}
export function requireReleaseGates({ localVersion, signature, targetName, syncReceipt, driveReadback, realDexQA }) {
  if (!localVersion || !signature || !targetName || !syncReceipt || !driveReadback)
    throw Error("TEST_RELEASE_UNVERIFIED");
  return { testPublished: true, appDone: realDexQA === true };
}
