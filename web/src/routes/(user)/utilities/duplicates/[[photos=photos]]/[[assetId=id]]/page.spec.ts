import { Route } from '#lib/route.ts';
import { factory } from '#test/unit/factories.ts';
import { test } from '#test/unit/fixtures.ts';
import { Reason, type DuplicateCandidatesResponseDto } from '@immich/sdk';
import { expect } from 'vitest';
import { page } from 'vitest/browser';
import Page from './+page.svelte';
import { load } from './+page.ts';

test('shared content candidates are visible without deletion or resolve controls', async ({
  api,
  data,
  render,
  router,
}) => {
  const first = factory.asset({ originalFileName: 'first.jpg' });
  const second = factory.asset({ originalFileName: 'second.jpg' });
  data.addAssets([first, second]);
  const response: DuplicateCandidatesResponseDto = {
    groups: [
      { key: 'checksum:sample', reason: Reason.Checksum, assetIds: [first.id, second.id], previews: [first, second] },
    ],
    totalGroups: 2,
    page: 1,
    nextPage: 2,
    readOnly: true,
  };
  api.on({ getDuplicateCandidates: () => ({ json: response }) });
  await router.goto(Route.duplicatesUtility());
  await render(Page, load);
  await expect.element(page.getByText('first.jpg', { exact: true })).toBeVisible();
  await expect.element(page.getByText('duplicate_candidate_scope')).toBeVisible();
  await expect.element(page.getByRole('button', { name: 'resolve_duplicates', exact: true })).not.toBeInTheDocument();
  await expect.element(page.getByRole('button', { name: 'keep_all', exact: true })).not.toBeInTheDocument();
  await page.getByRole('button', { name: 'next', exact: true }).click();
  expect(router.url.searchParams.get('page')).toBe('2');
  expect(router.url.searchParams.get('mode')).toBe('content');
});

for (const mode of ['size', 'name', 'metadata'] as const) {
  test(`file comparison uses the requested ${mode} mode`, async ({ api, render, router }) => {
    await router.goto(Route.duplicatesUtility({ mode }));
    await render(Page, load);
    expect(api.getDuplicateCandidates).toHaveBeenCalledWith({ params: { mode, page: 1 } });
    await expect.element(page.getByText('no_duplicates_found', { exact: true })).toBeVisible();
  });
}
