import {
  assessTypeConversion,
  type ConversionAssessment,
  type ConversionPolicy,
} from "./bridge-type-conversion";

export type CanonicalFieldRule = {
  sourceField: string;
  targetField: string;
  conversion: ConversionPolicy;
  valueMap?: Readonly<Record<string, string>>;
};

export type CanonicalFieldResult = {
  sourceField: string;
  targetField: string;
  sourceValue: string | null;
  mappedValue: string | number | null;
  conversion: ConversionAssessment;
  valueMapApplied: string | null;
  readyForCanonical: boolean;
};

export type CanonicalMappingAssessment = {
  fields: CanonicalFieldResult[];
  canonical: Record<string, string | number | null>;
  readyForCanonical: boolean;
  unresolvedFields: string[];
  blockedFields: string[];
  sourcePolicy: "preserve";
  mutationPolicy: "no_auto_fix";
  releaseAuthority: "none";
  principle: "map_only_after_confirmed_lossless_conversion";
};

/**
 * Builds a canonical representation only from field values whose conversion safety
 * is explicitly SAFE. NEEDS_CONFIRMATION and BLOCKED values remain null in the
 * canonical representation instead of being guessed or auto-corrected.
 *
 * Optional value maps are applied only after the source value is structurally safe.
 * A missing value-map entry is not invented; that field remains unresolved.
 */
export function assessCanonicalMapping(
  source: Readonly<Record<string, string | null>>,
  rules: readonly CanonicalFieldRule[],
): CanonicalMappingAssessment {
  const fields = rules.map((rule): CanonicalFieldResult => {
    const sourceValue = source[rule.sourceField] ?? null;
    const conversion = assessTypeConversion(sourceValue, rule.conversion);

    if (conversion.safety !== "safe") {
      return {
        sourceField: rule.sourceField,
        targetField: rule.targetField,
        sourceValue,
        mappedValue: null,
        conversion,
        valueMapApplied: null,
        readyForCanonical: false,
      };
    }

    if (rule.valueMap) {
      const mapKey = String(sourceValue);
      const mapped = rule.valueMap[mapKey];
      if (mapped === undefined) {
        return {
          sourceField: rule.sourceField,
          targetField: rule.targetField,
          sourceValue,
          mappedValue: null,
          conversion: {
            ...conversion,
            safety: "needs_confirmation",
            convertedValue: null,
            reasons: [
              ...conversion.reasons,
              `Für den Quellwert '${mapKey}' existiert keine bestätigte Value-Map.`,
            ],
          },
          valueMapApplied: null,
          readyForCanonical: false,
        };
      }

      return {
        sourceField: rule.sourceField,
        targetField: rule.targetField,
        sourceValue,
        mappedValue: mapped,
        conversion,
        valueMapApplied: `${mapKey} → ${mapped}`,
        readyForCanonical: true,
      };
    }

    return {
      sourceField: rule.sourceField,
      targetField: rule.targetField,
      sourceValue,
      mappedValue: conversion.convertedValue,
      conversion,
      valueMapApplied: null,
      readyForCanonical: true,
    };
  });

  const canonical: Record<string, string | number | null> = {};
  for (const field of fields) {
    canonical[field.targetField] = field.readyForCanonical ? field.mappedValue : null;
  }

  const unresolvedFields = fields
    .filter(({ conversion, readyForCanonical }) =>
      !readyForCanonical && conversion.safety === "needs_confirmation",
    )
    .map(({ targetField }) => targetField);

  const blockedFields = fields
    .filter(({ conversion }) => conversion.safety === "blocked")
    .map(({ targetField }) => targetField);

  return {
    fields,
    canonical,
    readyForCanonical: fields.every(({ readyForCanonical }) => readyForCanonical),
    unresolvedFields,
    blockedFields,
    sourcePolicy: "preserve",
    mutationPolicy: "no_auto_fix",
    releaseAuthority: "none",
    principle: "map_only_after_confirmed_lossless_conversion",
  };
}
