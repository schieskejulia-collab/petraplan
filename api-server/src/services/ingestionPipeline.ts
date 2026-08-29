import type { LegacyAnalysis } from './aiParser.js';
import { transformPayload } from './transform.js';

export type LegacyAnalyzer = (legacyText: string) => Promise<LegacyAnalysis>;

export type IngestionPipelineInput = {
  legacyText: string;
  rawPayload: Record<string, unknown>;
  analyze: LegacyAnalyzer;
};

export type IngestionPipelineResult = {
  analysis: LegacyAnalysis;
  extractedSchema: LegacyAnalysis & {
    mapped_payload: Record<string, unknown>;
    review_required: true;
  };
};

export async function runIngestionPipeline({
  legacyText,
  rawPayload,
  analyze,
}: IngestionPipelineInput): Promise<IngestionPipelineResult> {
  if (typeof legacyText !== 'string' || legacyText.trim().length === 0) {
    throw new Error('legacy_text must be a non-empty string');
  }

  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    throw new Error('raw_payload must be a JSON object');
  }

  const analysis = await analyze(legacyText);
  const mappedPayload = transformPayload(
    rawPayload,
    analysis.fieldMapping,
    analysis.field_types,
  );

  return {
    analysis,
    extractedSchema: {
      ...analysis,
      mapped_payload: mappedPayload,
      review_required: true,
    },
  };
}
