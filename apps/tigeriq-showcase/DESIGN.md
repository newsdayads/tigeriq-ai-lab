# TigerIQ / TIG — Public Website V2 Design Contract

Source: Owner-approved desktop and iPhone visual references in the 2026-11-05 TigerIQ website design conversation. This document captures visible instructions; exact artwork pixels and dimensions from screenshots are not interchangeable with production assets.
Owner instruction: Full Auto website implementation; no invented claims or fake success.

## Identity
- Full brand: **TigerIQ**. Abbreviation: **TIG** (never TQ). Product/service: **UltraCarHCM** (not standalone UltraCar).
- Public contact: 0392960003 / tel:0392960003.
- Homepage message: "Công nghệ thực tế" / "Giá trị bền vững".
- Seven services in exact order: Thiết kế Website, Phần mềm, UltraCarHCM, Driver, In 3D, Marketing, PhoneFarm.

## Observed visual language
- Spacious **light** page: off-white (#faf9fc), subtle pale lavender-grey surfaces (#f1f0f7), charcoal text (#222129), true red accents (#dd1427), white/translucent cards and gentle shadows.
- Typographic family: Roboto Flex (variable) with Vietnamese support. Body 350–450; prominent headline 400–500; logo TIG strong to establish hierarchy. Avoid dense heavy bold type.
- Hero: desktop two columns with large left-aligned Vietnamese heading and large glossy red glass **TIG** monogram floating on an understated pedestal/orbit on the right. Floating service labels appear around hero but must remain accessible/nonblocking.
- Header: white/translucent pill, TIG acronym with full "TigerIQ" name, links for Giới thiệu / Dịch vụ / Dự án / Quy trình / Liên hệ, tel CTA. Mobile compact header + real toggled navigation.
- Service area: cards with red vector icons, white glass surfaces and short descriptions. Desktop 7 columns if space permits; tablet 3–4 columns; phone 2 columns (PhoneFarm may span row). Cards provide meaningful anchors to service descriptions/consultation, not fake navigation.
- Further content: About/positioning, service details, verified projects/products, process, contact CTA and trust message. Do not turn this into a news feed.
- Motion: subtle hero levitation and red orbit, soft appearance on scroll, card hover; disable/transmute animation via prefers-reduced-motion; support pointer+touch.
- Visual accessibility: no clipping at 320px, accessible contrast, visible keyboard focus, touch targets ~44px.

## Distinguish reference from evidence
- **Illustrative counters 500+ projects, 300+ clients, 5+ years** in an image generation concept are **not verified** and **must not be published**.
- No placeholder video, fake customer logos, inaccurate product availability, fake reviews/testimonials, invented achievements.
- UltraCarHCM and TigerIQ News / other initiatives must be described according to verified public facts, not as universally production-ready.
- External source updates: public GitHub metadata via allowlist; never leak authenticated/internal issue/worker/workstation data, and do not equate latest commit with production publication.

## Deployment boundary
- Canonical source is GitHub main under apps/tigeriq-showcase, off-main PR/checks before merge.
- PC01 existing origin 127.0.0.1:8878 using User/AtLogOn task TigerIQ Showcase PC01; **do not modify** driver/ai/city, Tunnel, DNS, Vercel, credentials or paid infrastructure without separate gate.
- Back up current static files, verify source SHA and live HTTP after replacement; revert on failed final checks.
- The Owner's existing public domain tigeriq.io.vn is a separate HTTPS acceptance gate.

## Element-to-implementation map
| Reference | Implementation target | Verify |
| --- | --- | --- |
| TIG + TigerIQ masthead | index.html header .brand | desktop/mobile, names exact |
| Light hero and headline | .hero / .hero-copy | legibility, no clipping |
| Glass 3D TIG | inline original SVG + CSS .hero-object | desktop/mobile, no screenshot reuse |
| Seven service cards | #services .service-card | exact labels and content |
| Mobile 2-col tiles | CSS media queries | 390px and 320px |
| Phone CTA | a[href="tel:0392960003"] | actual tel protocol |
| Projects/about/process | #projects/#about/#method | verified content only |
| Reduced motion | CSS @media prefers-reduced-motion + JS | accessibility test |
