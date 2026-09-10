import type { IngressContextAssessment } from "./bridge-ingress-context";
import type { AddressingComparisonAssessment } from "./bridge-addressing";
import type { AdapterContractAssessment } from "./bridge-adapter-contract";
import type { CapabilityProfile } from "./bridge-capability-profile";
import type { BridgeRuntimeDecision } from "./bridge-runtime-decision";

export type SourceReadinessCheckId =
  | "readiness.ingress"
  | "readiness.addressing"
  | "readiness.adapter"
  | "readiness.capability_profile"
  | "readiness.runtime_operation";

export type SourceReadinessCheck = {
  id: SourceReadinessCheckId;
  label: string;
  passed: boolean;
  observed: string;
  expected: string;
  safeAction: string;
};

export type SourceReadinessInput = {
  ingress: IngressContextAssessment;
  addressing: AddressingComparisonAssessment;
  adapter: AdapterContractAssessment;
  capabilityProfile: CapabilityProfile;
  runtimeDecision: BridgeRuntimeDecision;
};

export type SourceReadinessAssessment = {
  checks: SourceReadinessCheck[];
  sourceReady: boolean;
  failedCheckIds: SourceReadinessCheckId[];
  sourcePolicy: "preserve";
  writePolicy: "forbidden";
  releaseAuthority: "none";
  interpretationPolicy: "do_not_interpret_until_source_ready";
  principle: "trust_context_address_source_verify_adapter_profile_capabilities_gate_operation_then_interpret";
};

/**
 * Internal readiness gate for public phase 1: Eingang.
 *
 * It intentionally does not add a public phase or override the existing release truth.
 * It only answers whether a concrete source is sufficiently understood and safely
 * readable for PetraPlan to continue into schema, semantics, mapping and validation.
 */
export function assessSourceReadiness(
  input: SourceReadinessInput,
): SourceReadinessAssessment {
  const checks: SourceReadinessCheck[] = [
    {
      id: "readiness.ingress",
      label: "Eingangskontext ist vertrauenswürdig",
      passed: input.ingress.contextTrusted,
      observed: input.ingress.contextTrusted
        ? "trusted"
        : `failed=${input.ingress.failedCheckIds.join(",") || "unknown"}`,
      expected: "contextTrusted=true",
      safeAction: "Keine fachliche Interpretation beginnen, solange Auth, Verbindung, Aktualität, Inhaltstyp oder technische Verifikation offen sind.",
    },
    {
      id: "readiness.addressing",
      label: "Quelle und Datensatz sind eindeutig adressierbar",
      passed: input.addressing.addressingReady,
      observed: input.addressing.addressingReady
        ? "ready"
        : `failed=${input.addressing.failedCheckIds.join(",") || "unknown"}`,
      expected: "addressingReady=true",
      safeAction: "Nicht raten, welcher Datensatz oder Zusammenhang gemeint ist.",
    },
    {
      id: "readiness.adapter",
      label: "Adaptervertrag erlaubt sichere Read-only-Introspection",
      passed: input.adapter.readyForReadIntrospection,
      observed: input.adapter.readyForReadIntrospection
        ? "ready"
        : `failed=${input.adapter.failedCheckIds.join(",") || "unknown"}`,
      expected: "readyForReadIntrospection=true",
      safeAction: "Nur explizit identifizierte und nachweislich read-only-fähige Zugriffswege verwenden.",
    },
    {
      id: "readiness.capability_profile",
      label: "Capability Profile ist für konkrete Operationsprüfungen belastbar",
      passed: input.capabilityProfile.usableForOperationChecks,
      observed: input.capabilityProfile.usableForOperationChecks
        ? "usable"
        : `unresolved=${input.capabilityProfile.unresolvedCapabilities.join(",") || "none"}`,
      expected: "usableForOperationChecks=true",
      safeAction: "Unbekannte oder nur schwach belegte Fähigkeiten nicht als technische Wahrheit übernehmen.",
    },
    {
      id: "readiness.runtime_operation",
      label: "Die konkret angeforderte Leseoperation ist durch das Profil gedeckt",
      passed: input.runtimeDecision.allowedByCapabilities,
      observed: input.runtimeDecision.allowedByCapabilities
        ? `allowed:${input.runtimeDecision.operation}`
        : `blocked:${input.runtimeDecision.failedRequirements.join(",") || input.runtimeDecision.operation}`,
      expected: "allowedByCapabilities=true",
      safeAction: "Nur Operationen ausführen, deren benötigte Fähigkeiten explizit belegt sind.",
    },
  ];

  const failedCheckIds = checks.filter(({ passed }) => !passed).map(({ id }) => id);

  return {
    checks,
    sourceReady: failedCheckIds.length === 0,
    failedCheckIds,
    sourcePolicy: "preserve",
    writePolicy: "forbidden",
    releaseAuthority: "none",
    interpretationPolicy: "do_not_interpret_until_source_ready",
    principle: "trust_context_address_source_verify_adapter_profile_capabilities_gate_operation_then_interpret",
  };
}
