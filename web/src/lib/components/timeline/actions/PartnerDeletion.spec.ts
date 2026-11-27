import DeleteAssetsAction from '#lib/components/timeline/actions/DeleteAssetsAction.svelte';
import { assetMultiSelectManager } from '#lib/managers/asset-multi-select-manager.svelte.ts';
import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { toTimelineAsset } from '#lib/utils/timeline-util.ts';
import { factory } from '#test/unit/factories.ts';
import { test } from '#test/unit/fixtures.ts';
import ComponentHost from '#test/unit/mocks/ComponentHost.svelte';
import { AssetVisibility } from '@immich/sdk';
import { beforeEach, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

beforeEach(() => assetMultiSelectManager.clear());

for (const mixed of [false, true]) {
  test(`trashes the entire permitted selection including partner photos (mixed=${mixed})`, async ({
    data,
    api,
    settle,
  }) => {
    authManager.setUser(data.user);
    authManager.setPreferences(factory.preferences());
    const owner = factory.user();
    const assets = [factory.asset({ ownerId: owner.id }), factory.asset({ ownerId: mixed ? data.user.id : owner.id })];
    api.on({ getPartners: () => ({ json: [{ ...owner, canDelete: true }] }) });
    data.addAssets(assets);
    assetMultiSelectManager.selectAssets(assets.map((asset) => toTimelineAsset(asset)));
    const onAssetDelete = vi.fn();
    await render(ComponentHost, { props: { component: DeleteAssetsAction, props: { force: true, onAssetDelete } } });
    await page.getByRole('button', { name: 'delete', exact: true }).click();
    await settle();
    const ids = assets.map(({ id }) => id);
    expect(api.deleteAssets).toHaveBeenCalledWith({ body: { ids, force: false } });
    expect(onAssetDelete).toHaveBeenCalledWith(ids);
    expect(assetMultiSelectManager.selectionActive).toBe(false);
  });
}

for (const denied of ['no-grant', 'different-owner', 'trashed', 'archived', 'trash-disabled'] as const) {
  test(`does not offer partner deletion for ${denied}`, async ({ data, api, settle }) => {
    authManager.setUser(data.user);
    authManager.setPreferences(factory.preferences());
    const owner = factory.user();
    const asset = factory.asset({
      ownerId: owner.id,
      isTrashed: denied === 'trashed',
      isArchived: denied === 'archived',
      visibility: denied === 'archived' ? AssetVisibility.Archive : AssetVisibility.Timeline,
    });
    api.on({
      getPartners: () => ({
        json: [{ ...(denied === 'different-owner' ? factory.user() : owner), canDelete: denied !== 'no-grant' }],
      }),
    });
    if (denied === 'trash-disabled') {
      api.on({ getServerFeatures: () => ({ json: { ...data.serverFeatures, trash: false } }) });
      const { featureFlagsManager } = await import('#lib/managers/feature-flags-manager.svelte.ts');
      await featureFlagsManager.init();
    }
    assetMultiSelectManager.selectAsset(toTimelineAsset(asset));
    await render(ComponentHost, { props: { component: DeleteAssetsAction, props: { onAssetDelete: vi.fn() } } });
    await settle();
    await expect.element(page.getByRole('button', { name: 'delete', exact: true })).not.toBeInTheDocument();
    expect(api.deleteAssets).not.toHaveBeenCalled();
  });
}

test('rechecks a revoked grant before sending a destructive request', async ({ data, api, settle }) => {
  authManager.setUser(data.user);
  authManager.setPreferences(factory.preferences());
  const owner = factory.user();
  let canDelete = true;
  api.on({ getPartners: () => ({ json: [{ ...owner, canDelete }] }) });
  assetMultiSelectManager.selectAsset(toTimelineAsset(factory.asset({ ownerId: owner.id })));
  await render(ComponentHost, { props: { component: DeleteAssetsAction, props: { onAssetDelete: vi.fn() } } });
  await expect.element(page.getByRole('button', { name: 'delete', exact: true })).toBeVisible();
  canDelete = false;
  await page.getByRole('button', { name: 'delete', exact: true }).click();
  await settle();
  expect(api.deleteAssets).not.toHaveBeenCalled();
  expect(assetMultiSelectManager.selectionActive).toBe(true);
});
