import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Exercise the real migration trigger against an isolated PostgreSQL engine.
// The existing revocation routine is represented by a fixture that records
// the call; this does not certify production Supabase integration.
test('negative semantic decision reaches case-level revocation without a Claim rule link', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create table public.semantic_rule_versions (
        id uuid primary key, record_id uuid not null, claim_id uuid not null
      );
      create table public.semantic_rule_decisions (
        id uuid primary key, rule_version_id uuid not null,
        decision text not null, actor_id uuid not null
      );
      create table public.test_revocations (
        record_id uuid, claim_id uuid, actor text, change_reason text
      );
      create function public.bridge_revoke_release_for_claim_change(
        p_record_id uuid, p_claim_id uuid, p_actor text, p_change text
      ) returns void language plpgsql as $$
      begin
        insert into public.test_revocations values
          (p_record_id, p_claim_id, p_actor, p_change);
      end;
      $$;
    `);
    const sql = await readFile(new URL('../../supabase/migrations/20261019100500_semantic_rule_case_release_guard.sql', import.meta.url), 'utf8');
    await db.exec(sql);
    const record = '00000000-0000-4000-8000-000000000001';
    const claim = '00000000-0000-4000-8000-000000000002';
    const version = '00000000-0000-4000-8000-000000000003';
    const actor = '00000000-0000-4000-8000-000000000004';
    await db.query('insert into public.semantic_rule_versions values ($1,$2,$3)', [version,record,claim]);
    // No Claim rule_id or rule_version exists in this fixture.
    await db.query('insert into public.semantic_rule_decisions values ($1,$2,$3,$4)',
      ['00000000-0000-4000-8000-000000000005',version,'APPROVED',actor]);
    assert.equal((await db.query('select count(*)::int as n from public.test_revocations')).rows[0].n,0);
    await db.query('insert into public.semantic_rule_decisions values ($1,$2,$3,$4)',
      ['00000000-0000-4000-8000-000000000006',version,'REVOKED',actor]);
    const rows = (await db.query('select * from public.test_revocations')).rows;
    assert.equal(rows.length,1);
    assert.equal(rows[0].record_id,record);
    assert.equal(rows[0].claim_id,claim);
    assert.equal(rows[0].actor,actor);
    assert.equal(rows[0].change_reason,'semantic_rule_decisions:REVOKED');
    await db.query('insert into public.semantic_rule_decisions values ($1,$2,$3,$4)',
      ['00000000-0000-4000-8000-000000000007',version,'SUPERSEDED',actor]);
    assert.equal((await db.query('select count(*)::int as n from public.test_revocations')).rows[0].n,2);
  } finally {
    await db.close();
  }
});
