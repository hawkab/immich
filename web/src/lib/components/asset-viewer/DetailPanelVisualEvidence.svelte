<script lang="ts">
  import { assetViewerManager } from '#lib/managers/asset-viewer-manager.svelte.ts';
  import { queryClient } from '#lib/queries/client.ts';
  import { getVisualEvidenceQuery } from '#lib/queries/visual-evidence.query.ts';
  import { lang } from '#lib/stores/preferences.store.ts';
  import { searchMatchLabels, transcriptTimestamp } from '#lib/utils/search-match.ts';
  import { AssetTypeEnum, type AssetResponseDto, type SearchMatch, type VisualEvidenceResponseDto } from '@immich/sdk';
  import { onDestroy } from 'svelte';
  import { t } from 'svelte-i18n';

  let { asset, match }: { asset: AssetResponseDto; match: SearchMatch } = $props();
  let busy = $state(false);
  let evidence = $state<VisualEvidenceResponseDto>();
  let error = $state(false);
  let scanned = $state(0);
  let stopped = false;
  const revision = $derived(JSON.stringify([asset.thumbhash, asset.isEdited]));
  const video = $derived(asset.type === AssetTypeEnum.Video);
  const focus = (value: VisualEvidenceResponseDto) =>
    assetViewerManager.focusSearch({
      assetId: asset.id,
      checksum: asset.checksum,
      time: value.time,
      region: value.region,
    });
  onDestroy(() => {
    stopped = true;
  });
  const locate = async () => {
    stopped = false;
    busy = true;
    error = false;
    const id = asset.id;
    const base = {
      assetId: id,
      sourceChecksum: asset.checksum,
      query: match.query,
      queryAssetId: match.referenceAssetId,
      language: $lang,
    };
    try {
      let best: VisualEvidenceResponseDto | undefined;
      const duration = video ? (asset.duration ?? 0) / 1000 : 1;
      for (let time = 0; time < duration && !stopped && asset.id === id; time++) {
        const frame = await queryClient.fetchQuery(
          getVisualEvidenceQuery(
            {
              ...base,
              time: video ? time : undefined,
              localize: !video,
              generation: best?.generation,
            },
            revision,
          ),
        );
        if (stopped || asset.id !== id) return;
        if (!best || frame.similarity > best.similarity) best = frame;
        scanned = time + 1;
      }
      if (best && !stopped && asset.id === id) {
        evidence = video
          ? await queryClient.fetchQuery(
              getVisualEvidenceQuery(
                { ...base, time: best.time, generation: best.generation, localize: true },
                revision,
              ),
            )
          : best;
        if (!stopped && asset.id === id) focus(evidence);
      }
    } catch {
      if (!stopped && asset.id === id) error = true;
    } finally {
      busy = false;
    }
  };
</script>

<div class="mt-3 text-sm">
  <button type="button" class="text-primary underline" disabled={busy} onclick={locate}
    >{searchMatchLabels(
      { ...match, sources: match.sources.filter((source) => source === 'visual' || source === 'scene') },
      $t,
    ).join(' · ')} — {$t('search_match_show_region')}</button
  >
  {#if busy}<p role="status">{$t('search_match_locating')} {video ? transcriptTimestamp(scanned) : ''}</p>
    <button type="button" class="text-primary underline" onclick={() => (stopped = true)}>{$t('pause')}</button>{/if}
  {#if error}<p role="alert">{$t('search_match_unavailable')}</p>{/if}
  {#if evidence && evidence.sourceChecksum === asset.checksum}
    <p>
      <button type="button" class="text-primary underline" onclick={() => focus(evidence!)}>
        {#if evidence.time !== undefined}{transcriptTimestamp(evidence.time)} —
        {/if}
        {$t(evidence.localized ? 'search_match_region' : 'search_match_whole_frame')}
      </button>
    </p>
  {/if}
</div>
