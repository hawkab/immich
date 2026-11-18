import VideoCompression from '#lib/components/asset-viewer/VideoCompression.svelte';
import { queryClient } from '#lib/queries/client.ts';
import { factory } from '#test/unit/factories.ts';
import { test } from '#test/unit/fixtures.ts';
import QueryComponentHost from '#test/unit/mocks/QueryComponentHost.svelte';
import { AssetTypeEnum, Confirmation, Status, type VideoCompressionPreview } from '@immich/sdk';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

const asset = factory.asset({ type: AssetTypeEnum.Video, checksum: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA=' });
const draft = (): VideoCompressionPreview => ({
  requestId: 'a48abf9a-85ef-4e20-94ce-d8a3f00f17e6',
  sourceChecksum: asset.checksum,
  quality: 55,
  status: Status.Ready,
  originalSize: 1024 * 1024 * 900,
  compressedSize: 1024 * 1024 * 20,
});
const show = async () => {
  await render(QueryComponentHost, { props: { component: VideoCompression, props: { asset }, client: queryClient } });
  await page.getByRole('button', { name: 'video_compression', exact: true }).click();
};

test('opens a nearby popup and keeps save disabled before a preview exists', async ({ api, settle }) => {
  api.on({ getVideoCompression: () => ({ json: { draft: null } }) });
  await show();
  await settle();
  await expect.element(page.getByRole('dialog', { name: 'video_compression' })).toBeVisible();
  await expect.element(page.getByRole('slider')).toHaveAttribute('min', '0');
  await expect.element(page.getByRole('slider')).toHaveAttribute('max', '100');
  await expect.element(page.getByRole('button', { name: 'save', exact: true })).toBeDisabled();
  expect(api.confirmVideoCompression).not.toHaveBeenCalled();
});

test('shows measured size and requires a second explicit confirmation', async ({ api, settle }) => {
  api.on({ getVideoCompression: () => ({ json: { draft: draft() } }) });
  await show();
  await settle();
  await expect.element(page.getByText('900 MiB → 20 MiB')).toBeVisible();
  await page.getByRole('button', { name: 'save', exact: true }).click();
  await expect.element(page.getByRole('alertdialog', { name: 'video_compression_confirm' })).toBeVisible();
  await expect.element(page.getByText('video_compression_irreversible')).toBeVisible();
  expect(api.confirmVideoCompression).not.toHaveBeenCalled();
});

test('sends the reviewed request and checksum only after irreversible confirmation', async ({ api, data, settle }) => {
  let state = draft();
  data.addAssets(asset);
  api.on({
    getVideoCompression: () => ({ json: { draft: state } }),
    confirmVideoCompression: () => {
      state = { ...state, status: Status.Committed };
      return { json: { draft: state } };
    },
  });
  await show();
  await settle();
  await page.getByRole('button', { name: 'save', exact: true }).click();
  await page.getByRole('button', { name: 'video_compression_replace', exact: true }).click();
  await settle();
  expect(api.confirmVideoCompression).toHaveBeenCalledWith({
    params: { id: asset.id },
    body: {
      requestId: state.requestId,
      sourceChecksum: asset.checksum,
      confirmation: Confirmation.ReplaceOriginal,
    },
  });
});

test('canceling the warning does not replace the original', async ({ api, settle }) => {
  api.on({ getVideoCompression: () => ({ json: { draft: draft() } }) });
  await show();
  await settle();
  await page.getByRole('button', { name: 'save', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'cancel', exact: true }).click();
  expect(api.confirmVideoCompression).not.toHaveBeenCalled();
  await expect.element(page.getByRole('button', { name: 'save', exact: true })).toBeEnabled();
});

test('cannot save a stale preview from another original', async ({ api, settle }) => {
  api.on({
    getVideoCompression: () => ({ json: { draft: { ...draft(), sourceChecksum: 'BBBBBBBBBBBBBBBBBBBBBBBBBBB=' } } }),
  });
  await show();
  await settle();
  await expect.element(page.getByRole('button', { name: 'save', exact: true })).toBeDisabled();
  expect(api.confirmVideoCompression).not.toHaveBeenCalled();
});
