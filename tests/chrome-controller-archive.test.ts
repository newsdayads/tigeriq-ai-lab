import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Chrome Controller safe save-and-archive',()=>{
  it('fails closed unless the current ChatGPT conversation archive target is unique',()=>{
    const content=readFileSync('apps/chrome-controller/extension/content.js','utf8');
    expect(content).toContain('ARCHIVE_REQUIRES_CONVERSATION_URL');
    expect(content).toContain('ARCHIVE_MENU_BUTTON_NOT_UNIQUE');
    expect(content).toContain('ARCHIVE_MENU_ITEM_NOT_UNIQUE');
    expect(content).toContain("['archive', 'lưu trữ']");
    expect(content).toContain('ARCHIVE_NOT_CONFIRMED');
    expect(content).toContain("message?.type === 'TIGERIQ_ARCHIVE_CONVERSATION'");
  });

  it('requires terminal external evidence and bounded automatic retries',()=>{
    const background=readFileSync('apps/chrome-controller/extension/background.js','utf8');
    expect(background).toContain("const ARCHIVE_SUPPORTED_WORKERS = new Set(['NV02','NV03'])");
    expect(background).toContain('ARCHIVE_SELECTOR_UNVERIFIED');
    expect(background).toContain('ARCHIVE_ACTIVE_JOB_FORBIDDEN');
    expect(background).toContain('ARCHIVE_EXTERNAL_DONE_EVIDENCE_REQUIRED');
    expect(background).toContain('SAVE_RESPONSE_NOT_OBSERVED');
    expect(background).toContain("text:'lưu'");
    expect(background).toContain('if(count>=2) return');
    expect(background).toContain("saved.archiveAfterDone!==true");
  });

  it('exposes manual action and keeps auto archive default off',()=>{
    const html=readFileSync('apps/chrome-controller/extension/popup.html','utf8');
    const script=readFileSync('apps/chrome-controller/extension/popup.js','utf8');
    expect(html).toContain('id="saveArchive"');
    expect(html).toContain('Lưu &amp; Lưu trữ');
    expect(html).toContain('id="archiveAfterDone" type="checkbox"');
    expect(html).not.toContain('id="archiveAfterDone" type="checkbox" checked');
    expect(script).toContain("type:'TIGERIQ_SAVE_AND_ARCHIVE'");
    expect(script).toContain('saved.archiveAfterDone === true');
  });
});
