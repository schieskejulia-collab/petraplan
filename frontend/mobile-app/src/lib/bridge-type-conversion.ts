export type ConversionSafety = "safe" | "needs_confirmation" | "blocked";

export type CanonicalType = "string" | "integer" | "decimal" | "date" | "timestamp";

export type ConversionPolicy = {
  sourceField: string;
  targetField: string;
  sourceType: CanonicalType;
  targetType: CanonicalType;
  sourceFormat?: string;
  targetFormat?: string;
  preserveLeadingZeros?: boolean;
  allowLocaleDecimalComma?: boolean;
  allowScientificNotation?: boolean;
  missingMarkers?: readonly string[];
};

export type ConversionAssessment = {
  sourceField: string;
  targetField: string;
  sourceValue: string | null;
  sourceType: CanonicalType;
  targetType: CanonicalType;
  safety: ConversionSafety;
  convertedValue: string | number | null;
  reasons: string[];
  evidence: string[];
  sourcePolicy: "preserve";
  mutationPolicy: "no_auto_fix";
  releaseAuthority: "none";
};

function hasText(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizedMarkers(markers: readonly string[] | undefined): Set<string> {
  return new Set((markers ?? ["", "NULL", "N/A"]).map((entry) => entry.trim().toUpperCase()));
}

function isMissing(value: string | null, markers: readonly string[] | undefined): boolean {
  if (value === null) return true;
  return normalizedMarkers(markers).has(value.trim().toUpperCase());
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function parseDate(value: string, format: string | undefined): string | null {
  if (format === "YYYY-MM-DD") {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const [, y, m, d] = match;
    if (!isCalendarDate(Number(y), Number(m), Number(d))) return null;
    return `${y}-${m}-${d}`;
  }

  if (format === "DD.MM.YYYY") {
    const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!match) return null;
    const [, d, m, y] = match;
    if (!isCalendarDate(Number(y), Number(m), Number(d))) return null;
    return `${y}-${m}-${d}`;
  }

  return null;
}

/**
 * Assesses whether a single source value can be converted without inventing or losing
 * information. It does not mutate source data, auto-correct ambiguous values, or grant
 * business release authority.
 */
export function assessTypeConversion(
  value: string | null,
  policy: ConversionPolicy,
): ConversionAssessment {
  const reasons: string[] = [];
  const evidence: string[] = [
    `sourceType=${policy.sourceType}`,
    `targetType=${policy.targetType}`,
    `sourceFormat=${policy.sourceFormat ?? "<unspecified>"}`,
    `targetFormat=${policy.targetFormat ?? "<unspecified>"}`,
  ];

  if (isMissing(value, policy.missingMarkers)) {
    return {
      sourceField: policy.sourceField,
      targetField: policy.targetField,
      sourceValue: value,
      sourceType: policy.sourceType,
      targetType: policy.targetType,
      safety: "needs_confirmation",
      convertedValue: null,
      reasons: ["Fehlend ist nicht automatisch gleich 0, leerer Text oder ein anderer Ersatzwert."],
      evidence,
      sourcePolicy: "preserve",
      mutationPolicy: "no_auto_fix",
      releaseAuthority: "none",
    };
  }

  const source = value as string;

  if (policy.sourceType === policy.targetType) {
    return {
      sourceField: policy.sourceField,
      targetField: policy.targetField,
      sourceValue: source,
      sourceType: policy.sourceType,
      targetType: policy.targetType,
      safety: "safe",
      convertedValue: source,
      reasons: ["Quell- und Zieltyp sind identisch; keine Typkonvertierung erforderlich."],
      evidence,
      sourcePolicy: "preserve",
      mutationPolicy: "no_auto_fix",
      releaseAuthority: "none",
    };
  }

  if (policy.sourceType === "string" && policy.targetType === "integer") {
    if (!/^[+-]?\d+$/.test(source)) {
      reasons.push("Wert ist kein eindeutig ganzzahliger Text.");
      return blocked(policy, source, reasons, evidence);
    }

    const unsigned = source.replace(/^[+-]/, "");
    if (unsigned.length > 1 && unsigned.startsWith("0") && policy.preserveLeadingZeros !== false) {
      reasons.push("Führende Nullen könnten Teil der Identität oder Darstellung sein.");
      return needsConfirmation(policy, source, reasons, evidence);
    }

    const parsed = Number(source);
    if (!Number.isSafeInteger(parsed)) {
      reasons.push("Ganzzahl liegt außerhalb des sicheren JavaScript-Integerbereichs.");
      return blocked(policy, source, reasons, evidence);
    }

    return safe(policy, source, parsed, ["Ganzzahliges Format ist eindeutig und verlustfrei darstellbar."], evidence);
  }

  if (policy.sourceType === "string" && policy.targetType === "decimal") {
    if (/^[+-]?\d+(\.\d+)?$/.test(source)) {
      const parsed = Number(source);
      if (!Number.isFinite(parsed)) return blocked(policy, source, ["Dezimalwert ist nicht endlich."], evidence);
      return safe(policy, source, parsed, ["Punkt-Dezimalformat ist eindeutig bestätigt."], evidence);
    }

    if (/^[+-]?\d+,\d+$/.test(source)) {
      if (!policy.allowLocaleDecimalComma) {
        return needsConfirmation(
          policy,
          source,
          ["Komma kann Dezimaltrennzeichen oder Teil eines anderen Formats sein; Locale-Regel ist nicht bestätigt."],
          evidence,
        );
      }
      const parsed = Number(source.replace(",", "."));
      return safe(policy, source, parsed, ["Komma-Dezimalformat ist durch die Policy ausdrücklich bestätigt."], evidence);
    }

    if (/^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(source)) {
      if (!policy.allowScientificNotation) {
        return needsConfirmation(policy, source, ["Wissenschaftliche Notation ist technisch lesbar, aber nicht vertraglich bestätigt."], evidence);
      }
      const parsed = Number(source);
      if (!Number.isFinite(parsed)) return blocked(policy, source, ["Wissenschaftliche Notation ergibt keinen endlichen Wert."], evidence);
      return safe(policy, source, parsed, ["Wissenschaftliche Notation ist durch die Policy bestätigt."], evidence);
    }

    return blocked(policy, source, ["Wert entspricht keinem bestätigten Dezimalformat."], evidence);
  }

  if (policy.sourceType === "string" && policy.targetType === "date") {
    if (!hasText(policy.sourceFormat)) {
      return needsConfirmation(policy, source, ["Datumsformat ist nicht explizit bestätigt."], evidence);
    }

    const parsed = parseDate(source, policy.sourceFormat);
    if (!parsed) {
      return blocked(policy, source, ["Wert entspricht keinem gültigen Kalendertag im bestätigten Datumsformat."], evidence);
    }

    if (policy.targetFormat && policy.targetFormat !== "YYYY-MM-DD") {
      return needsConfirmation(policy, source, ["Zielformat ist für die aktuelle sichere Normalisierung nicht bestätigt."], evidence);
    }

    return safe(policy, source, parsed, ["Format und tatsächlicher Kalendertag sind bestätigt."], evidence);
  }

  if (policy.sourceType === "string" && policy.targetType === "timestamp") {
    if (!hasText(policy.sourceFormat)) {
      return needsConfirmation(policy, source, ["Zeitstempel-Format bzw. Zeitzonenregel ist nicht bestätigt."], evidence);
    }

    const timezoneExplicit = /Z$|[+-]\d{2}:\d{2}$/.test(source);
    if (!timezoneExplicit) {
      return needsConfirmation(policy, source, ["Zeitstempel enthält keine eindeutige Zeitzoneninformation."], evidence);
    }

    const parsed = Date.parse(source);
    if (Number.isNaN(parsed)) {
      return blocked(policy, source, ["Zeitstempel ist im bestätigten Format technisch ungültig."], evidence);
    }

    return safe(policy, source, new Date(parsed).toISOString(), ["Zeitstempel besitzt eine explizite Zeitzone und ist eindeutig interpretierbar."], evidence);
  }

  return needsConfirmation(
    policy,
    source,
    ["Für diese Typkombination existiert noch keine ausdrücklich bestätigte verlustfreie Konvertierungsregel."],
    evidence,
  );
}

function safe(
  policy: ConversionPolicy,
  source: string,
  convertedValue: string | number,
  reasons: string[],
  evidence: string[],
): ConversionAssessment {
  return {
    sourceField: policy.sourceField,
    targetField: policy.targetField,
    sourceValue: source,
    sourceType: policy.sourceType,
    targetType: policy.targetType,
    safety: "safe",
    convertedValue,
    reasons,
    evidence,
    sourcePolicy: "preserve",
    mutationPolicy: "no_auto_fix",
    releaseAuthority: "none",
  };
}

function needsConfirmation(
  policy: ConversionPolicy,
  source: string,
  reasons: string[],
  evidence: string[],
): ConversionAssessment {
  return {
    sourceField: policy.sourceField,
    targetField: policy.targetField,
    sourceValue: source,
    sourceType: policy.sourceType,
    targetType: policy.targetType,
    safety: "needs_confirmation",
    convertedValue: null,
    reasons,
    evidence,
    sourcePolicy: "preserve",
    mutationPolicy: "no_auto_fix",
    releaseAuthority: "none",
  };
}

function blocked(
  policy: ConversionPolicy,
  source: string,
  reasons: string[],
  evidence: string[],
): ConversionAssessment {
  return {
    sourceField: policy.sourceField,
    targetField: policy.targetField,
    sourceValue: source,
    sourceType: policy.sourceType,
    targetType: policy.targetType,
    safety: "blocked",
    convertedValue: null,
    reasons,
    evidence,
    sourcePolicy: "preserve",
    mutationPolicy: "no_auto_fix",
    releaseAuthority: "none",
  };
}
