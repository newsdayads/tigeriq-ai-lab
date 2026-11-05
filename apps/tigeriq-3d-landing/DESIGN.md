# TigerIQ 3D — Giao diện / Motion Contract V2
Source: Owner feedback 05/11/2026; scoped to `apps/tigeriq-3d-landing`.
Approved reference: image mockup from conversation and user correction; no second design authority.
Brand: **TigerIQ 3D**, high-key white/lilac/cyan gradients; dark navy typography; warm orange and royal blue CTA.
Typography: Be Vietnam Pro; strong visual hierarchy with generous white space.
Primary action: **exactly one contact widget** fixed to viewport; contains one Zalo profile action and a phone icon action, one visually displayed number **0392 960 003**. No duplicated contact buttons in header, hero, product pricing, footer or other sections.
Contact: Zalo profile `https://zalo.me/0392960003` only opens user profile/login; website cannot send friend request automatically. Phone `tel:+84392960003`.
Motion: visible idle 3D six-face rotating prism, two 3D rotating rings, depth particles, chromatic glow around hero image, moving ticker, image breathing and icons levitating. Fine-pointer hover: 13-degree 3D tilt plus dynamic specular highlights on cards; hero pointer parallax. Scroll: reveal cards with IntersectionObserver and top gradient progress.
Mobile: idle animations and scroll reveal still active without hover; no horizontal overflow, all content clickable, one bottom contact dock. `prefers-reduced-motion` disables decorative motion.
Motion contract: no sound, no paid dependencies, no falsified metrics/ratings; animations must not block clicks or keyboard access.
Acceptance: static 1 Zalo/1 phone/1 visible number; Chrome screenshots desktop/mobile; evaluate hover transforms, active computed CSS animations, scroll reveal; 5/5 images; public HTTPS 200; old root/driver/ai/city unaffected.
Operations: only standalone TigerIQ 3D PC01 files, GitHub PR and CI gates; no Vercel production or Tunnel mutation needed.
