import { getVisualEvidence, type VisualEvidenceDto } from '@immich/sdk';
import { queryOptions } from '@tanstack/svelte-query';

export const getVisualEvidenceQuery = (dto: VisualEvidenceDto, revision: string) =>
  queryOptions({
    queryKey: ['visual-evidence', 'complete-object-v2', dto, revision],
    queryFn: ({ signal }) => getVisualEvidence({ visualEvidenceDto: dto }, { signal }),
  });
