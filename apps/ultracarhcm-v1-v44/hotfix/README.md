# UltraCar V44 ART VerifyError — source-only hotfix

**Owner device evidence:** 2026-10-25 07:24 ICT, SM-F916N Android 13, `java.lang.VerifyError` on `zc4.b`, dex offset `0x689`, `String` passed as receiver for `Lha4;`. Full log and execution receipts: [Issue #5129](https://github.com/newsdayads/tigeriq-ai-lab/issues/5129#issuecomment-6391429013).

**Cause:** In Compose `zc4.smali` (`.locals 41`), injected `ta1.getId()` overwrote `v11` that must remain `Lha4;` at downstream joins. APKTool/build/signing did not detect this runtime type violation. The source `SourceFromPublished43_TEST_285` on PC01 was subsequently **partially modified** before a scoped edit was denied; **do not build/publish that stage as is**.

## Fix contract

`fix-zc4-verifier.mjs` is a **source-only** checker and non-overwriting patch proposal generator. It requires an exact `zc4.smali` shape and uniquely identified V44 Compose callback. It writes only to a *different, nonexistent* output path supplied by an authorized executor; it does not deploy, sign, run apktool or access any PC.

```text
    move-result-object v14
    move-object/from16 v12, p0
    iget-object v12, v12, Lzc4;->b:Lta1;
    invoke-virtual {v12}, Lta1;->getId()Ljava/lang/String;
    move-result-object v12
    new-instance v13, Lcom/tigeriq/v44/CardPositioned;
    invoke-direct {v13, v12}, Lcom/tigeriq/v44/CardPositioned;-><init>(Ljava/lang/String;)V
    invoke-static {v14, v13}, Landroidx/compose/ui/layout/a;->d(Lb83;Lnz1;)Lb83;
    move-result-object v14
```

The original `v11` **must remain `Lha4;`**. `v12`/`v13` are overwritten by original code immediately after the callback and require full ART verifier/device validation, not merely a text check.

## Actual tests and gates

`node apps/ultracarhcm-v1-v44/hotfix/fix-zc4-verifier.test.mjs` — 9 scoped regression tests (bad v11, partially-edited stage, constructor register, original receiver, idempotence, unexpected source, absent/duplicate anchor, CRLF). These are **source-pattern unit tests only**, not proof Android/Dex verifier accepted the full app.

The next TEST release must use a **fresh approved isolated stage**, never overwrite signed v43, signed v44, or official Production v17. Reconfirm the existing PC01/Drive sources and signer, fix runtime through an authorized execution lane, build a **new** versionCode (e.g. 286 only if unused), `zipalign`, `apksigner` v2/v3 same cert, verify `aapt2` metadata, stage under the interactive Windows Drive session, read cloud file metadata and test launch on SM-F916N. Do not reissue a security-denied operation via another tool/account/path.

**Current factual state:** Hotfix source + tests only. v44 TEST on Drive is **known crashing/unaccepted**. No new signed APK/Drive file is evidenced. An authorized Owner instruction cannot override a platform-level security denial.
