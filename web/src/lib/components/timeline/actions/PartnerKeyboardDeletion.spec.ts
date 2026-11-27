import TimelineKeyboardActions from '#lib/components/timeline/actions/TimelineKeyboardActions.svelte';
import { AssetMultiSelectManager } from '#lib/managers/asset-multi-select-manager.svelte.ts';
import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import type { TimelineManager } from '#lib/managers/timeline-manager/timeline-manager.svelte.ts';
import { toTimelineAsset } from '#lib/utils/timeline-util.ts';
import { factory } from '#test/unit/factories.ts';
import { test } from '#test/unit/fixtures.ts';
import ComponentHost from '#test/unit/mocks/ComponentHost.svelte';
import { expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';

for (const mode of ['partner', 'mixed', 'denied'] as const) {
  test(`keyboard deletion follows the same partner grant policy (${mode})`, async ({ data, api, settle }) => {
    authManager.setUser(data.user);
    authManager.setPreferences(factory.preferences());
    const owner = factory.user();
    const assets = [
      factory.asset({ ownerId: owner.id }),
      factory.asset({ ownerId: mode === 'mixed' ? data.user.id : owner.id }),
    ];
    data.addAssets(assets);
    api.on({ getPartners: () => ({ json: [{ ...owner, canDelete: mode !== 'denied' }] }) });
    const selection = new AssetMultiSelectManager();
    selection.selectAssets(assets.map((asset) => toTimelineAsset(asset)));
    const removeAssets = vi.fn();
    const timeline = {
      isInitialized: true,
      months: [{}],
      removeAssets,
      upsertAssets: vi.fn(),
    } as unknown as TimelineManager;
    await render(ComponentHost, {
      props: {
        component: TimelineKeyboardActions,
        props: { timelineManager: timeline, assetInteraction: selection, scrollToAsset: vi.fn() },
      },
    });
    await userEvent.keyboard('{Shift>}{Delete}{/Shift}');
    await settle();
    if (mode === 'denied') {
      expect(api.deleteAssets).not.toHaveBeenCalled();
      expect(selection.selectionActive).toBe(true);
    } else {
      const ids = assets.map(({ id }) => id);
      expect(api.deleteAssets).toHaveBeenCalledWith({ body: { ids, force: false } });
      expect(removeAssets).toHaveBeenCalledWith(ids);
      expect(selection.selectionActive).toBe(false);
    }
    selection.destroy();
  });
}
