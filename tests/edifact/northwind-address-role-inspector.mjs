// Read-only identity/locator distinction for existing Address Layer observations.
// This is an inspection view, NOT an address_registry migration or business key proof.
export function inspectAddressRoles({ rootAddress, positions }) {
  if (typeof rootAddress !== 'string' || !rootAddress ||
      !Array.isArray(positions)) return { state: 'BLOCKED_INVALID_INPUT', entries: [] };
  const physical = new Set();
  const candidates = new Set();
  const entries = [];
  for (const position of positions) {
    if (!position || typeof position.sourcePath !== 'string' ||
        !position.sourcePath || typeof position.candidateIdentity !== 'string' ||
        !position.candidateIdentity || position.parentAddress !== rootAddress + '#DetailQuantities') {
      return { state: 'BLOCKED_INVALID_INPUT', entries: [] };
    }
    if (physical.has(position.sourcePath)) {
      return { state: 'BLOCKED_DUPLICATE_LOCATOR', entries: [] };
    }
    if (candidates.has(position.candidateIdentity)) {
      return { state: 'BLOCKED_AMBIGUOUS_IDENTITY', entries: [] };
    }
    physical.add(position.sourcePath);
    candidates.add(position.candidateIdentity);
    entries.push({
      physicalLocator: position.sourcePath,
      logicalIdentityCandidate: position.candidateIdentity,
      identityAuthority: 'unique_in_snapshot_only',
      existingCollectionAddress: position.parentAddress,
      observedValue: position.observedValue,
      stableLogicalAddress: null,
      registryWriteAllowed: false,
    });
  }
  return { state: 'SOURCE_OBSERVATIONS_ONLY', rootAddress, entries,
    persisted: false, releaseAllowed: false };
}

export function compareAddressRoles(before, after) {
  if (before?.state !== 'SOURCE_OBSERVATIONS_ONLY' ||
      after?.state !== 'SOURCE_OBSERVATIONS_ONLY' ||
      before.rootAddress !== after.rootAddress) {
    return { state: 'BLOCKED_UNCOMPARABLE_SNAPSHOTS' };
  }
  const next = new Map(after.entries.map(x => [x.logicalIdentityCandidate, x]));
  const previous = new Map(before.entries.map(x => [x.logicalIdentityCandidate, x]));
  return {
    state: 'CANDIDATE_COMPARISON_ONLY',
    missingCandidates: before.entries.filter(x => !next.has(x.logicalIdentityCandidate))
      .map(x => x.logicalIdentityCandidate),
    addedCandidates: after.entries.filter(x => !previous.has(x.logicalIdentityCandidate))
      .map(x => x.logicalIdentityCandidate),
    movedLocators: before.entries.filter(x => next.has(x.logicalIdentityCandidate) &&
      x.physicalLocator !== next.get(x.logicalIdentityCandidate).physicalLocator)
      .map(x => ({ candidate: x.logicalIdentityCandidate,
        from: x.physicalLocator, to: next.get(x.logicalIdentityCandidate).physicalLocator })),
    changedValues: before.entries.filter(x => next.has(x.logicalIdentityCandidate) &&
      !Object.is(x.observedValue, next.get(x.logicalIdentityCandidate).observedValue))
      .map(x => ({ candidate: x.logicalIdentityCandidate,
        before: x.observedValue, after: next.get(x.logicalIdentityCandidate).observedValue })),
    releaseAllowed: false,
  };
}
