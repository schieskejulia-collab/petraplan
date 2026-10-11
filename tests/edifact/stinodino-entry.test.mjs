import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectEdifactOrders } from './stinodino-entry.mjs';
const fixture = "UNH+1+ORDERS:D:96A:UN'BGM+220+STINODINO-001+9'LIN+1++4000862141404:EN'QTY+21:48'LIN+2++4000862141411:EN'QTY+21:12'UNT+7+1'";
test('preserves source and does not release unconfirmed total', () => {
 const r=inspectEdifactOrders(fixture); assert.equal(r.rawSource,fixture); assert.equal(r.lines.length,2);
 assert.equal(r.lines[0].quantities[0].rawValue,'48'); assert.equal(r.lines[1].quantities[0].rawValue,'12');
 assert.equal(r.releaseAllowed,false); assert.equal(r.state,'NEEDS_CONFIRMATION');
});
test('blocks invalid quantity',()=>{const r=inspectEdifactOrders(fixture.replace('QTY+21:48','QTY+21:ABC'));assert.equal(r.state,'BLOCKED');});
test('blocks orphan quantity',()=>{const r=inspectEdifactOrders("UNH+1+ORDERS:D:96A:UN'QTY+21:48'UNT+3+1'");assert.equal(r.state,'BLOCKED');});
test('blocks incorrect UNT count',()=>{const r=inspectEdifactOrders(fixture.replace('UNT+7+1','UNT+6+1'));assert.ok(r.findings.some(f=>f.code==='UNT_MISMATCH'));assert.equal(r.state,'BLOCKED');});
test('respects escaped apostrophe in a segment',()=>{const r=inspectEdifactOrders(fixture.replace('STINODINO-001','STINO?\'DINO'));assert.equal(r.segments.length,7);assert.equal(r.state,'NEEDS_CONFIRMATION');});
test('reports unknown segments without granting release',()=>{const r=inspectEdifactOrders(fixture.replace("UNT+7+1","XYZ+ABC'UNT+8+1"));assert.ok(r.findings.some(f=>f.code==='UNKNOWN_SEGMENT'));assert.equal(r.releaseAllowed,false);});
test('rejects unsupported UNA',()=>{const r=inspectEdifactOrders("UNA:+.? '"+fixture);assert.equal(r.state,'BLOCKED');assert.ok(r.findings.some(f=>f.code==='UNSUPPORTED_UNA'));});
