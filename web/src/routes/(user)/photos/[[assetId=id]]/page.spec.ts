import { assetMultiSelectManager } from '#lib/managers/asset-multi-select-manager.svelte.ts';
import { toTimelineAsset } from '#lib/utils/timeline-util.ts';
import { factory } from '#test/unit/factories.ts';
import { test } from '#test/unit/fixtures.ts';
import { expect } from 'vitest';
import { page } from 'vitest/browser';
import Page from './+page.svelte';
import { load } from './+page.ts';

for (const mixed of [false, true]) {
  test(`main timeline shows a delete icon for the whole granted selection (mixed=${mixed})`, async ({
    data,
    api,
    render,
    router,
    settle,
  }) => {
    const partner = factory.user();
    const assets = [
      factory.asset({ ownerId: partner.id }),
      factory.asset({ ownerId: mixed ? data.user.id : partner.id }),
    ];
    data.addAssets(assets);
    api.on({ getPartners: () => ({ json: [{ ...partner, canDelete: true }] }) });
    await router.goto('/photos');
    await render(Page, load);
    await settle();
    assetMultiSelectManager.selectAssets(assets.map((asset) => toTimelineAsset(asset)));
    await expect.element(page.getByRole('button', { name: 'delete', exact: true })).toBeVisible();
    expect(api.deleteAssets).not.toHaveBeenCalled();
    assetMultiSelectManager.clear();
  });
}
