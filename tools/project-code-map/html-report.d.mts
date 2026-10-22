/** Portable code-map JSON schema consumed by the offline HTML explorer. */
export interface CodeMapReport {
  schemaVersion: number;
  sourceRevision: string | null;
  rootName: string;
  summary: {
    sourceFiles: number;
    dependencyEdges: number;
    filesWithImports: number;
  };
  nodes: string[];
  edges: Array<{ from: string; to: string }>;
}

export declare function buildHtmlReport(report: CodeMapReport): string;
