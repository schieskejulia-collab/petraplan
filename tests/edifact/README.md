# StinoDino – EDIFACT entrance (draft)

**Status:** isolated prototype on `test/edifact-orders-proof`. No production integration, no deployment, no merge to main.

## Purpose
Take a synthetic EDIFACT ORDERS D96A-like fixture through a minimal, read-only entry. Preserve the exact raw input; expose segments and line-level quantities; refuse to infer an order total or grant a release.

Run: `node --test tests/edifact/stinodino-entry.test.mjs`

## Boundaries
- Fixture is **synthetic**, not an independently authenticated real-world order.
- No UNA delimiter detection, escaping/release-character processing, segment group validation, full envelope validation, duplicate control, or standards conformance certification.
- Splitting on apostrophes is deliberately limited to this controlled fixture.
- The `21` qualifier is handled as a test assumption; real-world semantics require verified versioned standard evidence and partner implementation agreements.
- Numeric conversion is only a preliminary syntactic check; units, decimal conventions and business rules are unresolved.
- A `NEEDS_CONFIRMATION` result is expected even for well-formed input, because order-level semantics and release authority are not established.
- The adapter is **not yet connected** to PetraPlan's production bridge or DecisionSnapshot/claim lifecycle.
- No Vercel required for isolated Node tests.

## Next safety gates
1. Verify official EDIFACT D96A ORDERS segment semantics and message envelope rules.
2. Add escaped delimiter handling and complete syntax validation before ingesting external messages.
3. Preserve source addressing, standard version, evidence IDs, and partner-specific implementation agreement.
4. Integrate with existing claim/validation/review safety gates in a separate reviewable change.
5. Run tests and record observed output before calling the proof successful.
