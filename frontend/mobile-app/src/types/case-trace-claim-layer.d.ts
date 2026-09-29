import "@/api/connector";

declare module "@/api/connector" {
  interface CaseTrace {
    claim_layer?: {
      claims: Array<Record<string, unknown>>;
      evidence_links: Array<Record<string, unknown>>;
    };
  }
}

export {};
