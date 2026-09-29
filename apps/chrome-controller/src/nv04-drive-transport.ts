import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Nv04Request } from './nv03-nv04-coordination.js';
import { parseNv04Result, renderNv04Request, validateNv04Result } from './nv03-nv04-coordination.js';

export class Nv04DriveTransport {
  readonly root: string;
  readonly inbox: string;
  readonly claimed: string;
  readonly processed: string;

  constructor(root: string) {
    this.root = root;
    this.inbox = join(root, 'INBOX');
    this.claimed = join(root, 'CLAIMED');
    this.processed = join(root, 'PROCESSED');
  }

  ensureLayout() {
    for (const path of [this.root, this.inbox, this.claimed, this.processed]) mkdirSync(path, { recursive: true });
  }

  requestFileName(request: Nv04Request) {
    return `REQ_${request.jobId}.md`;
  }

  resultFileName(request: Nv04Request) {
    return `RESULT_${request.jobId}.md`;
  }

  writeNewRequest(request: Nv04Request) {
    this.ensureLayout();
    const path = join(this.inbox, this.requestFileName(request));
    if (!existsSync(path)) writeFileSync(path, renderNv04Request(request), 'utf8');
    return path;
  }

  claimRequest(request: Nv04Request) {
    this.ensureLayout();
    const source = join(this.inbox, this.requestFileName(request));
    const target = join(this.claimed, this.requestFileName(request));
    if (existsSync(target)) return target;
    if (!existsSync(source)) throw new Error('NV04_DRIVE_REQUEST_NOT_FOUND');
    renameSync(source, target);
    return target;
  }

  findResultPath(request: Nv04Request) {
    this.ensureLayout();
    const exact = this.resultFileName(request);
    for (const dir of [this.root, this.claimed]) {
      const path = join(dir, exact);
      if (existsSync(path)) return path;
    }
    const fallback = readdirSync(this.root)
      .filter((name) => /^RESULT_.*\.md$/i.test(name))
      .map((name) => join(this.root, name))
      .find((path) => {
        try {
          const result = parseNv04Result(readFileSync(path, 'utf8'));
          return result.jobId === request.jobId;
        } catch {
          return false;
        }
      });
    return fallback || '';
  }

  readValidatedResult(request: Nv04Request) {
    const path = this.findResultPath(request);
    if (!path) return null;
    const result = parseNv04Result(readFileSync(path, 'utf8'));
    validateNv04Result(request, result);
    return { path, result };
  }

  archiveCompleted(request: Nv04Request, resultPath: string) {
    this.ensureLayout();
    const requestClaimed = join(this.claimed, this.requestFileName(request));
    const requestProcessed = join(this.processed, this.requestFileName(request));
    if (existsSync(requestClaimed) && !existsSync(requestProcessed)) renameSync(requestClaimed, requestProcessed);
    const resultProcessed = join(this.processed, basename(resultPath));
    if (existsSync(resultPath) && !existsSync(resultProcessed)) renameSync(resultPath, resultProcessed);
    return { requestProcessed, resultProcessed };
  }
}
