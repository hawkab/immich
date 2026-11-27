import { PartnerDirection, getPartners } from '@immich/sdk';
import { queryOptions } from '@tanstack/svelte-query';

export const incomingPartnersQueryKey = ['partners', 'incoming'] as const;

export const getIncomingPartnersQuery = (userId: string | undefined) =>
  queryOptions({
    queryKey: [...incomingPartnersQueryKey, userId],
    queryFn: ({ signal }) => getPartners({ direction: PartnerDirection.SharedWith }, { signal }),
    enabled: !!userId,
    staleTime: 0,
  });
