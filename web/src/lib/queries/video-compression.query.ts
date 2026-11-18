import { asMutation } from '#lib/queries/client.ts';
import {
  confirmVideoCompression,
  createVideoCompression,
  discardVideoCompression,
  getAssetInfo,
  getVideoCompression,
} from '@immich/sdk';
import { queryOptions } from '@tanstack/svelte-query';

export const VIDEO_COMPRESSION = 'video-compression';

export const getVideoCompressionQuery = (id: string) =>
  queryOptions({
    queryKey: [VIDEO_COMPRESSION, id],
    queryFn: ({ signal }) => getVideoCompression({ id }, { signal }),
    select: (result) => result.draft,
    refetchInterval: (query) =>
      ['queued', 'processing', 'saving'].includes(query.state.data?.draft?.status ?? '') ? 1000 : false,
  });

export const createVideoCompressionMutation = asMutation(createVideoCompression);
export const discardVideoCompressionMutation = asMutation(discardVideoCompression);
export const confirmVideoCompressionMutation = asMutation(confirmVideoCompression);

export const getCompressedAssetQuery = (id: string) =>
  queryOptions({
    queryKey: [VIDEO_COMPRESSION, 'asset', id],
    queryFn: ({ signal }) => getAssetInfo({ id }, { signal }),
    staleTime: 0,
  });
