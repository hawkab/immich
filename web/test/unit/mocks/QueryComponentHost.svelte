<script lang="ts" generics="T extends Record<string, unknown>">
  import { TooltipProvider } from '@immich/ui';
  import { QueryClientProvider, type QueryClient } from '@tanstack/svelte-query';
  import type { Component } from 'svelte';

  let {
    component: TestComponent,
    props,
    client,
  }: { component: Component<T>; props: T; client: QueryClient } = $props();
</script>

<QueryClientProvider {client}>
  <TooltipProvider><TestComponent {...props} /></TooltipProvider>
</QueryClientProvider>
