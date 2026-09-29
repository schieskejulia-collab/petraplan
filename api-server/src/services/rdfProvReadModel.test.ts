import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRdfProvReadModel } from './rdfProvReadModel.js';

test('projects address relations without turning them into semantic truth', () => {
  const result = buildRdfProvReadModel({
    recordId: 'record-1',
    addresses: [
      { id: 'a-order', address: 'NW:A-10305', kind: 'object' },
      { id: 'a-qty', address: 'NW:A-10305#DetailQuantities', kind: 'collection', parent_address_id: 'a-order', source_path: 'orderDetails[].Quantity' },
    ],
  });

  assert.equal(result.mode, 'READ_ONLY_PROJECTION');
  assert.equal(result.rdf.statements.some((s) => s.subject === 'NW:A-10305' && s.predicate === 'pp:contains' && s.object.kind === 'resource' && s.object.value === 'NW:A-10305#DetailQuantities'), true);
  assert.equal(result.rdf.statements.some((s) => s.predicate === 'pp:means'), false);
});

test('keeps claims separate and exposes provenance links', () => {
  const result = buildRdfProvReadModel({
    recordId: 'record-1',
    snapshot: { id: 'snap-1', sourceSystem: 'northwind', observedAt: '2026-09-29T00:00:00Z' },
    claims: [{
      id: 'claim-1',
      subject_address: 'NW:A-10305#MENGE',
      predicate: 'maps_to',
      object_value: 80,
      status: 'UNPROVEN',
      scope_type: 'CASE_ONLY',
      scope_payload: { case: 'A-10305' },
      created_by: 'reviewer-1',
      snapshot_id: 'snap-1',
      candidate_id: 'candidate-1',
    }],
    claimEvidenceLinks: [{
      id: 'link-1',
      claim_id: 'claim-1',
      evidence_reference: 'NW:A-10305#DetailQuantities',
      relation: 'SUPPORTS',
    }],
  });

  assert.equal(result.rdf.statements.some((s) => s.subject === 'pp:claim:claim-1' && s.predicate === 'pp:status' && s.object.kind === 'literal' && s.object.value === 'UNPROVEN'), true);
  assert.equal(result.prov.links.some((l) => l.subject === 'pp:claim:claim-1' && l.predicate === 'prov:wasDerivedFrom' && l.object === 'pp:snapshot:snap-1'), true);
  assert.equal(result.prov.links.some((l) => l.subject === 'pp:claim:claim-1' && l.predicate === 'prov:wasAttributedTo' && l.object === 'pp:agent:reviewer-1'), true);
  assert.equal(result.prov.links.some((l) => l.subject === 'pp:claim:claim-1' && l.predicate === 'prov:wasInfluencedBy' && l.object === 'pp:evidence:NW:A-10305#DetailQuantities'), true);
});

test('does not mutate its input objects', () => {
  const input = {
    recordId: 'record-1',
    addresses: [{ id: 'a1', address: 'NW:A-10305', kind: 'object' }],
    claims: [{ id: 'c1', subject_address: 'NW:A-10305', predicate: 'x', status: 'DRAFT', scope_type: 'CASE_ONLY' }],
  };
  const before = JSON.stringify(input);
  buildRdfProvReadModel(input);
  assert.equal(JSON.stringify(input), before);
});
