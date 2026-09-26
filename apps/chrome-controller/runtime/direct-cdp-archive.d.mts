export type ArchiveRuntimeOptions = Record<string, unknown>;
export declare function validateArchiveCommand(workerId: string, payload: Record<string, unknown>): string;
export declare function doneEvidence(snapshot: unknown, workerId: string): unknown;
export declare function assertArchiveAllowed(workerId: string, options: ArchiveRuntimeOptions): Promise<unknown>;
export declare function buildDurableSavePrompt(input: { saveToken: string; workerId: string; dispatchedAt: string }): string;
export declare function waitForSaveCompletion(uiState: () => Promise<unknown>, options?: ArchiveRuntimeOptions): Promise<void>;
export declare function waitForDurableSaveReceipt(saveToken: string, workerId: string, dispatchedAt: string, options?: ArchiveRuntimeOptions): Promise<unknown>;
export declare function archiveConversation(options: ArchiveRuntimeOptions): Promise<unknown>;
export declare function runDirectCdpArchive(options: ArchiveRuntimeOptions): Promise<any>;
