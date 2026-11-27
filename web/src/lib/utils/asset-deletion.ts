import type { TimelineAsset } from '#lib/managers/timeline-manager/types.ts';
import { AssetVisibility, type PartnerResponseDto } from '@immich/sdk';

export const getAssetDeletionPlan = (
  assets: TimelineAsset[],
  userId: string | undefined,
  partners: PartnerResponseDto[],
  trashEnabled: boolean,
  forceRequested = false,
  sharedLink = false,
) => {
  if (!userId || sharedLink || assets.length === 0) {
    return;
  }
  const hasPartnerAssets = assets.some((asset) => asset.ownerId !== userId);
  if (hasPartnerAssets) {
    if (!trashEnabled) {
      return;
    }
    const allowedOwners = new Set(partners.filter((partner) => partner.canDelete === true).map(({ id }) => id));
    if (
      assets.some(
        (asset) =>
          asset.isTrashed ||
          (asset.ownerId !== userId &&
            (asset.visibility !== AssetVisibility.Timeline || !allowedOwners.has(asset.ownerId))),
      )
    ) {
      return;
    }
  }
  return { assets, force: !hasPartnerAssets && (forceRequested || !trashEnabled) };
};
