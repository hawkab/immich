import { authenticate } from '#lib/utils/auth.ts';
import { getFormatter } from '#lib/utils/i18n.ts';
import { PartnerDirection, getPartners, getUser } from '@immich/sdk';
import type { PageLoad } from './$types';

export const load = (async ({ params, url }) => {
  await authenticate(url);

  const [partner, sharedWith] = await Promise.all([
    getUser({ id: params.userId }),
    getPartners({ direction: PartnerDirection.SharedWith }),
  ]);
  const $t = await getFormatter();

  return {
    partner,
    canDelete: sharedWith.some((grant) => grant.id === partner.id && grant.canDelete === true),
    meta: {
      title: $t('partner'),
    },
  };
}) satisfies PageLoad;
