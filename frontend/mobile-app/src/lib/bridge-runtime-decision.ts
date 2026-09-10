import type { BridgeCapabilityProfile } from "./bridge-capability-profile";

export type BridgeRuntimeDecision = {
  capabilityId: string;
  allowed: boolean;
  reason: "supported" | "unsupported" | "missing_prerequisite";
  missingPrerequisites: string[];
};

export function decideCapabilityAtRuntime(
  profile: BridgeCapabilityProfile,
  capabilityId: string,
  availablePrerequisites: string[] = [],
): BridgeRuntimeDecision {
  const capability = profile.capabilities.find((item) => item.id === capabilityId);

  if (!capability || capability.supported === false) {
    return {
      capabilityId,
      allowed: false,
      reason: "unsupported",
      missingPrerequisites: [],
    };
  }

  const prerequisites = capability.prerequisites ?? [];
  const missingPrerequisites = prerequisites.filter(
    (required) => !availablePrerequisites.includes(required),
  );

  if (missingPrerequisites.length > 0) {
    return {
      capabilityId,
      allowed: false,
      reason: "missing_prerequisite",
      missingPrerequisites,
    };
  }

  return {
    capabilityId,
    allowed: true,
    reason: "supported",
    missingPrerequisites: [],
  };
}
