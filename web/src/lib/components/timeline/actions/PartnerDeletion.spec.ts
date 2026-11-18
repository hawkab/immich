import DeleteAssetsAction from '#lib/components/timeline/actions/DeleteAssetsAction.svelte';
import { assetMultiSelectManager } from '#lib/managers/asset-multi-select-manager.svelte.ts';
import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { toTimelineAsset } from '#lib/utils/timeline-util.ts';
import { factory } from '#test/unit/factories.ts';
import { test } from '#test/unit/fixtures.ts';
import ComponentHost from '#test/unit/mocks/ComponentHost.svelte';
import { expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

test('trashes only selected photos of the granted partner, even if force was requested', async ({
  data,
  api,
  settle,
}) => {
  authManager.setUser(data.user);
  const owner = factory.user();
  const assets = [factory.asset({ ownerId: owner.id }), factory.asset({ ownerId: owner.id })];
  data.addAssets(assets);
  assetMultiSelectManager.clear();
  assetMultiSelectManager.selectAssets(assets.map((asset) => toTimelineAsset(asset)));
  const onAssetDelete = vi.fn();
  await render(ComponentHost, {
    props: { component: DeleteAssetsAction, props: { partnerOwnerId: owner.id, force: true, onAssetDelete } },
  });
  await page.getByRole('button', { name: 'delete', exact: true }).click();
  await settle();
  const ids = assets.map(({ id }) => id);
  expect(api.deleteAssets).toHaveBeenCalledWith({ body: { ids, force: false } });
  expect(onAssetDelete).toHaveBeenCalledWith(ids);
  expect(assetMultiSelectManager.selectionActive).toBe(false);
});
