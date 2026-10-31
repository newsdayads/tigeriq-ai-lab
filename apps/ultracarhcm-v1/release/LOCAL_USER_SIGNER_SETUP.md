# UltraCarHCM V1 — one-time local-user signer enrollment for v66 TEST

**Issue:** ChatGPT RDC on PC01 runs as `NT AUTHORITY\SYSTEM`. Its environment has no signing credentials. Existing `sign_latest.cmd` merely calls `sign_latest.ps1`, which is fixed to v65. The existing Drive task is also fixed to v65. Do NOT execute either for v66.

**Source-only, reviewed GitHub additions:**

- `Initialize-UltraCarSignerLocal.ps1` — physically on PC01, interactively signed in as `PC01\wdragons12x`, prompts for the two existing signing passwords locally, stores them using Windows user-scoped DPAPI. It refuses non-interactive/SYSTEM and existing store overwrite. **Not for ChatGPT/RDC execution.**
- `Sign-UltraCarV66LocalTask.ps1` — runs under the SAME Windows user; pins exact v66 aligned SHA and code 307, loads DPAPI inside PC01 process only, invokes `Invoke-UltraCarTestApk.ps1 -Mode Sign`, verifies cert/metadata/signature, clears process environment. `-StageDrive` uses a fixed exact signed filename, no wildcard and atomic no-overwrite write to the mapped Drive folder. No passwords leave PC01 or appear in task arguments.

### Once-only required local Owner/admin action

1. On PC01 desktop, sign in interactively as `PC01\wdragons12x`. Confirm the `G:\Drive của tôi\TigerIQ UltraCar` folder is mapped. Do not send passwords to ChatGPT.
2. After GitHub PR is merged and this PC01 Git checkout has safely fast-forwarded to that exact main SHA, run once in the **local desktop PowerShell console**:

```powershell
& 'D:\TigerIQ\Workspace\tigeriq-ai-lab\apps\ultracarhcm-v1\release\Initialize-UltraCarSignerLocal.ps1'
```

3. Enter the already authorized keystore/key passwords in the local secure prompts. They are DPAPI-encrypted for the current Windows user; the ChatGPT SYSTEM process cannot decrypt them.
4. In **Windows Task Scheduler GUI**, create **one narrowly scoped on-demand task** `TigerIQ_UltraCar_v66_Sign_TEST`, run as `PC01\wdragons12x`, select **Run only when user is logged on**, and disable automatic triggers. Program: `powershell.exe`. Arguments:

```text
-NoProfile -NonInteractive -File D:\TigerIQ\Workspace\tigeriq-ai-lab\apps\ultracarhcm-v1\release\Sign-UltraCarV66LocalTask.ps1 -StageDrive
```

5. Test the task once from the local desktop console, then ChatGPT may request this **already installed** task by name when permitted. Do not create or edit a scheduled task through a previously rejected ChatGPT tool-call.

### Gate and receipt

- Already-built, aligned, verified v66 / build 307: `D:\TigerIQ\Apps\DeXCamPersonal\build\UltraCar_v1.0.66_307_aligned_TEST.apk`; pinned SHA256 `C68CFC6C4FF9F1C7E341C441B6E94154CB2F04CB26688E6F5900EE5539757D47`.
- Output signed: `UltraCar_v1.0.66_307_signed_TEST.apk`; output Drive local mirror: `UltraCar_v1.0.66_TEST.apk`.
- Task emits **local** verification and **local Drive mirror** receipts, not independently confirmed Google Drive cloud identity. ChatGPT must independently read Drive API and verify name, size, parent, hash if available, then send owner a verified URL.
- Physical Samsung Fold2 DeX UI acceptance remains independent. No production release or changes to existing v65.

**Blocked until Owner/admin enrolls locally and configures the on-demand task.** GitHub source merge does not create a task, authorize host policy changes, or make DPAPI material available to SYSTEM.
