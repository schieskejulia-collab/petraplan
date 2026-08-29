import type { SupabaseClient } from '@supabase/supabase-js';
import {
  decideReleaseGate,
  selectAuthoritativeValidation,
  type ReleaseStatus,
} from './releaseGate.js';

export interface CaseListItem {
  id: string;
  created_at: string;
  title: string;
  category: string;
  status: string;
  source_system: string | null;
  conflict_count: number;
  release_status: ReleaseStatus;
}

async function rows<T>(promise: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function one<T>(promise: PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>): Promise<T | null> {
  const { data, error } = await promise;
  if (error && error.code !== 'PGRST116') throw new Error(error.message);
  return data ?? null;
}

export async function listCases(
  supabase: SupabaseClient,
  limit: number,
  offset: number,
): Promise<CaseListItem[]> {
  const records = await rows<any>(
    supabase
      .from('records')
      .select('id, created_at, title, category, status, source_system')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1),
  );

  return Promise.all(
    records.map(async (record) => {
      const conflicts = await rows<any>(
        supabase.from('conflicts').select('id').eq('record_id', record.id),
      );
      const conflictIds = conflicts.map((item) => item.id);

      const certificate = await one<any>(
        supabase
          .from('release_certificates')
          .select('id, release_status, validation_result_id, certified_at')
          .eq('record_id', record.id)
          .order('certified_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      );

      let releaseStatus: ReleaseStatus = certificate?.release_status ?? null;

      if (certificate) {
        const latestStatus = await one<any>(
          supabase
            .from('release_status_history')
            .select('new_status, created_at')
            .eq('release_certificate_id', certificate.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        );
        releaseStatus = latestStatus?.new_status ?? releaseStatus;
      }

      const validations = conflictIds.length
        ? await rows<any>(
            supabase
              .from('validation_results')
              .select('id, status, created_at')
              .in('conflict_id', conflictIds)
              .order('created_at'),
          )
        : [];

      const authoritativeValidation = selectAuthoritativeValidation(validations, certificate);
      const gate = authoritativeValidation
        ? decideReleaseGate({
            latestValidationStatus: authoritativeValidation.status,
            existingReleaseStatus: releaseStatus,
            hasReleaseCertificate: Boolean(certificate),
          })
        : null;

      return {
        ...record,
        conflict_count: conflicts.length,
        release_status: gate?.effectiveStatus ?? releaseStatus,
      } as CaseListItem;
    }),
  );
}

export async function getCaseTrace(supabase: SupabaseClient, recordId: string) {
  const record = await one<any>(
    supabase
      .from('records')
      .select('*')
      .eq('id', recordId)
      .maybeSingle(),
  );

  if (!record) return null;

  const ingestion = record.ingestion_log_id
    ? await one<any>(
        supabase
          .from('ingestion_logs')
          .select('id, source_system, source_reference, source_hash, ingested_at, status, extracted_schema')
          .eq('id', record.ingestion_log_id)
          .maybeSingle(),
      )
    : null;

  const operations = await rows<any>(
    supabase.from('operation_logs').select('*').eq('record_id', recordId).order('created_at'),
  );
  const runtime = await rows<any>(
    supabase.from('runtime_logs').select('*').eq('record_id', recordId).order('created_at'),
  );
  const conflicts = await rows<any>(
    supabase.from('conflicts').select('*').eq('record_id', recordId).order('created_at'),
  );

  const conflictIds = conflicts.map((item) => item.id);
  const conflictSources = conflictIds.length
    ? await rows<any>(
        supabase.from('conflict_sources').select('*').in('conflict_id', conflictIds).order('created_at'),
      )
    : [];
  const resolutions = conflictIds.length
    ? await rows<any>(
        supabase.from('resolution_records').select('*').in('conflict_id', conflictIds).order('created_at'),
      )
    : [];
  const resolutionLogs = conflictIds.length
    ? await rows<any>(
        supabase.from('resolution_logs').select('*').in('conflict_id', conflictIds).order('created_at'),
      )
    : [];
  const resolutionStatus = conflictIds.length
    ? await rows<any>(
        supabase.from('resolution_status').select('*').in('conflict_id', conflictIds),
      )
    : [];
  const validations = conflictIds.length
    ? await rows<any>(
        supabase.from('validation_results').select('*').in('conflict_id', conflictIds).order('created_at'),
      )
    : [];

  const resolutionIds = resolutions.map((item) => item.id);
  const reviews = resolutionIds.length
    ? await rows<any>(
        supabase.from('review_records').select('*').in('resolution_record_id', resolutionIds).order('created_at'),
      )
    : [];
  const reviewIds = reviews.map((item) => item.id);
  const reviewSessions = reviewIds.length
    ? await rows<any>(
        supabase.from('review_sessions').select('*').in('review_record_id', reviewIds).order('created_at'),
      )
    : [];
  const sessionIds = reviewSessions.map((item) => item.id);
  const criterionResults = sessionIds.length
    ? await rows<any>(
        supabase
          .from('review_criterion_results')
          .select('*, review_criteria(criterion_key, description, required, expected_type)')
          .in('review_session_id', sessionIds)
          .order('created_at'),
      )
    : [];
  const reviewDecisions = sessionIds.length
    ? await rows<any>(
        supabase.from('review_decisions').select('*').in('review_session_id', sessionIds).order('created_at'),
      )
    : [];
  const reviewLogs = sessionIds.length
    ? await rows<any>(
        supabase.from('review_logs').select('*').in('review_session_id', sessionIds).order('created_at'),
      )
    : [];
  const reviewStatusHistory = sessionIds.length
    ? await rows<any>(
        supabase.from('review_status_history').select('*').in('review_session_id', sessionIds).order('created_at'),
      )
    : [];

  const releases = await rows<any>(
    supabase.from('release_certificates').select('*').eq('record_id', recordId).order('certified_at'),
  );
  const releaseIds = releases.map((item) => item.id);
  const releaseLogs = releaseIds.length
    ? await rows<any>(
        supabase.from('release_logs').select('*').in('release_certificate_id', releaseIds).order('created_at'),
      )
    : [];
  const releaseStatusHistory = releaseIds.length
    ? await rows<any>(
        supabase
          .from('release_status_history')
          .select('*')
          .in('release_certificate_id', releaseIds)
          .order('created_at'),
      )
    : [];

  const latestCertificate = releases.length ? releases[releases.length - 1] : null;
  const authoritativeValidation = selectAuthoritativeValidation(validations, latestCertificate);
  const latestReleaseStatus = latestCertificate
    ? [...releaseStatusHistory]
        .filter((item) => item.release_certificate_id === latestCertificate.id)
        .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))[0]?.new_status ?? latestCertificate.release_status
    : null;
  const gate = authoritativeValidation
    ? decideReleaseGate({
        latestValidationStatus: authoritativeValidation.status,
        existingReleaseStatus: latestReleaseStatus,
        hasReleaseCertificate: Boolean(latestCertificate),
      })
    : null;

  return {
    id: record.id,
    title: record.title,
    category: record.category,
    status: record.status,
    created_at: record.created_at,
    source: {
      record,
      ingestion,
    },
    semantic: {
      meaning: record.meaning,
      metadata: record.metadata,
      extracted_schema: ingestion?.extracted_schema ?? null,
    },
    conflict: {
      conflicts,
      sources: conflictSources,
    },
    execution: {
      operations,
    },
    runtime: {
      observations: runtime,
    },
    resolution: {
      records: resolutions,
      logs: resolutionLogs,
      status: resolutionStatus,
    },
    validation: {
      results: validations,
      authoritative: authoritativeValidation,
    },
    review: {
      records: reviews,
      sessions: reviewSessions,
      criteria: criterionResults,
      decisions: reviewDecisions,
      logs: reviewLogs,
      status_history: reviewStatusHistory,
    },
    release: {
      certificates: releases,
      logs: releaseLogs,
      status_history: releaseStatusHistory,
      effective_status: gate?.effectiveStatus ?? latestReleaseStatus,
      gate,
    },
  };
}
