<script lang="ts">
  import { queryClient } from '#lib/queries/client.ts';
  import { getCandidateMemberQuery } from '#lib/queries/duplicate-candidates.query.ts';
  import { Route } from '#lib/route.ts';
  import { locale } from '#lib/stores/preferences.store.ts';
  import { getAssetMediaUrl } from '#lib/utils.ts';
  import { handleError } from '#lib/utils/handle-error.ts';
  import type { AssetResponseDto, DuplicateCandidateGroupDto } from '@immich/sdk';
  import { Button, Text } from '@immich/ui';
  import { t } from 'svelte-i18n';

  let { group }: { group: DuplicateCandidateGroupDto } = $props();
  let members = $state<AssetResponseDto[]>(group.previews);
  let offset = $state(group.previews.length);
  let loading = $state(false);
  const reason = $derived(
    {
      checksum: $t('duplicate_reason_checksum'),
      visual: $t('duplicate_reason_visual'),
      size: $t('duplicate_reason_size'),
      name: $t('duplicate_reason_name'),
      metadata: $t('duplicate_reason_metadata'),
    }[group.reason],
  );

  const loadMore = async () => {
    if (loading) {
      return;
    }
    loading = true;
    try {
      const ids = group.assetIds.slice(offset, offset + 20);
      const assets = await Promise.all(ids.map((id) => queryClient.query(getCandidateMemberQuery(id))));
      members = [...members, ...assets];
      offset += ids.length;
    } catch (error) {
      handleError(error, $t('duplicate_candidate_load_error'));
    } finally {
      loading = false;
    }
  };
</script>

<article class="rounded-lg border p-4">
  <Text class="mb-3">{reason} · {group.assetIds.length}</Text>
  <div class="flex flex-wrap gap-4">
    {#each members as asset (asset.id)}
      <a href={Route.viewAsset({ id: asset.id })} class="block w-60 overflow-hidden rounded-sm border p-2">
        <img
          src={getAssetMediaUrl({ id: asset.id })}
          alt={asset.originalFileName}
          class="h-44 w-full object-contain"
          loading="lazy"
        />
        <Text size="small" class="mt-2 break-all">{asset.originalFileName}</Text>
        <Text size="small" color="muted">
          {new Date(asset.fileCreatedAt).toLocaleString($locale)} ·
          {asset.exifInfo?.fileSizeInByte?.toLocaleString($locale) ?? '—'} B
        </Text>
      </a>
    {/each}
  </div>
  {#if offset < group.assetIds.length}
    <Button class="mt-3" size="small" disabled={loading} onclick={loadMore}>
      {$t('duplicate_candidate_more')} ({offset}/{group.assetIds.length})
    </Button>
  {/if}
</article>
