<script lang="ts">
  import { t } from 'svelte-i18n';

  let {
    region,
    sequence,
  }: {
    region: { x: number; y: number; width: number; height: number };
    sequence: number;
  } = $props();
</script>

{#key sequence}
  <svg
    viewBox="0 0 100 100"
    preserveAspectRatio="none"
    class="search-region pointer-events-none absolute inset-0 size-full"
    role="img"
    aria-label={$t('search_match_region')}
  >
    <rect
      x={region.x * 100}
      y={region.y * 100}
      width={region.width * 100}
      height={region.height * 100}
      fill="none"
      stroke="#fbbf24"
      stroke-width="3"
      vector-effect="non-scaling-stroke"
    />
  </svg>
{/key}

<style>
  .search-region {
    filter: drop-shadow(0 0 3px black);
    animation: pulse 900ms ease-in-out 3;
  }
  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .search-region {
      animation: none;
    }
  }
</style>
