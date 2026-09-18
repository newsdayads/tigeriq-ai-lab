export function validateArchiveCommand(workerId,payload,{archiveSupported}){
  if(!archiveSupported(workerId)) throw new Error(`ARCHIVE_SELECTOR_UNVERIFIED:${workerId}`);
  const upstreamReceiptRef=String(payload?.receiptRef||'');
  if(!upstreamReceiptRef.startsWith('https://github.com/')) throw new Error('ARCHIVE_DURABLE_RECEIPT_REQUIRED');
  return upstreamReceiptRef;
}

export function buildDurableSavePrompt({saveToken}){
  return `lưu [SAVE_RECEIPT:${saveToken}]`;
}

export async function runArchiveCommand(workerId,payload,{archiveSupported,saveAndArchive}){
  const upstreamReceiptRef=validateArchiveCommand(workerId,payload,{archiveSupported});
  // The caller-provided receipt is never sufficient authority to archive.
  // Force the canonical flow to re-check terminal external DONE evidence,
  // create and verify a fresh correlated durable receipt, then re-check guards.
  const result=await saveAndArchive(workerId,{requireDone:true});
  if(result?.ok!==true||result?.status!=='ARCHIVED'||!result?.receiptRef||!result?.checkpointRef||!result?.receiptVerifiedAt)
    throw new Error('ARCHIVE_FRESH_DURABLE_RECEIPT_REQUIRED');
  return {...result,upstreamReceiptRef};
}
