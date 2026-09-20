export type ObservedValueType = "string" | "number" | "boolean" | "object" | "array" | "null";

export type SourceFieldObservation = {
  path: string;
  observedTypes: ObservedValueType[];
  occurrences: number;
  nullCount: number;
  arrayItemCount: number | null;
};

export type SourceStructureObservation = {
  rootType: ObservedValueType;
  fields: SourceFieldObservation[];
  policy: "observe_only";
  semanticPolicy: "do_not_infer";
};

function valueType(value: unknown): ObservedValueType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value as ObservedValueType;
}

type MutableObservation = {
  types: Set<ObservedValueType>;
  occurrences: number;
  nullCount: number;
  arrayItemCount: number | null;
};

/**
 * Describes only what is physically present in an unknown source payload.
 * No canonical field names, relations or business meaning are inferred here.
 */
export function observeSourceStructure(source: unknown): SourceStructureObservation {
  const observations = new Map<string, MutableObservation>();

  const recordValue = (path: string, value: unknown) => {
    const type = valueType(value);
    const current = observations.get(path) ?? {
      types: new Set<ObservedValueType>(),
      occurrences: 0,
      nullCount: 0,
      arrayItemCount: null,
    };

    current.types.add(type);
    current.occurrences += 1;
    if (value === null) current.nullCount += 1;
    if (Array.isArray(value)) {
      current.arrayItemCount = (current.arrayItemCount ?? 0) + value.length;
    }
    observations.set(path, current);
  };

  const walk = (value: unknown, path: string) => {
    recordValue(path, value);

    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item, `${path}[]`);
      }
      return;
    }

    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        walk(child, path ? `${path}.${key}` : key);
      }
    }
  };

  if (source && typeof source === "object" && !Array.isArray(source)) {
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      walk(value, key);
    }
  } else {
    walk(source, "$root");
  }

  const fields = [...observations.entries()]
    .map(([path, observation]) => ({
      path,
      observedTypes: [...observation.types].sort(),
      occurrences: observation.occurrences,
      nullCount: observation.nullCount,
      arrayItemCount: observation.arrayItemCount,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  return {
    rootType: valueType(source),
    fields,
    policy: "observe_only",
    semanticPolicy: "do_not_infer",
  };
}
