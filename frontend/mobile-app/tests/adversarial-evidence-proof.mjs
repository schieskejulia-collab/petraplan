import assert from 'node:assert/strict';

import {
  classifyStructureEvidence,
  classifyValueEvidence,
} from '../.bridge-evidence-build/bridge-evidence.js';

const documentedNorthwindRelation = classifyStructureEvidence({
  subject: 'order.CustomerID',
  relatedTo: 'customer.CustomerID',
  documentedRelation: true,
  subjectValue: 'VINET',
  relatedValue: 'VINET',
  sourceReference: 'Northwind order/customer relationship',
});
assert.equal(documentedNorthwindRelation.status, 'CONFIRMED');

const contradictedNorthwindRelation = classifyStructureEvidence({
  subject: 'order.CustomerID',
  relatedTo: 'customer.CustomerID',
  documentedRelation: true,
  subjectValue: 'VINET',
  relatedValue: 'ALFKI',
  sourceReference: 'Northwind order/customer relationship',
});
assert.equal(contradictedNorthwindRelation.status, 'CONTRADICTED');

const adversarialNameMatch = classifyStructureEvidence({
  subject: 'order.EmployeeID',
  relatedTo: 'customer.EmployeeID',
  documentedRelation: false,
  subjectValue: 5,
  relatedValue: 5,
  sourceReference: null,
});
assert.equal(adversarialNameMatch.status, 'UNPROVEN');
assert.equal(adversarialNameMatch.reason.includes('Namens- oder Wertähnlichkeit'), true);

const unprovenStatus = classifyValueEvidence({
  field: 'STATUS',
  sourceValue: '',
  confirmedMapping: null,
  sourceReference: null,
});
assert.equal(unprovenStatus.status, 'UNPROVEN');

const confirmedStatus = classifyValueEvidence({
  field: 'STATUS',
  sourceValue: 'OFFEN',
  confirmedMapping: 'open',
  sourceReference: 'order-v1 status value map',
});
assert.equal(confirmedStatus.status, 'CONFIRMED');
assert.equal(confirmedStatus.canonicalValue, 'open');

// The core invariant: structural confirmation must never manufacture value meaning.
assert.equal(documentedNorthwindRelation.status, 'CONFIRMED');
assert.equal(unprovenStatus.status, 'UNPROVEN');

const proof = {
  proof: 'adversarial-evidence-proof-v1',
  invariant: 'connected != same meaning',
  cases: {
    documentedRelation: documentedNorthwindRelation,
    contradictedRelation: contradictedNorthwindRelation,
    deceptiveNameAndValueMatch: adversarialNameMatch,
    unprovenStatusMeaning: unprovenStatus,
    confirmedStatusMeaning: confirmedStatus,
  },
};

console.log(JSON.stringify(proof, null, 2));
