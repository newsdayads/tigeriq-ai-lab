## Root cause

Machine-real screenshot showed three material presentation defects:

1. Lower page was laid out by one parent CSS grid with `team/system/owner/rights` assigned to separate columns but implicit shared rows. A tall system card therefore inflated the entire row and created a very large blank region beneath the shorter team block.
2. Overview `Hệ thống` used two columns inside a narrow right-side container while retaining long technical text. This reduced the text track enough to collapse labels into near vertical wrapping.
3. No final-layer guard ensured only one sidebar DOM block if inherited transformations ever emitted duplicates; screenshot capture also made sticky sidebar repetition visually confusing.

## Fix

V3.5 adds a final layout-repair proxy layer that keeps V3.4 visuals/data but:
- makes Team full width;
- pairs compact System + Owner rows predictably;
- makes Rights full width;
- renders System cards as three responsive columns with safe text wrapping and overview technical-detail suppression;
- clamps AI secondary text;
- forces max-content grid rows and auto-height cards;
- deduplicates sidebar DOM defensively;
- preserves dedicated server-side detail views for technical data.
