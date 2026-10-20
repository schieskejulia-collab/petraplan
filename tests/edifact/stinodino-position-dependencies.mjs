import { compareStinoDinoRevisions } from './stinodino-revision-comparison.mjs';

export function assessPositionChanges(t0Raw, t1Raw) {
  const comparison = compareStinoDinoRevisions(t0Raw, t1Raw);
  const before = comparison.t0.observations;
  const after = comparison.t1.observations;
  const ids = items => items.map(item => item.lineId);
  const valid = items => ids(items).every(Boolean) && new Set(ids(items)).size === items.length;
  const aligned = valid(before) && valid(after) && before.length === after.length &&
    before.every((item, index) => item.lineId === after[index].lineId);
  if (comparison.assessment === 'BLOCKED_INVALID_INPUT' || !aligned) {
    return { assessment: 'BLOCKED_POSITION_BINDING_UNPROVEN', releaseAllowed: false,
      independenceProven: false, positions: [] };
  }
  return {
    assessment: 'POSITION_OBSERVATIONS_ONLY',
    releaseAllowed: false,
    independenceProven: false,
    positions: after.map((item, index) => ({
      lineId: item.lineId,
      changed: ['value', 'unit', 'qualifier'].some(key => before[index][key] !== item[key]),
      dependencyConfirmed: false,
      releasePreserved: false,
    })),
  };
}
