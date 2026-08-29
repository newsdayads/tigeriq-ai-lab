# WO-006 — Driver Fleet SaaS Customer Discovery & Offer

Status: READY FOR CUSTOMER VALIDATION
Date: 2026-08-29

## ICP v1
Primary customer: owner-operated ride-hailing fleet in Vietnam with 2-20 cars and multiple drivers, using one or more of Green SM, Grab, be or other ride platforms.

Operational profile:
- Owner still reconciles revenue manually or through screenshots/spreadsheets/chat.
- Drivers receive cash and non-cash payments across apps.
- Owner needs to know which shifts/days are settled, what each driver owes/is owed, and whether trips are missing or duplicated.
- Existing accounting tools do not understand ride screenshots, trip identity or driver-owner settlement semantics.

## Top pains to validate
1. Daily reconciliation takes too long and depends on manual screenshots/messages.
2. Cash/card/app-wallet differences create disputes or uncertainty.
3. Multiple drivers/vehicles make settlement status hard to track.
4. Missing/duplicate trips are hard to detect consistently.
5. Owners lack one operational dashboard showing revenue, settlement and evidence.

## Offer v1
**TigerIQ Fleet Settlement** — upload or capture ride evidence from multiple ride-hailing apps; TigerIQ groups trips, extracts revenue, tracks cash/card, records driver/owner settlement and shows what is complete, missing or needs review.

Core pilot scope:
- 2-5 vehicles.
- Up to 10 drivers.
- Daily trip import from screenshots.
- Driver/vehicle/app tagging.
- Net revenue + cash/card split.
- Daily settlement status.
- Owner/driver balance.
- Missing/duplicate/review queue.
- Evidence trail.

Not in pilot:
- Payroll.
- Full bookkeeping/tax filing.
- Automatic bank transfers.
- Paid integrations requiring commercial API contracts.

## Pricing hypotheses — validate, do not publish yet
A. Per vehicle: 99k-199k VND/vehicle/month.
B. Small-fleet bundle: 499k-799k VND/month for up to 5 vehicles.
C. Paid onboarding: 300k-1m VND one-time only if setup/migration work is significant.

Pilot hypothesis:
- 14-day assisted pilot at zero software fee.
- Customer provides real daily settlement evidence.
- Pilot converts only if it saves measurable time or prevents settlement errors.

## Interview script
Ask about current behavior before pitching:
1. How many cars and drivers are you reconciling today?
2. Which ride apps are used and how is revenue evidence collected?
3. Walk me through yesterday's settlement from start to finish.
4. Where do mistakes/disputes happen most often?
5. How long does reconciliation take per day/week?
6. What happens when a driver forgets a screenshot or a trip is duplicated?
7. How do you track cash already held by the driver versus money paid to the owner?
8. What tools are used now: notebook, Excel, Zalo, accounting app, platform reports?
9. What would make you trust an automated settlement result?
10. If this reduced reconciliation to a few minutes and kept evidence, what monthly price would feel reasonable? What price would be too expensive?

Do not lead with TigerIQ until questions 1-8 are understood.

## Validation scorecard
For each interview record:
- Fleet size.
- Apps used.
- Current reconciliation method.
- Time spent/week.
- Error/dispute frequency.
- Pain severity 1-5.
- Current spend on tools/admin.
- Must-have requirement.
- Willingness to pilot: yes/no.
- Willingness to pay: explicit amount/range or none.

## Go / no-go gate
GO to productized pilot when all are true:
- >=5 external interviews completed.
- >=3 report pain severity >=4/5.
- >=2 agree to test with real data.
- >=1 gives an explicit willingness-to-pay signal.
- No critical legal/data requirement invalidates the current evidence model.

NO-GO / reposition if fewer than 2 of 5 interviewees have severe recurring reconciliation pain.

## Pilot success metrics
- >=70% reduction in owner reconciliation time.
- Zero unexplained duplicate settlements.
- 100% daily settlement status visible.
- Owner can trace every calculated balance to evidence.
- At least one pilot customer asks to keep using the system after day 14.

## External wait
The internal preparation is complete. The next gate requires real external fleet-owner interviews and pilot data; this evidence cannot be truthfully simulated by Company OS.
