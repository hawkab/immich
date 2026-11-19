<script lang="ts">
  import DetailPanelVisualEvidence from '#lib/components/asset-viewer/DetailPanelVisualEvidence.svelte';
  import { assetViewerManager } from '#lib/managers/asset-viewer-manager.svelte.ts';
  import { lang } from '#lib/stores/preferences.store.ts';
  import { searchFilterLabel, searchMatchLabels, transcriptTimestamp } from '#lib/utils/search-match.ts';
  import { Sources, getPerson, searchSmart, type AssetResponseDto, type SmartSearchDto } from '@immich/sdk';
  import { createQuery } from '@tanstack/svelte-query';
  import { t } from 'svelte-i18n';
  import { page } from '$app/state';

  let { asset }: { asset: AssetResponseDto } = $props();
  const terms = $derived.by(() => {
    if (!page.url.pathname.startsWith('/search')) return;
    try {
      const value = JSON.parse(page.url.searchParams.get('query') ?? '{}');
      return value && typeof value === 'object' ? (value as SmartSearchDto) : undefined;
    } catch {
      return;
    }
  });
  const explanation = createQuery(() => ({
    queryKey: ['search-match', asset.id, asset.checksum, terms, $lang],
    enabled: !!terms && (!!terms.query || !!terms.queryAssetId) && !asset.searchMatch,
    queryFn: ({ signal }) =>
      searchSmart(
        {
          smartSearchDto: {
            ...terms,
            explainAssetId: asset.id,
            size: 1,
            ...(!terms?.filter && { page: 1 }),
            language: $lang,
          },
        },
        { signal },
      ),
    select: (data) => data.assets.items.find((item) => item.id === asset.id)?.searchMatch,
  }));
  const focusSpeech = (timeOnly = false) => {
    if (!match?.speech) return;
    assetViewerManager.focusSearch({
      assetId: asset.id,
      checksum: asset.checksum,
      time: match.speech.start,
      ...(!timeOnly && { speech: match.speech }),
    });
  };
  const match = $derived(asset.searchMatch ?? explanation.data);
  const people = createQuery(() => ({
    queryKey: ['search-match-people', match?.filters],
    enabled: !!match?.filters.some((filter) => filter.field === 'personIds'),
    queryFn: async () => {
      const ids = match?.filters.find((filter) => filter.field === 'personIds')?.value.split(', ') ?? [];
      const people = await Promise.all(ids.map((id) => getPerson({ id })));
      return people.map((person) => person.name).join(', ');
    },
  }));
</script>

{#if match && match.sourceChecksum === asset.checksum}
  <section class="border-b border-gray-500/20 p-4" aria-label={$t('search_match_why')}>
    <h3 class="mb-2 font-medium">{$t('search_match_why')}</h3>
    {#if match.query}<p class="mb-2 text-sm">{$t('context')}: «{match.query}»</p>{/if}
    <ul class="list-inside list-disc text-sm">
      {#if match.sources.includes(Sources.Visual) || match.sources.includes(Sources.Scene)}
        <li>
          {#key JSON.stringify([asset.id, asset.checksum, asset.thumbhash, match])}<DetailPanelVisualEvidence
              {asset}
              {match}
            />{/key}
        </li>
      {/if}
      {#each searchMatchLabels({ ...match, sources: match.sources.filter((source) => source !== 'visual' && source !== 'scene') }, $t) as label (label)}<li
        >
          {label}
        </li>{/each}
      {#each match.filters as filter (filter.field)}<li>
          {searchFilterLabel(filter.field, $t)}: {filter.field === 'personIds'
            ? (people.data ?? $t('loading'))
            : filter.value}
        </li>{/each}
    </ul>
    {#if match.speech}<blockquote class="mt-3 border-l-2 border-primary pl-3 text-sm">
        <button type="button" class="font-mono text-primary underline" onclick={() => focusSpeech(true)}
          >{transcriptTimestamp(match.speech.start)}–{transcriptTimestamp(match.speech.end)}</button
        >
        <button type="button" class="text-start text-primary underline" onclick={() => focusSpeech()}
          >{match.speech.text}</button
        >
      </blockquote>{/if}
  </section>
{:else if terms && explanation.isPending}
  <p class="p-4 text-sm opacity-70">{$t('search_match_loading')}</p>
{:else if terms && explanation.isError}
  <p class="p-4 text-sm opacity-70">{$t('search_match_unavailable')}</p>
{/if}
