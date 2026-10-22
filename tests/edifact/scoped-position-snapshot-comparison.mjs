// Synthetic read-only comparison. Requires caller-supplied identity scope;
// it does NOT establish a universal Northwind primary key or source authenticity.
const valid = value => typeof value === 'string' && value.trim().length > 0;

export function compareScopedPositionSnapshots(before, after) {
  if (![before, after].every(s => s?.state === 'SOURCE_OBSERVATIONS_ONLY' &&
      valid(s.systemId) && valid(s.environmentId) && valid(s.sourceId) &&
      valid(s.snapshotId) && valid(s.rootAddress) && Array.isArray(s.entries))) {
    return { state: 'BLOCKED_MISSING_SCOPE' };
  }
  const scope = s => [s.systemId, s.environmentId, s.sourceId, s.rootAddress];
  if (JSON.stringify(scope(before)) !== JSON.stringify(scope(after))) {
    return { state: 'BLOCKED_SCOPE_MISMATCH' };
  }
  if (before.snapshotId === after.snapshotId) {
    return { state: 'BLOCKED_SNAPSHOT_REUSE' };
  }
  for (const s of [before, after]) {
    const ids = new Set();
    const locators = new Set();
    for (const e of s.entries) {
      if (!valid(e.logicalIdentityCandidate) || !valid(e.physicalLocator) ||
          e.identityAuthority !== 'unique_in_snapshot_only' ||
          e.stableLogicalAddress !== null || e.registryWriteAllowed !== false) {
        return { state: 'BLOCKED_UNVERIFIED_IDENTITY' };
      }
      if (ids.has(e.logicalIdentityCandidate) || locators.has(e.physicalLocator)) {
        return { state: 'BLOCKED_AMBIGUOUS_IDENTITY' };
      }
      ids.add(e.logicalIdentityCandidate);
      locators.add(e.physicalLocator);
    }
  }
  const oldMap = new Map(before.entries.map(e => [e.logicalIdentityCandidate, e]));
  const newMap = new Map(after.entries.map(e => [e.logicalIdentityCandidate, e]));
  return {
    state: 'SCOPED_CANDIDATE_COMPARISON_ONLY',
    scope: { systemId: before.systemId, environmentId: before.environmentId,
      sourceId: before.sourceId, rootAddress: before.rootAddress },
    fromSnapshotId: before.snapshotId,
    toSnapshotId: after.snapshotId,
    missingCandidates: [...oldMap.keys()].filter(k => !newMap.has(k)),
    addedCandidates: [...newMap.keys()].filter(k => !oldMap.has(k)),
    movedCandidates: [...oldMap.keys()].filter(k => newMap.has(k) &&
      oldMap.get(k).physicalLocator !== newMap.get(k).physicalLocator),
    changedCandidates: [...oldMap.keys()].filter(k => newMap.has(k) &&
      !Object.is(oldMap.get(k).observedValue, newMap.get(k).observedValue)),
    authority: 'unverified_synthetic_fixture',
    persisted: false,
    releaseAllowed: false,
  };
}
