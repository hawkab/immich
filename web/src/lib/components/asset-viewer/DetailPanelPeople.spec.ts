import DetailPanelPeople from '#lib/components/asset-viewer/DetailPanelPeople.svelte';
import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { faceManager } from '#lib/stores/face.svelte.ts';
import { factory } from '#test/unit/factories.ts';
import { test } from '#test/unit/fixtures.ts';
import ComponentHost from '#test/unit/mocks/ComponentHost.svelte';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

for (const canEdit of [true, false, undefined]) {
  test(`shows face creation only with an explicit partner grant (${canEdit})`, async ({ data }) => {
    authManager.setUser(data.user);
    faceManager.clear();
    const asset = factory.asset({ canEdit });
    await render(ComponentHost, {
      props: { component: DetailPanelPeople, props: { asset, isOwner: false, previousRoute: '/photos' } },
    });
    const tag = page.getByRole('button', { name: 'tag_people', exact: true });
    if (canEdit) {
      await expect.element(tag).toBeVisible();
    } else {
      await expect.element(tag).not.toBeInTheDocument();
    }
  });
}
