import {
  assessOperationAgainstProfile,
  type CapabilityProfile,
  type OperationCapabilityAssessment,
  type OperationRequirement,
} from "./bridge-capability-profile";

export type BridgeRuntimeDecision = {
  operation: string;
  allowedByCapabilities: boolean;
  failedRequirements: string[];
  evidence: string[];
  sourcePolicy: "preserve";
  releaseAuthority: "none";
};

/**
 * Runtime gate for technical operations.
 *
 * This delegates capability truth to the previously built CapabilityProfile instead
 * of re-interpreting driver/database behavior at runtime. It deliberately does not
 * grant business release authority and never changes the connected source.
 */
export function decideRuntimeOperation(
  profile: CapabilityProfile,
  operation: string,
  requirements: readonly OperationRequirement[],
): BridgeRuntimeDecision {
  const assessment: OperationCapabilityAssessment = assessOperationAgainstProfile(
    profile,
    operation,
    requirements,
  );

  return {
    operation: assessment.operation,
    allowedByCapabilities: assessment.allowedByProfile,
    failedRequirements: [...assessment.failedRequirements],
    evidence: [...assessment.evidence],
    sourcePolicy: "preserve",
    releaseAuthority: "none",
  };
}
