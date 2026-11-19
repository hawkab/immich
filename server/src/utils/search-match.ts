import type { SearchMatch } from 'src/dtos/asset-response.dto.js';
import type { MetadataSearchDto, SmartSearchDto } from 'src/dtos/search.dto.js';
import { transcriptSearchParts } from 'src/utils/transcript-search.js';
import type { Transcript } from 'src/utils/transcription.js';

export type RawSearchMatch = {
  visual: boolean;
  scene: boolean;
  score: number;
  part?: number;
  segments?: Transcript['segments'];
  segment?: Transcript['segments'][number];
};

export const searchMatch = (
  checksum: Buffer,
  query: (SmartSearchDto | MetadataSearchDto) & { matchedPeople?: string[] },
  raw?: RawSearchMatch,
): SearchMatch => {
  const sources: SearchMatch['sources'] = [];
  if (raw?.visual) sources.push('visual');
  if (raw?.visual && raw.scene) sources.push('scene');
  if (raw?.score) sources.push(raw.score >= 3 ? 'speech-lexical' : raw.score >= 2 ? 'speech-fuzzy' : 'speech-semantic');
  const filters = Object.entries(query)
    .filter(
      ([field, value]) =>
        [
          'personIds',
          'city',
          'state',
          'country',
          'takenAfter',
          'takenBefore',
          'originalFileName',
          'originalPath',
          'description',
          'ocr',
          'type',
          'make',
          'model',
          'tagIds',
        ].includes(field) && value !== undefined,
    )
    .map(([field, value]) => ({ field, value: Array.isArray(value) ? value.join(', ') : String(value) }));
  if (query.matchedPeople?.length) {
    const index = filters.findIndex((filter) => filter.field === 'personIds');
    if (index !== -1) filters.splice(index, 1);
    filters.push({ field: 'people', value: query.matchedPeople.join(', ') });
  }
  if (query.filter)
    for (const [field, value] of Object.entries(query.filter)) filters.push({ field, value: JSON.stringify(value) });
  if (!raw || filters.length > 0) sources.push('metadata');
  const segments = Array.isArray(raw?.segments)
    ? raw.segments.filter(
        (segment) =>
          typeof segment?.text === 'string' && Number.isFinite(segment.start) && Number.isFinite(segment.end),
      )
    : [];
  const speech = raw?.score
    ? raw.score < 2 && raw.part !== undefined && segments.length > 0
      ? transcriptSearchParts({ segments } as Transcript)[raw.part]
      : raw.segment
    : undefined;
  return {
    sourceChecksum: checksum.toString('base64'),
    query: 'query' in query ? query.query : undefined,
    ...('queryAssetId' in query && query.queryAssetId && !query.query && { referenceAssetId: query.queryAssetId }),
    sources,
    filters,
    ...(speech?.text && { speech: { text: speech.text, start: speech.start, end: speech.end } }),
  };
};
