<script lang="ts">
  import { eventManager } from '#lib/managers/event-manager.svelte.ts';
  import {
    VIDEO_COMPRESSION,
    confirmVideoCompressionMutation,
    createVideoCompressionMutation,
    discardVideoCompressionMutation,
    getCompressedAssetQuery,
    getVideoCompressionQuery,
  } from '#lib/queries/video-compression.query.ts';
  import { getByteUnitString } from '#lib/utils/byte-units.ts';
  import { Confirmation, type AssetResponseDto } from '@immich/sdk';
  import { Button, IconButton } from '@immich/ui';
  import { mdiVideoBox } from '@mdi/js';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { Popover } from 'bits-ui';
  import { t } from 'svelte-i18n';

  let { asset }: { asset: AssetResponseDto } = $props();
  let open = $state(false);
  let quality = $state(55);
  let confirming = $state(false);
  let saveRequestId = $state<string>();
  let restoredRequestId = $state<string>();
  const client = useQueryClient();
  const query = createQuery(() => ({ ...getVideoCompressionQuery(asset.id), enabled: open }));
  const draft = $derived(query.data);
  const create = createMutation(() => createVideoCompressionMutation);
  const discard = createMutation(() => discardVideoCompressionMutation);
  const confirm = createMutation(() => confirmVideoCompressionMutation);
  const busy = $derived(
    create.isPending ||
      confirm.isPending ||
      discard.isPending ||
      ['queued', 'processing', 'saving'].includes(draft?.status ?? ''),
  );
  const ready = $derived(
    draft?.status === 'ready' && draft.quality === quality && draft.sourceChecksum === asset.checksum,
  );
  const preview = $derived(
    draft
      ? `/api/assets/${asset.id}/compression/preview?${new URLSearchParams({ requestId: draft.requestId, sourceChecksum: draft.sourceChecksum })}`
      : '',
  );

  const refresh = () => client.invalidateQueries({ queryKey: [VIDEO_COMPRESSION, asset.id] });

  const invoke = async (operation: () => Promise<unknown>) => {
    try {
      await operation();
      return true;
    } catch {
      return false;
    } finally {
      await refresh();
    }
  };

  const prepare = async () => {
    if (busy || ready) return;
    confirming = false;
    await invoke(() =>
      create.mutateAsync([
        {
          id: asset.id,
          videoCompressionCreateDto: {
            requestId: crypto.randomUUID(),
            sourceChecksum: asset.checksum,
            quality,
          },
        },
      ]),
    );
  };

  const cancel = async () => {
    const current = draft;
    if (current && !['saving', 'committed', 'discarded'].includes(current.status) && !confirm.isPending) {
      const canceled = await invoke(() =>
        discard.mutateAsync([
          {
            id: asset.id,
            videoCompressionRequestDto: {
              requestId: current.requestId,
              sourceChecksum: current.sourceChecksum,
            },
          },
        ]),
      );
      if (!canceled) return;
    }
    open = false;
  };

  const save = async () => {
    if (!ready || !draft || !confirming) return;
    saveRequestId = draft.requestId;
    await invoke(() =>
      confirm.mutateAsync([
        {
          id: asset.id,
          videoCompressionConfirmDto: {
            requestId: draft!.requestId,
            sourceChecksum: draft!.sourceChecksum,
            confirmation: Confirmation.ReplaceOriginal,
          },
        },
      ]),
    );
    confirming = false;
  };

  $effect(() => {
    if (open && draft && restoredRequestId !== draft.requestId) {
      quality = draft.quality;
      restoredRequestId = draft.requestId;
    }
    if (draft?.status === 'committed' && draft.requestId === saveRequestId) {
      saveRequestId = undefined;
      void client
        .fetchQuery(getCompressedAssetQuery(asset.id))
        .then((updated) => {
          eventManager.emit('AssetUpdate', updated);
          open = false;
        })
        .catch(() => undefined);
    }
  });
</script>

<Popover.Root
  bind:open
  onOpenChange={(value) => {
    if (!value) confirming = false;
  }}
>
  <Popover.Trigger>
    {#snippet child({ props })}
      <IconButton {...props} icon={mdiVideoBox} aria-label={$t('video_compression')} title={$t('video_compression')} />
    {/snippet}
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content
      role="dialog"
      side="bottom"
      align="end"
      sideOffset={8}
      collisionPadding={16}
      aria-label={$t('video_compression')}
      class="z-70 max-h-[calc(100dvh-6rem)] w-[min(38rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-gray-500 bg-immich-bg p-5 text-immich-fg shadow-xl dark:bg-immich-dark-bg dark:text-immich-dark-fg"
    >
      <h2 class="mb-3 text-lg font-semibold">{$t('video_compression')}</h2>
      <p class="mb-4 text-sm">{$t('video_compression_preview_description')}</p>
      <label for={`compression-quality-${asset.id}`} class="block font-medium"
        >{$t('video_compression_quality')}: {quality}</label
      >
      <input
        id={`compression-quality-${asset.id}`}
        type="range"
        min="0"
        max="100"
        step="1"
        bind:value={quality}
        disabled={busy}
        class="my-3 w-full accent-immich-primary"
        onchange={() => {
          confirming = false;
          void prepare();
        }}
      />
      <div class="mb-4 flex justify-between text-xs">
        <span>{$t('video_compression_smaller')}</span><span>{$t('video_compression_better')}</span>
      </div>
      {#if query.isError || create.isError || confirm.isError || discard.isError}
        <p role="alert" class="mb-3 text-red-500">{$t('video_compression_request_failed')}</p>
      {/if}
      {#if busy}<p role="status" class="my-3">
          {$t(draft?.status === 'saving' ? 'video_compression_saving' : 'video_compression_preparing')}
        </p>{/if}
      {#if draft?.status === 'committed'}<p role="status" class="my-3">{$t('video_compression_saved')}</p>{/if}
      {#if draft?.status === 'failed'}<p role="alert" class="my-3">{draft.error}</p>{/if}
      {#if ready && draft?.compressedSize !== undefined}
        <p class="my-3 font-medium">
          {getByteUnitString(draft.originalSize)} → {getByteUnitString(draft.compressedSize)}
        </p>
        <video
          src={preview}
          controls
          preload="metadata"
          playsinline
          class="mb-4 max-h-[45dvh] w-full rounded-sm bg-black"
        >
          <track kind="captions" />
        </video>
      {/if}
      {#if confirming}
        <div
          role="alertdialog"
          aria-label={$t('video_compression_confirm')}
          class="my-4 rounded-sm border border-red-400 p-4"
        >
          <p class="mb-3 font-semibold">{$t('video_compression_irreversible')}</p>
          <div class="flex flex-wrap gap-2">
            <Button color="danger" onclick={save} loading={confirm.isPending}>{$t('video_compression_replace')}</Button>
            <Button variant="ghost" onclick={() => (confirming = false)} disabled={confirm.isPending}
              >{$t('cancel')}</Button
            >
          </div>
        </div>
      {:else}
        <div class="flex flex-wrap gap-2">
          <Button onclick={prepare} disabled={busy || ready}>{$t('video_compression_preview')}</Button>
          <Button onclick={() => (confirming = true)} disabled={!ready || busy}>{$t('save')}</Button>
          <Button variant="ghost" onclick={cancel} disabled={confirm.isPending}
            >{$t(draft?.status === 'saving' || draft?.status === 'committed' ? 'close' : 'cancel')}</Button
          >
        </div>
      {/if}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
