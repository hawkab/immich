<script lang="ts">
  import { assetViewerManager } from '#lib/managers/asset-viewer-manager.svelte.ts';
  import type { AssetResponseDto } from '@immich/sdk';

  let { asset, onSync }: { asset: AssetResponseDto; onSync: () => void } = $props();
  $effect(() => {
    assetViewerManager.setAsset({ ...asset });
    onSync();
  });
</script>
