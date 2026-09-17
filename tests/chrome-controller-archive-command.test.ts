import { describe,expect,it,vi } from 'vitest';
import { runArchiveCommand,validateArchiveCommand } from '../apps/chrome-controller/extension/archive-command.js';

const supported=(id:string)=>id==='NV02'||id==='NV03';

describe('direct ARCHIVE_CHAT command',()=>{
  it('rejects unsupported workers and non-GitHub receipt refs before archive flow',()=>{
    expect(()=>validateArchiveCommand('NV04',{receiptRef:'https://github.com/x'},{archiveSupported:supported})).toThrow('ARCHIVE_SELECTOR_UNVERIFIED:NV04');
    expect(()=>validateArchiveCommand('NV02',{receiptRef:'forged'},{archiveSupported:supported})).toThrow('ARCHIVE_DURABLE_RECEIPT_REQUIRED');
  });

  it('never lets the caller receipt authorize archive; it requires a fresh canonical saveAndArchive result',async()=>{
    const saveAndArchive=vi.fn().mockResolvedValue({ok:true,status:'ARCHIVED',receiptRef:'https://github.com/fresh',checkpointRef:'https://github.com/checkpoint',receiptVerifiedAt:'2026-09-17T00:00:00Z'});
    const result=await runArchiveCommand('NV02',{receiptRef:'https://github.com/stale'},{archiveSupported:supported,saveAndArchive});
    expect(saveAndArchive).toHaveBeenCalledOnce();
    expect(saveAndArchive).toHaveBeenCalledWith('NV02',{requireDone:false});
    expect(result.receiptRef).toBe('https://github.com/fresh');
    expect(result.upstreamReceiptRef).toBe('https://github.com/stale');
  });

  it.each(['ARCHIVE_ACTIVE_JOB_FORBIDDEN','ARCHIVE_OWNER_INTERACTION_READ_ONLY','ARCHIVE_CONTROLLER_KILLED','ARCHIVE_WORKER_BLOCKED:NV02','SECURITY_BLOCK','ARCHIVE_UI_NOT_IDLE','SAVE_NOT_DURABLE'])(
    'propagates canonical fail-closed guard %s',async(reason)=>{
      const saveAndArchive=vi.fn().mockRejectedValue(new Error(reason));
      await expect(runArchiveCommand('NV02',{receiptRef:'https://github.com/upstream'},{archiveSupported:supported,saveAndArchive})).rejects.toThrow(reason);
    }
  );

  it('rejects incomplete canonical archive results',async()=>{
    const saveAndArchive=vi.fn().mockResolvedValue({ok:true,status:'ARCHIVED',receiptRef:'https://github.com/fresh'});
    await expect(runArchiveCommand('NV02',{receiptRef:'https://github.com/upstream'},{archiveSupported:supported,saveAndArchive})).rejects.toThrow('ARCHIVE_FRESH_DURABLE_RECEIPT_REQUIRED');
  });
});
