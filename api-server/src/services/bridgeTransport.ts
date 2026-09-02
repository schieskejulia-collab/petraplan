export type BridgeTransportMode =
  | 'synchronous-read'
  | 'asynchronous-message';

export type BridgeTransportInput = {
  transportId?: string;
  sourceSystem: string;
  targetSystem: string;
  entityType: string;
  mode: BridgeTransportMode;
  schemaVersion: string;
  correlationId: string;
  occurredAt?: string;
  data: Record<string, unknown>;
};

export type BridgeTransportEnvelope = {
  transportId: string;
  sourceSystem: string;
  targetSystem: string;
  entityType: string;
  mode: BridgeTransportMode;
  schemaVersion: string;
  correlationId: string;
  occurredAt?: string;
  data: Record<string, unknown>;
};

export type FieldMapping = Record<string, string>;

function requireText(value: string, fieldName: string): string {
  if (!value.trim()) {
    throw new Error(fieldName + ' is required');
  }

  return value;
}

function assertSchemaVersion(version: string): void {
  const parts = version.split('.');
  if (
    parts.length === 0 ||
    parts.some((part) => !part || !/^[0-9]+$/.test(part))
  ) {
    throw new Error('schemaVersion must contain numeric dot-separated parts');
  }
}

export function createBridgeTransportEnvelope(
  input: BridgeTransportInput,
): BridgeTransportEnvelope {
  const sourceSystem = requireText(input.sourceSystem, 'sourceSystem');
  const targetSystem = requireText(input.targetSystem, 'targetSystem');
  const entityType = requireText(input.entityType, 'entityType');
  const correlationId = requireText(input.correlationId, 'correlationId');

  if (sourceSystem === targetSystem) {
    throw new Error('sourceSystem and targetSystem must differ');
  }

  assertSchemaVersion(input.schemaVersion);

  const transportId =
    input.transportId ??
    [
      input.mode,
      sourceSystem,
      targetSystem,
      entityType,
      correlationId,
    ].join(':');

  return {
    transportId,
    sourceSystem,
    targetSystem,
    entityType,
    mode: input.mode,
    schemaVersion: input.schemaVersion,
    correlationId,
    ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    data: { ...input.data },
  };
}

/**
 * Applies an explicit source-to-target field map without changing the input.
 * Missing source fields fail closed instead of producing silent null values.
 */
export function mapTransportData(
  data: Readonly<Record<string, unknown>>,
  mapping: FieldMapping,
): Record<string, unknown> {
  return Object.entries(mapping).reduce<Record<string, unknown>>(
    (mapped, [sourceField, targetField]) => {
      if (!(sourceField in data)) {
        throw new Error('source field is missing: ' + sourceField);
      }

      mapped[targetField] = data[sourceField];
      return mapped;
    },
    {},
  );
}
