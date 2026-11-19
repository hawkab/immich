<script lang="ts">
  import { authManager } from '#lib/managers/auth-manager.svelte.ts';
  import { getTranscriptQuery } from '#lib/queries/transcription.query.ts';
  import { AssetTypeEnum, type AssetResponseDto } from '@immich/sdk';
  import { createQuery } from '@tanstack/svelte-query';
  import { t } from 'svelte-i18n';

  let { asset }: { asset: AssetResponseDto } = $props();
  const query = createQuery(() => ({
    ...getTranscriptQuery(asset.id),
    enabled: asset.type === AssetTypeEnum.Video && !authManager.isSharedLink,
  }));
  const transcript = $derived(query.data?.sourceChecksum === asset.checksum ? query.data : undefined);
  const timestamp = (seconds: number) =>
    `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
      .toString()
      .padStart(2, '0')}`;
</script>

{#if transcript?.text || transcript?.status === 'processing'}
  <section class="p-4" aria-label={$t('video_transcript')}>
    <h3 class="mb-2 font-medium">{$t('video_transcript')}</h3>
    {#if transcript.status === 'processing'}<p class="text-sm opacity-70">{$t('transcription_processing')}</p>{/if}
    <details>
      <summary class="cursor-pointer text-sm">{$t('transcript_segments')}</summary>
      {#if transcript.segments?.length}
        {#each transcript.segments ?? [] as segment (segment.start)}
          {#if segment.text}<p class="mt-2 text-sm">
              <span class="font-mono opacity-60">{timestamp(segment.start)}</span>
              {segment.text}
            </p>{/if}
        {/each}
      {:else}<p class="mt-2 text-sm whitespace-pre-wrap">{transcript.text}</p>{/if}
    </details>
  </section>
{/if}
