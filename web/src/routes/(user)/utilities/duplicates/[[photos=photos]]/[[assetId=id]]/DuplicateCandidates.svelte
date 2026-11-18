<script lang="ts">
  import type { CandidateMode } from '#lib/queries/duplicate-candidates.query.ts';
  import { Route } from '#lib/route.ts';
  import type { DuplicateCandidatesResponseDto } from '@immich/sdk';
  import { Button, Text } from '@immich/ui';
  import { t } from 'svelte-i18n';
  import { goto } from '$app/navigation';
  import CandidateGroup from './CandidateGroup.svelte';

  let { data, mode }: { data: DuplicateCandidatesResponseDto; mode: CandidateMode } = $props();
</script>

<Text size="small" color="muted" class="mb-5">{$t('duplicate_candidate_scope')}</Text>
<div class="grid gap-5">
  {#each data.groups as group (group.key)}
    <CandidateGroup {group} />
  {:else}
    <Text>{$t('no_duplicates_found')}</Text>
  {/each}
</div>
<div class="mt-6 flex justify-center gap-4">
  <Button disabled={data.page <= 1} onclick={() => goto(Route.duplicatesUtility({ mode, page: data.page - 1 }))}>
    {$t('previous')}
  </Button>
  <Text>{data.page}</Text>
  <Button
    disabled={data.nextPage === null}
    onclick={() => data.nextPage && goto(Route.duplicatesUtility({ mode, page: data.nextPage }))}
  >
    {$t('next')}
  </Button>
</div>
