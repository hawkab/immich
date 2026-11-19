import DetailPanelSearchMatch from '#lib/components/asset-viewer/DetailPanelSearchMatch.svelte';
import DetailPanelTranscript from '#lib/components/asset-viewer/DetailPanelTranscript.svelte';
import SearchMatchOverlay from '#lib/components/asset-viewer/SearchMatchOverlay.svelte';
import AssetSyncProbe from '#lib/components/asset-viewer/fixtures/AssetSyncProbe.svelte';
import { assetViewerManager } from '#lib/managers/asset-viewer-manager.svelte.ts';
import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { queryClient } from '#lib/queries/client.ts';
import { factory } from '#test/unit/factories.ts';
import { test } from '#test/unit/fixtures.ts';
import QueryComponentHost from '#test/unit/mocks/QueryComponentHost.svelte';
import { AssetTypeEnum, Sources } from '@immich/sdk';
import { expect, vitest } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

test('keeps the transcript collapsed and renders its words once with timestamps', async ({ api, data, settle }) => {
  const asset = factory.asset({ type: AssetTypeEnum.Video });
  authManager.setUser(data.user);
  const text = 'Путешествие на море';
  api.on({
    getAssetMetadata: () => ({
      status: 200,
      json: [
        {
          key: 'org.immich.transcript.v1',
          value: { sourceChecksum: asset.checksum, status: 'complete', text, segments: [{ text, start: 12, end: 16 }] },
        },
      ],
    }),
  });
  await render(QueryComponentHost, {
    props: { component: DetailPanelTranscript, props: { asset }, client: queryClient },
  });
  await settle();
  expect(document.querySelector('details')?.open).toBe(false);
  expect(document.querySelectorAll('section[aria-label="video_transcript"] > p')).toHaveLength(0);
  expect(document.querySelectorAll('details')).toHaveLength(1);
  await page.getByText('transcript_segments', { exact: true }).click();
  await expect.element(page.getByText('0:12')).toBeVisible();
  expect(document.body.textContent?.split(text).length).toBe(2);
});

test('shows an actual speech match and timestamp instead of inventing a visual match', async () => {
  const asset = factory.asset({
    searchMatch: {
      sourceChecksum: 'bound-source',
      query: 'море',
      sources: [Sources.SpeechSemantic],
      filters: [],
      speech: { text: 'Отдыхаем на побережье', start: 40, end: 43 },
    },
    checksum: 'bound-source',
  });
  await render(QueryComponentHost, {
    props: { component: DetailPanelSearchMatch, props: { asset }, client: queryClient },
  });
  await expect.element(page.getByText('search_match_speech_semantic')).toBeVisible();
  await expect.element(page.getByText('0:40–0:43')).toBeVisible();
  await expect.element(page.getByText('search_match_visual')).not.toBeInTheDocument();
});

test('does not show an explanation bound to an older source', async () => {
  const asset = factory.asset({
    checksum: 'current',
    searchMatch: { sourceChecksum: 'old', sources: [Sources.Visual], filters: [] },
  });
  await render(QueryComponentHost, {
    props: { component: DetailPanelSearchMatch, props: { asset }, client: queryClient },
  });
  await expect.element(page.getByText('search_match_why')).not.toBeInTheDocument();
});

test('clicking a matched phrase opens and highlights the transcript; timestamps seek the right asset', async ({
  api,
  data,
  settle,
}) => {
  const text = 'На побережье тихо';
  const asset = factory.asset({
    type: AssetTypeEnum.Video,
    searchMatch: {
      sourceChecksum: 'same',
      query: 'море',
      sources: [Sources.SpeechSemantic],
      filters: [],
      speech: { text, start: 40, end: 43 },
    },
    checksum: 'same',
  });
  authManager.setUser(data.user);
  assetViewerManager.searchFocus = undefined;
  api.on({
    getAssetMetadata: () => ({
      status: 200,
      json: [
        {
          key: 'org.immich.transcript.v1',
          value: {
            sourceChecksum: 'same',
            status: 'complete',
            text,
            segments: [
              { text: 'Начало', start: 0, end: 3 },
              { text, start: 40, end: 43 },
            ],
          },
        },
      ],
    }),
  });
  await render(QueryComponentHost, {
    props: { component: DetailPanelTranscript, props: { asset }, client: queryClient },
  });
  await render(QueryComponentHost, {
    props: { component: DetailPanelSearchMatch, props: { asset }, client: queryClient },
  });
  await settle();
  expect(document.querySelector('details')?.open).toBe(false);
  await page.getByRole('button', { name: text, exact: true }).click();
  await settle();
  expect(document.querySelector('details')?.open).toBe(true);
  expect(document.querySelector('[data-search-hit="true"]')?.textContent).toContain(text);
  expect(document.querySelectorAll('details [data-search-hit="true"]')).toHaveLength(1);
  expect(assetViewerManager.searchFocus).toMatchObject({ assetId: asset.id, checksum: 'same', time: 40 });
  await page.getByRole('button', { name: '0:40–0:43' }).click();
  expect(assetViewerManager.searchFocus).toMatchObject({ time: 40 });
});

test('renders normalized measured coordinates as an overlay', async () => {
  await render(SearchMatchOverlay, { props: { region: { x: 0.5, y: 0.25, width: 0.4, height: 0.5 }, sequence: 1 } });
  const rect = document.querySelector('svg[aria-label="search_match_region"] rect');
  expect(rect?.getAttribute('x')).toBe('50');
  expect(rect?.getAttribute('y')).toBe('25');
  expect(rect?.getAttribute('width')).toBe('40');
  expect(rect?.getAttribute('height')).toBe('50');
});

test('a visual explanation locates a real candidate frame and sends its measured box to the viewer', async ({
  api,
  settle,
}) => {
  const asset = factory.asset({
    type: AssetTypeEnum.Video,
    duration: 2500,
    checksum: 'visual-source',
    searchMatch: {
      sourceChecksum: 'visual-source',
      query: 'самолёт',
      sources: [Sources.Visual],
      filters: [],
    },
  });
  api.on({
    getVisualEvidence: ({ body }) => ({
      status: 200,
      json: {
        assetId: asset.id,
        sourceChecksum: 'visual-source',
        generation: 'one-generation',
        model: 'fixture-clip',
        time: body.time,
        similarity: body.time === 1 ? 0.9 : 0.2,
        localized: body.localize,
        region: body.localize ? { x: 0.5, y: 0.25, width: 0.5, height: 0.5 } : { x: 0, y: 0, width: 1, height: 1 },
      },
    }),
  });
  await render(QueryComponentHost, {
    props: { component: DetailPanelSearchMatch, props: { asset }, client: queryClient },
  });
  await page.getByRole('button', { name: 'search_match_visual — search_match_show_region' }).click();
  await expect.element(page.getByRole('button', { name: '0:01 — search_match_region' })).toBeVisible();
  await settle();
  expect(api.getVisualEvidence.calls.map((call) => [call.body.time, call.body.localize])).toEqual([
    [0, false],
    [1, false],
    [2, false],
    [1, true],
  ]);
  expect(assetViewerManager.searchFocus).toMatchObject({
    assetId: asset.id,
    time: 1,
    region: { x: 0.5, y: 0.25, width: 0.5, height: 0.5 },
  });
});

test('a visual region cannot follow an edited preview with an unchanged original checksum', () => {
  const asset = factory.asset({ checksum: 'same-original', thumbhash: 'first-preview' });
  assetViewerManager.focusSearch({
    assetId: asset.id,
    checksum: asset.checksum,
    revision: JSON.stringify([asset.thumbhash, asset.isEdited]),
    region: { x: 0.5, y: 0, width: 0.5, height: 1 },
  });
  expect(assetViewerManager.getSearchFocus(asset)).toBeDefined();
  expect(assetViewerManager.getSearchFocus({ ...asset, thumbhash: 'edited-preview' })).toBeUndefined();
});

test('synchronizing the current asset does not subscribe the caller to its own write', async ({ settle }) => {
  const asset = factory.asset();
  const onSync = vitest.fn();
  await render(AssetSyncProbe, { props: { asset, onSync } });
  await settle();
  expect(onSync).toHaveBeenCalledTimes(1);
  expect(assetViewerManager.asset?.id).toBe(asset.id);
});
