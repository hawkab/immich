<script lang="ts">
  import { searchMatchLabels } from '#lib/utils/search-match.ts';
  import type { SearchMatch } from '@immich/sdk';
  import { t } from 'svelte-i18n';

  let { match }: { match: SearchMatch } = $props();
</script>

{#if match.sources.length}
  <span
    class="pointer-events-none absolute inset-x-1 bottom-1 truncate rounded-sm bg-black/75 px-2 py-1 text-xs text-white"
    title={searchMatchLabels(match, $t).join(' · ')}
  >
    {searchMatchLabels(match, $t).join(' · ')}
  </span>
{/if}
