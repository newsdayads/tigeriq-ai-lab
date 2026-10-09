import { describe, it, expect, vi } from 'vitest';
import { BCCT_SECTIONS, validateBcctV4, publishBcctV4 } from '../apps/shared/bcct-v4-contract.mjs';

function valid() {
  return {
    sections:BCCT_SECTIONS.map(title=>({title,text:'Đã đối chiếu nguồn GitHub'})),
    generatedAt:'2026-10-09T02:17:00Z',
    sourceUrl:'https://github.com/newsdayads/tigeriq-ai-lab/issues/504',
    dataVerified:false, completionPercent:null,
    status:'CHỜ',
    filters:{mode:'text-fallback',options:['Tất cả','Chưa xong','P0','Đã xong']},
    jobs:[{issue:4569,title:'Khóa biểu tượng vector',url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/4569'}],
    rdc:Array.from({length:5},(_,i)=>({account:'RDC0'+(i+1),pc01:'CHƯA XÁC MINH',remainingPct:null})),
    rdcCheckedAt:null,rdcPreferredAccount:null,
  };
}
describe('BCCT V4 fail-closed presentation contract',()=>{
  it('accepts evidence-limited five-account fallback',()=>{expect(validateBcctV4(valid())).toEqual({ok:true,errors:[]});});
  it('rejects missing sections and historical emoji',()=>{const v=valid();v.sections.pop();v.sections[0].text='✅';expect(validateBcctV4(v).errors).toContain('SIX_ORDERED_SECTIONS_REQUIRED');expect(validateBcctV4(v).errors).toContain('LEGACY_STATUS_EMOJI');});
  it('rejects percentages without verified denominator',()=>{const v=valid();v.completionPercent=80;expect(validateBcctV4(v).errors).toContain('UNVERIFIED_PERCENT');});
  it('rejects missing RDC or fake selection',()=>{const v=valid();v.rdc.pop();v.rdcPreferredAccount='RDC01';expect(validateBcctV4(v).errors).toContain('FIVE_RDC_ACCOUNTS_OR_UNKNOWN_REQUIRED');expect(validateBcctV4(v).errors).toContain('RDC_PREFERRED_UNVERIFIED');});
  it('requires real interactive handler',()=>{const v=valid();v.filters.mode='interactive';expect(validateBcctV4(v).errors).toContain('FILTER_ACTION_REQUIRED');v.filters.onSelect=()=>{};expect(validateBcctV4(v).ok).toBe(true);});
  it('never emits a failed report',()=>{const emit=vi.fn();const v=valid();v.jobs=[{issue:4569,title:'A',url:'not-url'}];expect(publishBcctV4(v,emit).published).toBe(false);expect(emit).not.toHaveBeenCalled();expect(publishBcctV4(valid(),emit).published).toBe(true);expect(emit).toHaveBeenCalledTimes(1);});
});
