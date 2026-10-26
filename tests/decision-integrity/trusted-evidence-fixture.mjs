import {createHash} from 'node:crypto';
import {ids,id,read,review,sourceHash,installAtomicReviewFixture,seedAtomicReviewFixture,seedCandidate,claim} from './atomic-review-fixture.mjs';
export {ids,id};
export const documentText='For this fixture only, quantity means the recorded item count.\n';
export const documentBytes=Buffer.from(documentText);
export const evidenceSourceId=id(120),authorityId=id(110);
export const meaningCriteria={actual_content_read:true,meaning_checked:true,scope_checked:true,conditions_and_exceptions_checked:true,counterexamples_checked:true,coverage_checked:true};
export const ruleCriteria={identities_checked:true,meaning_evidence_checked:true,source_coverage_checked:true,counterexamples_checked:true,scope_checked:true};

export async function installTrustedEvidenceFixture(db) {
 await installAtomicReviewFixture(db);
 await db.exec(await read('../../supabase/migrations/20261006121534_semantic_rule_governance.sql'));
 await db.exec(await read('../../supabase/migrations/20261019100500_semantic_rule_case_release_guard.sql'));
 await db.exec(await read('../../supabase/migrations/20261026171407_trusted_source_evidence.sql'));
}
export async function seedTrustedEvidenceFixture(db,options={}) {
 await seedAtomicReviewFixture(db);
 const candidate=await seedCandidate(db);
 const claimResult=(await claim(db,candidate)).rows[0].result;
 await db.query(`insert into public.semantic_rule_authorities(id,user_id,record_id,snapshot_id,target_address,role_name,authority_reference,granted_by,granted_at,valid_until)
 values($1,$2,$3,$4,$5,'fixture_domain_reviewer','fixture-authority:explicit-scope',$2,clock_timestamp()-interval '1 hour',clock_timestamp()+($6||' seconds')::interval)`,
 [authorityId,ids.actor,ids.record,ids.snapshot,candidate.address,String(options.authoritySeconds??3600)]);
 const definition={question:'What does quantity mean in the pinned source?',condition:'The source explicitly defines this recorded quantity.',conclusion:'The quantity represents the recorded item count.',justification:'A scoped human must verify the actual source text.',
  evidence:[{kind:'MEANING',reference:'fixture-source-v1',summary:'A proposed source reference; no verified source record yet.'}],limitations:[],exceptions:[],unresolved_items:[]};
 const rule=(await db.query('select public.bridge_propose_semantic_rule($1,$2,$3,$4,$5) r',[ids.record,claimResult.claim_id,ids.actor,definition,null])).rows[0].r;
 await db.query('select public.bridge_decide_semantic_rule($1,$2,$3,$4,$5,$6,$7)',[ids.record,rule.id,ids.actor,authorityId,'APPROVED','Explicit scoped rule catalogue review',ruleCriteria]);
 await db.query(`insert into public.trusted_evidence_sources(id,source_key,revision,source_url,version_reference,authority_reference,expected_sha256,media_type,max_bytes,max_age_seconds,registered_by,valid_from,valid_until)
 values($1,'fixture-meaning',1,'https://evidence.example/spec/v1.txt','fixture-v1','fixture-root:admin-approved',$2,'text/plain',1024,$3,$4,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day')`,
 [evidenceSourceId,createHash('sha256').update(documentBytes).digest('hex'),options.maxAgeSeconds??3600,ids.actor]);
 return {candidate,claimId:claimResult.claim_id,rule};
}
export async function verify(db,context,overrides={}) {
 return db.query('select public.bridge_record_source_verification($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result',[
  overrides.source??evidenceSourceId,overrides.record??ids.record,overrides.snapshot??ids.snapshot,context.rule.id,overrides.actor??ids.actor,
  overrides.hex??documentBytes.toString('hex'),overrides.mediaType??'text/plain','93.184.216.34','b'.repeat(64),overrides.startedAt??new Date().toISOString(),
 ]);
}
export async function assess(db,verification,overrides={}) {
 return db.query('select public.bridge_assess_verified_evidence($1,$2,$3,$4,$5,$6,$7,$8,$9) result',[
  verification,overrides.actor??ids.actor,overrides.authority??authorityId,overrides.decision??'SUPPORTS',
  overrides.reason??'Explicit review of the actual pinned source text',overrides.coverage??'COMPLETE',
  overrides.coverageReason??'The complete fixture definition and its limits were inspected',
  overrides.anchor??{byte_start:0,byte_end:documentBytes.length,excerpt:documentText},overrides.criteria??meaningCriteria,
 ]);
}
export async function check(db,context) {
 return (await db.query('select public.bridge_check_verified_evidence($1,$2,$3) result',[ids.record,context.rule.id,ids.actor])).rows[0].result;
}
export async function withdraw(db,kind,target,overrides={}) {
 return db.query('select public.bridge_withdraw_evidence($1,$2,$3,$4,$5) result',[
  kind,target,overrides.actor??ids.actor,'Explicit withdrawal of the documented evidence basis',overrides.authority??(kind==='assessment'?authorityId:null),
 ]);
}

/** Explicit synthetic T0 precondition: an earlier human-confirmed Claim and
 * usable legacy certificate. The evidence reader never performs this update. */
export async function issueEvidenceFixtureCertificate(db) {
 await db.query(`update public.claims set status='CONFIRMED',confirmed_by=$1,confirmed_at=clock_timestamp(),
  confirmer_role='fixture_domain_reviewer',confirmation_reason='Explicit synthetic T0 precondition'`,[ids.actor]);
 await db.exec('update public.validation_results set created_at=clock_timestamp()');
 const result=(await review(db)).rows[0].result;
 const session=(await db.query('select review_record_id from public.review_sessions where id=$1',[result.review_session_id])).rows[0];
 await db.query(`insert into public.release_certificates(id,record_id,conflict_id,resolution_record_id,validation_result_id,review_record_id,review_decision_id,
  certified_by_type,certified_by,reason,truth_snapshot,certificate_hash,certified_at)
  values($1,$2,$3,$4,$5,$6,$7,'human',$8,'Explicit synthetic prior release','{}',$9,clock_timestamp())`,[
  id(160),ids.record,ids.conflict,ids.resolution,ids.validation,session.review_record_id,result.review_decision_id,ids.actor,sourceHash]);
 return id(160);
}

export async function opposingSource(db) {
 const text='For this fixture, quantity means package count, not item count.\n';
 const bytes=Buffer.from(text);
 await db.query(`insert into public.trusted_evidence_sources(id,source_key,revision,source_url,version_reference,authority_reference,expected_sha256,media_type,max_bytes,registered_by,valid_from,valid_until)
 values($1,'fixture-meaning',2,'https://evidence.example/spec/v2.txt','fixture-v2','fixture-root:admin-approved',$2,'text/plain',1024,$3,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day')`,
 [id(121),createHash('sha256').update(bytes).digest('hex'),ids.actor]);
 return {text,bytes,source:id(121),anchor:{byte_start:0,byte_end:bytes.length,excerpt:text}};
}
