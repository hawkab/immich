import type { SearchMatch } from '@immich/sdk';
import type { MessageFormatter } from 'svelte-i18n';

const sourceLabels = {
  visual: 'search_match_visual',
  scene: 'search_match_scene',
  metadata: 'search_match_metadata',
  'speech-lexical': 'search_match_speech_lexical',
  'speech-fuzzy': 'search_match_speech_fuzzy',
  'speech-semantic': 'search_match_speech_semantic',
} as const;
export const filterLabels = {
  personIds: 'people',
  people: 'people',
  city: 'city',
  state: 'state',
  country: 'country',
  takenAfter: 'start_date',
  takenBefore: 'end_date',
  originalFileName: 'file_name_text',
  originalPath: 'full_path_or_folder',
  description: 'description',
  ocr: 'ocr',
  type: 'media_type',
  make: 'camera_brand',
  model: 'camera_model',
  tagIds: 'tags',
} as const;
export const searchMatchLabels = (match: SearchMatch, t: MessageFormatter) =>
  match.sources.map((source) =>
    t(source === 'visual' && match.referenceAssetId ? 'search_match_reference' : sourceLabels[source]),
  );
export const searchFilterLabel = (field: string, t: MessageFormatter) =>
  Object.hasOwn(filterLabels, field) ? t(filterLabels[field as keyof typeof filterLabels]) : field;
export const transcriptTimestamp = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;
