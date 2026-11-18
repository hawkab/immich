import { getAssetMetadata } from '@immich/sdk';
import { queryOptions } from '@tanstack/svelte-query';

export const getTranscriptQuery = (id: string) =>
  queryOptions({
    queryKey: ['video-transcript', id],
    queryFn: ({ signal }) => getAssetMetadata({ id }, { signal }),
    select: (rows) =>
      rows.find((row) => row.key === 'org.immich.transcript.v1')?.value as
        | {
            sourceChecksum?: string;
            status?: string;
            text?: string;
            segments?: { start: number; end: number; text: string }[];
          }
        | undefined,
    refetchInterval: (query) =>
      query.state.data?.some((row) => row.key === 'org.immich.transcript.v1' && row.value.status === 'processing')
        ? 10_000
        : false,
  });
