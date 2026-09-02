export type QueryFilter = {
  infoObject: string;
  restriction: string;
  fromValue?: string;
  toValue?: string;
};

export type QueryStructureElement = {
  elementName: string;
  infoObject?: string;
  formula?: string;
};

export type QueryVariable = {
  name: string;
  infoObject: string;
  variableType: string;
  processingType: string;
  parameter?: string;
};

export type QueryDefinitionInput = {
  queryId: string;
  dataProvider: string;
  filters?: ReadonlyArray<QueryFilter>;
  freeCharacteristics?: ReadonlyArray<string>;
  structures?: ReadonlyArray<QueryStructureElement>;
  variables?: ReadonlyArray<QueryVariable>;
};

export type QueryDefinition = {
  queryId: string;
  dataProvider: string;
  filters: QueryFilter[];
  freeCharacteristics: string[];
  structures: QueryStructureElement[];
  variables: QueryVariable[];
};

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(label + ' is required');
  }

  return normalized;
}

function optional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

/**
 * Creates a normalized, reviewable description of a query definition.
 *
 * This is documentation of the query contract, not a claim about where the
 * underlying data originated or whether the source is reachable live.
 */
export function createQueryDefinition(input: QueryDefinitionInput): QueryDefinition {
  const filters = (input.filters ?? []).map((filter, index) => ({
    infoObject: required(filter.infoObject, 'filters[' + index + '].infoObject'),
    restriction: required(filter.restriction, 'filters[' + index + '].restriction'),
    ...(optional(filter.fromValue) ? { fromValue: optional(filter.fromValue) } : {}),
    ...(optional(filter.toValue) ? { toValue: optional(filter.toValue) } : {}),
  }));

  const freeCharacteristics = (input.freeCharacteristics ?? []).map((value, index) =>
    required(value, 'freeCharacteristics[' + index + ']'),
  );

  const structures = (input.structures ?? []).map((structure, index) => {
    const elementName = required(
      structure.elementName,
      'structures[' + index + '].elementName',
    );
    const infoObject = optional(structure.infoObject);
    const formula = optional(structure.formula);

    if (!infoObject && !formula) {
      throw new Error(
        'structures[' + index + '] requires infoObject or formula',
      );
    }

    return {
      elementName,
      ...(infoObject ? { infoObject } : {}),
      ...(formula ? { formula } : {}),
    };
  });

  const variables = (input.variables ?? []).map((variable, index) => ({
    name: required(variable.name, 'variables[' + index + '].name'),
    infoObject: required(
      variable.infoObject,
      'variables[' + index + '].infoObject',
    ),
    variableType: required(
      variable.variableType,
      'variables[' + index + '].variableType',
    ),
    processingType: required(
      variable.processingType,
      'variables[' + index + '].processingType',
    ),
    ...(optional(variable.parameter)
      ? { parameter: optional(variable.parameter) }
      : {}),
  }));

  return {
    queryId: required(input.queryId, 'queryId'),
    dataProvider: required(input.dataProvider, 'dataProvider'),
    filters,
    freeCharacteristics,
    structures,
    variables,
  };
}
