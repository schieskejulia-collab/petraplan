import assert from 'node:assert/strict';
import { read, seedAtomicReviewFixture } from './atomic-review-fixture.mjs';
import { installTrustedEvidenceFixture } from './trusted-evidence-fixture.mjs';

export async function installInvoiceCaseFixture(db) {
  await installTrustedEvidenceFixture(db);
  const releaseMigration = await read('../../supabase/migrations/20261002141136_chinch64_claim_freshness_guard.sql');
  // The rest of this older migration is already represented in the observed
  // fixture. Install the release RPC without replaying its schema changes.
  const releaseStart = releaseMigration.indexOf('create or replace function public.bridge_release_case(');
  assert.ok(releaseStart >= 0);
  await db.exec(releaseMigration.slice(releaseStart));
  // The observed review fixture omits resolution actions. Mirror the columns
  // used by the existing ingest writer and keep its foreign key to conflicts.
  await db.exec(`create table public.resolution_actions (
    id uuid primary key default gen_random_uuid(), conflict_id uuid not null references public.conflicts(id),
    action_type text not null, action_payload jsonb not null, actor_type text not null,
    actor_id text not null, reason text not null
  ); grant all on public.resolution_actions to service_role;`);
  await db.exec(await read('../../supabase/migrations/20261117100000_invoice_case_evidence.sql'));
  const observed = JSON.parse(await read('../../docs/verification/2026-10-26-original-schema-observations.json'));
  const truthGate = observed.triggers.find(trigger => trigger.function === 'enforce_release_truth_gate');
  await db.exec(`create schema extensions;
    create function extensions.digest(value text, algorithm text) returns bytea
    language sql immutable as 'select sha256(convert_to(value, ''UTF8''))';
    grant usage on schema extensions to service_role;`);
  await db.exec(truthGate.body);
  await db.exec(truthGate.definition);
  await seedAtomicReviewFixture(db);
}
