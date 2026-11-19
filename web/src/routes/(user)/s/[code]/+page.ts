import { authenticate } from '#lib/utils/auth.ts';
import { getShortLink } from '@immich/sdk';
import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({url,params}) => {
  await authenticate(url);
  const {path}=await getShortLink({code:params.code});
  if(!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) throw new Error('Invalid short link target');
  redirect(307,path);
};
