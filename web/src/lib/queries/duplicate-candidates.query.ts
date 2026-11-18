import { getAssetInfo, getDuplicateCandidates } from '@immich/sdk';
import { queryOptions } from '@tanstack/svelte-query';

export type CandidateMode = 'content' | 'size' | 'name' | 'metadata';
export const DUPLICATE_CANDIDATES = 'duplicate-candidates';

export const getDuplicateCandidatesQuery = (mode: CandidateMode, page: number) =>
  queryOptions({
    queryKey: [DUPLICATE_CANDIDATES, mode, page],
    queryFn: ({ signal }) => getDuplicateCandidates({ mode, page }, { signal }),
  });

export const getCandidateMemberQuery = (id: string) =>
  queryOptions({
    queryKey: [DUPLICATE_CANDIDATES, 'asset', id],
    queryFn: ({ signal }) => getAssetInfo({ id }, { signal }),
  });
