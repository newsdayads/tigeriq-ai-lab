export const NV07_S6_PINNED_PROPOSAL: Readonly<{workOrderId:number;jobId:string;pullRequestNumber:number;sourceSha:string;outputHash:string;resourceId:string;resourceScope:string}>;
export function readNv07S6NativePreflight(db: {query:(sql:string,args?:unknown[])=>Promise<{rows?:Record<string,unknown>[]}>}|null): Promise<Record<string,unknown>>;
