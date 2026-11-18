import AssetViewerNavBar from '#lib/components/asset-viewer/AssetViewerNavBar.svelte';
import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { factory } from '#test/unit/factories.ts';
import { test } from '#test/unit/fixtures.ts';
import ComponentHost from '#test/unit/mocks/ComponentHost.svelte';
import { expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

for (const canDelete of [true, false, undefined]) {
  test(`shows partner deletion only with the explicit grant (${canDelete})`, async ({ data }) => {
    authManager.setUser(data.user);
    const asset = factory.asset({ canDelete });
    await render(ComponentHost, {
      props: {
        component: AssetViewerNavBar,
        props: {
          asset,
          preAction: vi.fn(),
          onAction: vi.fn(),
          isPlayingOriginalVideo: false,
          setPlayOriginalVideo: vi.fn(),
        },
      },
    });
    const button = page.getByRole('button', { name: 'delete', exact: true });
    if (canDelete) {
      await expect.element(button).toBeVisible();
    } else {
      await expect.element(button).not.toBeInTheDocument();
    }
  });
}

test('uses the normal trash action and prevents Shift+Delete for a partner', async ({ data, api, settle }) => {
  authManager.setUser(data.user);
  const asset = factory.asset({ canDelete: true });
  data.addAssets(asset);
  const onAction = vi.fn();
  await render(ComponentHost, {
    props: {
      component: AssetViewerNavBar,
      props: { asset, preAction: vi.fn(), onAction, isPlayingOriginalVideo: false, setPlayOriginalVideo: vi.fn() },
    },
  });
  await userEvent.keyboard('{Shift>}{Delete}{/Shift}');
  expect(api.deleteAssets).not.toHaveBeenCalled();
  await page.getByRole('button', { name: 'delete', exact: true }).click();
  await settle();
  expect(api.deleteAssets).toHaveBeenCalledWith({ body: { ids: [asset.id], force: false } });
  expect(onAction).toHaveBeenCalled();
});
