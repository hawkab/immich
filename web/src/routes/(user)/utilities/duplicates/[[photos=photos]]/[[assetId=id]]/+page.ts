import { queryClient } from '#lib/queries/client.ts';
import { getDuplicateCandidatesQuery, type CandidateMode } from '#lib/queries/duplicate-candidates.query.ts';
import { authenticate } from '#lib/utils/auth.ts';
import { getFormatter } from '#lib/utils/i18n.ts';
import { getAssetDuplicates } from '@immich/sdk';
import type { PageLoad } from './$types';

export const load = (async ({ url }) => {
  await authenticate(url);
  const selected = url.searchParams.get('mode');
  const mode: CandidateMode | 'auto' =
    selected === 'auto'
      ? 'auto'
      : ['content', 'size', 'name', 'metadata'].includes(selected ?? '')
        ? (selected as CandidateMode)
        : 'content';
  const page = Math.max(1, Math.trunc(Number(url.searchParams.get('page'))) || 1);
  const duplicates = mode === 'auto' ? await getAssetDuplicates() : [];
  const candidates = mode === 'auto' ? undefined : await queryClient.query(getDuplicateCandidatesQuery(mode, page));
  const $t = await getFormatter();

  return {
    duplicates,
    candidates,
    mode,
    meta: {
      title: $t('duplicates'),
    },
  };
}) satisfies PageLoad;
