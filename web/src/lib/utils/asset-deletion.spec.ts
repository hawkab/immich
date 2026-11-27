import { getAssetDeletionPlan } from '#lib/utils/asset-deletion.ts';
import { factory } from '#test/unit/factories.ts';
import { AssetVisibility } from '@immich/sdk';

const owner = factory.user();
const partner = factory.user();
const own = factory.timelineAsset({ ownerId: owner.id });
const other = factory.timelineAsset({ ownerId: partner.id, visibility: AssetVisibility.Timeline });
const grant = { ...partner, canDelete: true };

it('deletes own photos without fetching partner grants', () => {
  expect(getAssetDeletionPlan([own], owner.id, [], true)).toEqual({ assets: [own], force: false });
});
it('preserves permanent deletion of own photos when explicitly requested or trash is disabled', () => {
  expect(getAssetDeletionPlan([own], owner.id, [], true, true)?.force).toBe(true);
  expect(getAssetDeletionPlan([own], owner.id, [], false)?.force).toBe(true);
});
it('allows all selected photos across multiple granted owners with reversible deletion', () => {
  const second = factory.user();
  const assets = [own, other, factory.timelineAsset({ ownerId: second.id })];
  expect(getAssetDeletionPlan(assets, owner.id, [grant, { ...second, canDelete: true }], true, true)).toEqual({
    assets,
    force: false,
  });
});
it('refuses the whole mixed selection when any partner has not granted deletion', () => {
  expect(getAssetDeletionPlan([own, other], owner.id, [], true)).toBeUndefined();
});
it('requires an explicit deletion grant instead of a generic partner relationship', () => {
  expect(getAssetDeletionPlan([other], owner.id, [partner], true)).toBeUndefined();
});
for (const visibility of [AssetVisibility.Archive, AssetVisibility.Locked, AssetVisibility.Hidden]) {
  it(`does not offer partner deletion outside the shared timeline (${visibility})`, () => {
    expect(getAssetDeletionPlan([{ ...other, visibility }], owner.id, [grant], true)).toBeUndefined();
  });
}
it('does not offer partner deletion of trashed photos or without trash support', () => {
  expect(getAssetDeletionPlan([{ ...other, isTrashed: true }], owner.id, [grant], true)).toBeUndefined();
  expect(getAssetDeletionPlan([other], owner.id, [grant], false)).toBeUndefined();
});
it('rejects empty, unauthenticated and shared-link selections', () => {
  expect(getAssetDeletionPlan([], owner.id, [grant], true)).toBeUndefined();
  expect(getAssetDeletionPlan([own], undefined, [], true)).toBeUndefined();
  expect(getAssetDeletionPlan([own], owner.id, [], true, false, true)).toBeUndefined();
});
