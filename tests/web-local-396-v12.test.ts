import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applySegoeUiDefault, WEB_LOCAL_VERSION_V12 } from '../apps/dashboard/src/server-v12.js';

const sample = `<!doctype html><html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700;800&display=swap"><style>:root{font-family:"Open Sans",ui-sans-serif} .x{font-family:Inter,ui-sans-serif}</style></head><body><section data-version="WEB-LOCAL-396-V3.2">Hello</section></body></html>`;

describe('Web Local #396 UI V3.3 Segoe UI layer', () => {
  it('removes Google Fonts and forces Segoe UI site-wide', () => {
    const html = applySegoeUiDefault(sample);
    expect(html).toContain(WEB_LOCAL_VERSION_V12);
    expect(html).toContain('data-font="segoe-ui-default"');
    expect(html).toContain('font-family:"Segoe UI",Arial,sans-serif!important');
    expect(html).not.toContain('fonts.googleapis.com');
  });

  it('retains V12 Segoe UI as the stable functional base while V4 is the current renderer', () => {
    const standalone = readFileSync(new URL('../apps/dashboard/src/standalone.ts', import.meta.url), 'utf8');
    for (const expected of [
      'WEB-LOCAL-396-V4.0', 'startOwnerCockpitV12', 'startOwnerCockpitV17', 'segoe_ui=ĐẠT',
      'architecture_reset=V12_STABLE_DATA_AND_FUNCTIONS_TO_SINGLE_V17_RENDERER',
      'legacy_presentation_runtime_v13_v14_v15=REMOVED', 'state=WEB_LOCAL_396_V40_EXECUTIVE_RUNTIME_AND_FUNCTIONS_VERIFIED',
    ]) expect(standalone).toContain(expected);
    for (const retired of ['startOwnerCockpitV13', 'startOwnerCockpitV14', 'startOwnerCockpitV15']) expect(standalone).not.toContain(retired);
    expect(standalone).not.toContain('open_sans_font_contract=ĐẠT');
    expect(standalone).not.toContain('open_sans_whole_site=ĐẠT');
  });
});
