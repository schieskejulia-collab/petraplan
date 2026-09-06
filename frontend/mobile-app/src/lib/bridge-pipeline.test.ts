import { describe, expect, it } from "vitest";
import {
  demoConflictRecord,
  demoValidRecord,
  evaluateRecord,
  type RawRecord,
} from "./bridge-pipeline";

const capturedAt = "2026-09-06";

describe("A-10027 reference case stays internally consistent", () => {
  it("blocks the combined conflict case everywhere", () => {
    const result = evaluateRecord(demoConflictRecord, capturedAt);

    expect(result.raw.STATUS).toBe("UNBEKANNT");
    expect(result.raw.MENGE).toBe("-4");
    expect(result.mapped.status).toBeNull();
    expect(result.mapped.quantity).toBe(-4);
    expect(result.passed).toBe(false);
    expect(result.provenance.overallStatus).toBe("needs_review");
    expect(result.report.releaseStatus).toBe("blocked");
    expect(result.report.openPoints).toHaveLength(2);
    expect(result.report.rows.find((row) => row.source.startsWith("STATUS"))?.status).toBe("unresolved");
    expect(result.report.rows.find((row) => row.source.startsWith("MENGE"))?.status).toBe("rule_violation");
  });

  it("verifies the valid case everywhere", () => {
    const result = evaluateRecord(demoValidRecord, capturedAt);

    expect(result.raw.STATUS).toBe("OFFEN");
    expect(result.raw.MENGE).toBe("12");
    expect(result.mapped.status).toBe("open");
    expect(result.mapped.quantity).toBe(12);
    expect(result.passed).toBe(true);
    expect(result.provenance.overallStatus).toBe("valid");
    expect(result.report.releaseStatus).toBe("verified");
    expect(result.report.openPoints).toEqual([]);
    expect(result.report.rows.every((row) => row.status === "confirmed")).toBe(true);
  });

  it("blocks an unknown status even when every other field is valid", () => {
    const raw: RawRecord = { ...demoValidRecord, STATUS: "UNBEKANNT" };
    const result = evaluateRecord(raw, capturedAt);

    expect(result.mapped.status).toBeNull();
    expect(result.passed).toBe(false);
    expect(result.report.releaseStatus).toBe("blocked");
    expect(result.report.openPoints).toHaveLength(1);
    expect(result.report.rows.find((row) => row.source.startsWith("STATUS"))?.status).toBe("unresolved");
  });

  it("blocks a negative quantity without changing its source or mapped value", () => {
    const raw: RawRecord = { ...demoValidRecord, MENGE: "-4" };
    const result = evaluateRecord(raw, capturedAt);

    expect(result.raw.MENGE).toBe("-4");
    expect(result.mapped.quantity).toBe(-4);
    expect(result.passed).toBe(false);
    expect(result.report.releaseStatus).toBe("blocked");
    expect(result.report.openPoints).toHaveLength(1);
    expect(result.report.rows.find((row) => row.source.startsWith("MENGE"))?.status).toBe("rule_violation");
    expect(result.report.sourceModified).toBe(false);
  });
});
