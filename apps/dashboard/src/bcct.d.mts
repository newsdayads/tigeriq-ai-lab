export interface BcctRenderResult {
  ok: boolean;
  html: string | null;
  errors?: string[];
}
export function renderBcctV4(summary: {
  generatedAt: string;
  workOrders: Array<{id: string; goal: string; status: string}>;
}, filter: string, repo: string): BcctRenderResult;
