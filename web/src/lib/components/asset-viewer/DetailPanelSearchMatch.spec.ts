import DetailPanelSearchMatch from '#lib/components/asset-viewer/DetailPanelSearchMatch.svelte';
import DetailPanelTranscript from '#lib/components/asset-viewer/DetailPanelTranscript.svelte';
import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { queryClient } from '#lib/queries/client.ts';
import { factory } from '#test/unit/factories.ts';
import { test } from '#test/unit/fixtures.ts';
import QueryComponentHost from '#test/unit/mocks/QueryComponentHost.svelte';
import { AssetTypeEnum, Sources } from '@immich/sdk';
import { expect } from 'vitest';
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
