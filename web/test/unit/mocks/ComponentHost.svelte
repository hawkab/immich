<script lang="ts" generics="T extends Record<string, unknown>">
  import { TooltipProvider } from '@immich/ui';
  import type { Component } from 'svelte';

  let { component: TestComponent, props }: { component: Component<T>; props: T } = $props();
</script>

<TooltipProvider>
  <TestComponent {...props} />
</TooltipProvider>
