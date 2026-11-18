import { sql, type SqlBool } from 'kysely';
import { createHash } from 'node:crypto';
import type { SystemConfig } from 'src/dtos/config.dto.js';

export const TRANSCRIPT_KEY = 'org.immich.transcript.v1';
export const TRANSCRIPT_CHUNK_SECONDS = 24;
export type TranscriptionConfig = SystemConfig['machineLearning']['transcription'];
export type TranscriptSegment = { start: number; end: number; text: string };
export type Transcript = {
  schemaVersion: number;
  sourceChecksum: string;
  configuration: string;
  model: string;
  language: string;
  status: 'processing' | 'complete' | 'no_audio';
  duration: number;
  nextStart: number;
  requestAttempt?: number;
  lastError?: string;
  text: string;
  segments: TranscriptSegment[];
};

export const transcriptionIdentity = (config: TranscriptionConfig) =>
  createHash('sha256')
    .update(JSON.stringify([config.provider, config.url, config.model, config.language, TRANSCRIPT_CHUNK_SECONDS]))
    .digest('hex');

export const transcriptMatches = (query: string) => sql<SqlBool>`exists (
  select 1 from asset_metadata transcript
  where asset.type = 'VIDEO' and transcript."assetId" = asset.id and transcript.key = ${TRANSCRIPT_KEY}
    and transcript.value->>'schemaVersion' = '1'
    and transcript.value->>'sourceChecksum' = encode(asset.checksum, 'base64')
    and transcript.value->>'status' in ('complete', 'processing')
    and (to_tsvector('russian', coalesce(transcript.value->>'text', '')) @@ websearch_to_tsquery('russian', ${query})
      or to_tsvector('simple', coalesce(transcript.value->>'text', '')) @@ websearch_to_tsquery('simple', ${query}))
)`;

export const speechQuery = (query?: string) => {
  const match = query?.match(/^(?:speech|речь):\s*(.+)$/isu);
  return { query: match?.[1]?.trim() ?? query, only: !!match };
};

export const isTranscript = (value: unknown): value is Transcript => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const row = value as Transcript;
  if (
    row.schemaVersion !== 1 ||
    typeof row.text !== 'string' ||
    !Array.isArray(row.segments) ||
    !Number.isFinite(row.duration) ||
    row.duration <= 0 ||
    !Number.isFinite(row.nextStart) ||
    row.nextStart < 0 ||
    row.nextStart > row.duration ||
    !['complete', 'processing', 'no_audio'].includes(row.status)
  ) {
    return false;
  }
  let next = 0;
  for (const segment of row.segments) {
    if (
      !segment ||
      segment.start !== next ||
      !Number.isFinite(segment.end) ||
      segment.end <= next ||
      segment.end > row.duration ||
      typeof segment.text !== 'string'
    ) {
      return false;
    }
    next = segment.end;
  }
  return (
    next === row.nextStart &&
    (row.status !== 'complete' || next === row.duration) &&
    row.text ===
      row.segments
        .map((segment) => segment.text)
        .filter(Boolean)
        .join(' ')
  );
};

export class TranscriptionProviderError extends Error {
  constructor(readonly status: number) {
    super(`Transcription provider returned HTTP ${status}`);
  }
}

export const speechWave = (input: Buffer) => {
  const pcm = input.length < 32_000 ? Buffer.concat([input, Buffer.alloc(32_000 - input.length)]) : input;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(pcm.length + 36, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16_000, 24);
  header.writeUInt32LE(32_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
};
