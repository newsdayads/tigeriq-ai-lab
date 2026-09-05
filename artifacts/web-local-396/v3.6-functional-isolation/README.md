# Web Local #396 — Functional Surface Isolation

Source: machine-real screenshot + owner report on 2026-09-05.

Root cause:
- V11 correctly split legacy functions into dedicated server-side views.
- V13/V14/V15 presentation layers were chained after that router and therefore still received every HTML GET, including functional views.
- Existing regression coverage only proved a subset of views.

Fix:
- V12 registers its private stable URL inside the same process.
- Final V15 routes all seven functional GET views plus all write requests directly through V12, bypassing V13/V14/V15 presentation transforms.
- Overview alone continues through Fluent Executive + layout repair + incremental live refresh.
- Redirects are normalized back to the proper functional view after write actions.
- Added regression coverage for Overview + Work + Workforce + Models + Evidence + Reports + System + Settings.

Safety: non-MAIN artifact channel only. No production, credential, network, reboot, paid, or unrelated employee scope change.

Final acceptance still requires PC01 machine-real evidence at 100.97.23.87:8787.