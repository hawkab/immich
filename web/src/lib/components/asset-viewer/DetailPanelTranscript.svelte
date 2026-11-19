<script lang="ts">
  import { assetViewerManager } from '#lib/managers/asset-viewer-manager.svelte.ts';
  import { authManager } from '#lib/managers/auth-manager.svelte.ts';
  import { getTranscriptQuery } from '#lib/queries/transcription.query.ts';
  import { AssetTypeEnum, type AssetResponseDto } from '@immich/sdk';
  import { createQuery } from '@tanstack/svelte-query';
  import { tick } from 'svelte';
  import { t } from 'svelte-i18n';

  let { asset }: { asset: AssetResponseDto } = $props();
  const query = createQuery(() => ({
    ...getTranscriptQuery(asset.id),
    enabled: asset.type === AssetTypeEnum.Video && !authManager.isSharedLink,
  }));
  const transcript = $derived(query.data?.sourceChecksum === asset.checksum ? query.data : undefined);
  let details: HTMLDetailsElement | undefined = $state();
  const focus = $derived(
    assetViewerManager.searchFocus?.assetId === asset.id && assetViewerManager.searchFocus.checksum === asset.checksum
      ? assetViewerManager.searchFocus
      : undefined,
  );
  $effect(() => {
    if (details && transcript && focus?.speech) {
      details.open = true;
      void tick().then(() =>
        details?.querySelector('[data-search-hit="true"]')?.scrollIntoView({
          block: 'center',
          behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
        }),
      );
    }
  });
  const isHit = (start: number, end: number) => !!focus?.speech && start < focus.speech.end && end > focus.speech.start;
  const seek = (time: number) => assetViewerManager.focusSearch({ assetId: asset.id, checksum: asset.checksum, time });
  const timestamp = (seconds: number) =>
    `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
      .toString()
      .padStart(2, '0')}`;
</script>

{#if transcript?.text || transcript?.status === 'processing'}
  <section class="p-4" aria-label={$t('video_transcript')}>
    <h3 class="mb-2 font-medium">{$t('video_transcript')}</h3>
    {#if transcript.status === 'processing'}<p class="text-sm opacity-70">{$t('transcription_processing')}</p>{/if}
    <details bind:this={details}>
      <summary class="cursor-pointer text-sm">{$t('transcript_segments')}</summary>
      {#if transcript.segments?.length}
        {#each transcript.segments ?? [] as segment (segment.start)}
          {#if segment.text}<p class="mt-2 text-sm" data-search-hit={isHit(segment.start, segment.end)}>
              <button type="button" class="font-mono text-primary underline" onclick={() => seek(segment.start)}
                >{timestamp(segment.start)}</button
              >
              {#key focus?.sequence}<span class:search-hit={isHit(segment.start, segment.end)}>{segment.text}</span
                >{/key}
            </p>{/if}
        {/each}
      {:else}<p class="mt-2 text-sm whitespace-pre-wrap" data-search-hit={!!focus?.speech}>
          <span class:search-hit={!!focus?.speech}>{transcript.text}</span>
        </p>{/if}
    </details>
  </section>
{/if}

<style>
  .search-hit {
    background: #fbbf2440;
    border-radius: 0.2rem;
    animation: found 1000ms ease-in-out 3;
  }
  @keyframes found {
    50% {
      background: #fbbf24b0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .search-hit {
      animation: none;
    }
  }
</style>
