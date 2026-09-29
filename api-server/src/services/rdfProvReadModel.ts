export type RdfObject =
  | { kind: 'resource'; value: string }
  | { kind: 'literal'; value: unknown };

export type RdfStatement = {
  subject: string;
  predicate: string;
  object: RdfObject;
  evidence_basis: string;
};

export type ProvLink = {
  subject: string;
  predicate:
    | 'prov:wasDerivedFrom'
    | 'prov:wasAttributedTo'
    | 'prov:wasInfluencedBy'
    | 'prov:wasGeneratedBy';
  object: string;
  evidence_basis: string;
};

export type RdfProvInput = {
  recordId: string;
  snapshot?: {
    id?: string | null;
    sourceSystem?: string | null;
    observedAt?: string | null;
  } | null;
  addresses?: Array<Record<string, unknown>>;
  candidates?: Array<Record<string, unknown>>;
  impactLinks?: Array<Record<string, unknown>>;
  claims?: Array<Record<string, unknown>>;
  claimEvidenceLinks?: Array<Record<string, unknown>>;
};

export type RdfProvReadModel = {
  mode: 'READ_ONLY_PROJECTION';
  record_id: string;
  rdf: {
    statements: RdfStatement[];
  };
  prov: {
    links: ProvLink[];
  };
  guard_rails: string[];
};

function resource(value: unknown): RdfObject {
  return { kind: 'resource', value: String(value) };
}

function literal(value: unknown): RdfObject {
  return { kind: 'literal', value };
}

/**
 * Build a read-only RDF/PROV-O-shaped projection from truth already persisted by PetraPlan.
 *
 * Important boundaries:
 * - this function does not create new source facts;
 * - technical/address relations stay technical relations;
 * - candidates remain candidates and claims remain claims;
 * - provenance describes origin/influence, not truth;
 * - no candidate, validation, review or release state is changed.
 */
export function buildRdfProvReadModel(input: RdfProvInput): RdfProvReadModel {
  const statements: RdfStatement[] = [];
  const prov: ProvLink[] = [];

  const addresses = input.addresses ?? [];
  const candidates = input.candidates ?? [];
  const impactLinks = input.impactLinks ?? [];
  const claims = input.claims ?? [];
  const evidenceLinks = input.claimEvidenceLinks ?? [];

  const addressById = new Map(addresses.map((a) => [String(a.id ?? ''), a]));

  // Address registry: identity and parent/child structure only.
  for (const address of addresses) {
    const addressValue = String(address.address ?? '');
    if (!addressValue) continue;

    statements.push({
      subject: addressValue,
      predicate: 'rdf:type',
      object: resource(`pp:${String(address.kind ?? 'Address')}`),
      evidence_basis: `address_registry:${String(address.id ?? addressValue)}`,
    });

    if (address.source_path) {
      statements.push({
        subject: addressValue,
        predicate: 'pp:sourcePath',
        object: literal(address.source_path),
        evidence_basis: `address_registry:${String(address.id ?? addressValue)}`,
      });
    }

    const parent = addressById.get(String(address.parent_address_id ?? ''));
    if (parent?.address) {
      statements.push({
        subject: String(parent.address),
        predicate: 'pp:contains',
        object: resource(addressValue),
        evidence_basis: `address_registry:${String(address.id ?? addressValue)}`,
      });
    }
  }

  // Candidates are possible interpretations, not asserted semantic truth.
  // Their provenance is nevertheless projectable from already persisted candidate metadata.
  const candidateById = new Map(candidates.map((c) => [String(c.id ?? ''), c]));
  for (const candidate of candidates) {
    const candidateId = String(candidate.id ?? '');
    if (!candidateId) continue;
    const candidateResource = `pp:candidate:${candidateId}`;
    const candidateBasis = `conversion_candidates:${candidateId}`;

    statements.push({
      subject: candidateResource,
      predicate: 'rdf:type',
      object: resource('pp:ClaimCandidate'),
      evidence_basis: candidateBasis,
    });
    statements.push({
      subject: candidateResource,
      predicate: 'pp:state',
      object: literal(candidate.state ?? 'candidate'),
      evidence_basis: candidateBasis,
    });

    const sourceAddress = addressById.get(String(candidate.source_address_id ?? ''));
    if (sourceAddress?.address) {
      const sourceAddressValue = String(sourceAddress.address);
      statements.push({
        subject: candidateResource,
        predicate: 'pp:observedAtAddress',
        object: resource(sourceAddressValue),
        evidence_basis: candidateBasis,
      });
      prov.push({
        subject: candidateResource,
        predicate: 'prov:wasDerivedFrom',
        object: sourceAddressValue,
        evidence_basis: candidateBasis,
      });
    }

    const candidateSnapshotId = String(candidate.snapshot_id ?? input.snapshot?.id ?? '');
    if (candidateSnapshotId) {
      prov.push({
        subject: candidateResource,
        predicate: 'prov:wasDerivedFrom',
        object: `pp:snapshot:${candidateSnapshotId}`,
        evidence_basis: candidateBasis,
      });
    }

    const conversionKind = String(candidate.conversion_kind ?? 'candidate-detection');
    prov.push({
      subject: candidateResource,
      predicate: 'prov:wasGeneratedBy',
      object: `pp:activity:${conversionKind}`,
      evidence_basis: candidateBasis,
    });

    if (candidate.evidence) {
      const candidateEvidenceResource = `pp:evidence:candidate:${candidateId}`;
      statements.push({
        subject: candidateEvidenceResource,
        predicate: 'rdf:type',
        object: resource('pp:CandidateEvidence'),
        evidence_basis: candidateBasis,
      });
      statements.push({
        subject: candidateEvidenceResource,
        predicate: 'pp:evidenceText',
        object: literal(candidate.evidence),
        evidence_basis: candidateBasis,
      });
      prov.push({
        subject: candidateResource,
        predicate: 'prov:wasInfluencedBy',
        object: candidateEvidenceResource,
        evidence_basis: candidateBasis,
      });
    }
  }

  for (const link of impactLinks) {
    const candidate = candidateById.get(String(link.candidate_id ?? ''));
    const address = addressById.get(String(link.address_id ?? ''));
    if (!candidate?.id || !address?.address) continue;
    statements.push({
      subject: `pp:candidate:${String(candidate.id)}`,
      predicate: 'pp:mayImpact',
      object: resource(String(address.address)),
      evidence_basis: `impact_links:${String(link.id ?? `${candidate.id}:${address.id}`)}`,
    });
  }

  // Claims remain explicit assertions. Their predicate/object are represented as claim content,
  // not silently promoted into the observed RDF graph.
  for (const claim of claims) {
    const claimId = String(claim.id ?? '');
    if (!claimId) continue;
    const claimResource = `pp:claim:${claimId}`;

    statements.push({
      subject: claimResource,
      predicate: 'rdf:type',
      object: resource('pp:Claim'),
      evidence_basis: `claims:${claimId}`,
    });
    statements.push({
      subject: claimResource,
      predicate: 'pp:subjectAddress',
      object: resource(String(claim.subject_address ?? claim.field_address ?? 'unknown')),
      evidence_basis: `claims:${claimId}`,
    });
    statements.push({
      subject: claimResource,
      predicate: 'pp:claimPredicate',
      object: literal(claim.predicate ?? null),
      evidence_basis: `claims:${claimId}`,
    });
    statements.push({
      subject: claimResource,
      predicate: 'pp:claimObject',
      object: literal(claim.object_value ?? null),
      evidence_basis: `claims:${claimId}`,
    });
    statements.push({
      subject: claimResource,
      predicate: 'pp:status',
      object: literal(claim.status ?? null),
      evidence_basis: `claims:${claimId}`,
    });
    statements.push({
      subject: claimResource,
      predicate: 'pp:scope',
      object: literal({ type: claim.scope_type ?? null, payload: claim.scope_payload ?? {} }),
      evidence_basis: `claims:${claimId}`,
    });

    if (claim.created_by) {
      prov.push({
        subject: claimResource,
        predicate: 'prov:wasAttributedTo',
        object: `pp:agent:${String(claim.created_by)}`,
        evidence_basis: `claims:${claimId}`,
      });
    }
    if (claim.candidate_id) {
      prov.push({
        subject: claimResource,
        predicate: 'prov:wasGeneratedBy',
        object: `pp:candidate-decision:${String(claim.candidate_id)}`,
        evidence_basis: `claims:${claimId}`,
      });
    }
    if (claim.snapshot_id) {
      prov.push({
        subject: claimResource,
        predicate: 'prov:wasDerivedFrom',
        object: `pp:snapshot:${String(claim.snapshot_id)}`,
        evidence_basis: `claims:${claimId}`,
      });
    }
  }

  for (const link of evidenceLinks) {
    const claimId = String(link.claim_id ?? '');
    const evidenceReference = String(link.evidence_reference ?? '');
    if (!claimId || !evidenceReference) continue;

    const relation = String(link.relation ?? '').toUpperCase();
    prov.push({
      subject: `pp:claim:${claimId}`,
      predicate: relation === 'DERIVED_FROM' ? 'prov:wasDerivedFrom' : 'prov:wasInfluencedBy',
      object: `pp:evidence:${evidenceReference}`,
      evidence_basis: `claim_evidence_links:${String(link.id ?? `${claimId}:${evidenceReference}`)}`,
    });
  }

  if (input.snapshot?.id) {
    statements.push({
      subject: `pp:snapshot:${String(input.snapshot.id)}`,
      predicate: 'rdf:type',
      object: resource('prov:Entity'),
      evidence_basis: `ingestion_logs:${String(input.snapshot.id)}`,
    });
    if (input.snapshot.sourceSystem) {
      statements.push({
        subject: `pp:snapshot:${String(input.snapshot.id)}`,
        predicate: 'pp:sourceSystem',
        object: literal(input.snapshot.sourceSystem),
        evidence_basis: `ingestion_logs:${String(input.snapshot.id)}`,
      });
    }
    if (input.snapshot.observedAt) {
      statements.push({
        subject: `pp:snapshot:${String(input.snapshot.id)}`,
        predicate: 'prov:generatedAtTime',
        object: literal(input.snapshot.observedAt),
        evidence_basis: `ingestion_logs:${String(input.snapshot.id)}`,
      });
    }
  }

  return {
    mode: 'READ_ONLY_PROJECTION',
    record_id: input.recordId,
    rdf: { statements },
    prov: { links: prov },
    guard_rails: [
      'RDF projection is a read model, not a new truth layer.',
      'Technical relations do not imply business semantics.',
      'Candidates remain candidates; claims remain claims.',
      'PROV-O-shaped links describe origin/influence, not correctness.',
      'No candidate, validation, review or release state is mutated.',
    ],
  };
}
