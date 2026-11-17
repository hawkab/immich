<script lang="ts">
  import { searchManager } from '#lib/managers/search-manager.svelte.ts';
  import { createPreloadedQuery } from '#lib/queries/client.ts';
  import { getUserConfigQuery } from '#lib/queries/config-user.query.ts';
  import { Text } from '@immich/ui';
  import { t } from 'svelte-i18n';
  import SearchButton from './SearchButton.svelte';
  import { getSearchTypeTitle } from './search-bar-utils';

  const query = createPreloadedQuery(getUserConfigQuery);
  const config = $derived(query.data);

  let queryType = $derived(searchManager.filter.queryType);
  const useSceneDescriptions = $derived(
    searchManager.filter.useSceneDescriptions ?? config.machineLearning.clip.useSceneDescriptions ?? false,
  );
  const includeDepictions = $derived(
    searchManager.filter.includeDepictions ?? config.machineLearning.clip.includeDepictions ?? false,
  );

  const setType = (type: 'smart' | 'metadata' | 'description' | 'fullPath' | 'ocr') => {
    searchManager.setQueryType(type);
  };
</script>

<section>
  <fieldset>
    <Text class="mb-5">{$t('search_type_description')}</Text>
    <div class="flex flex-wrap gap-2">
      {#if config.machineLearning.clip.enabled}
        <SearchButton checked active={queryType === 'smart'} onclick={() => setType('smart')}>
          {$t('context')}
        </SearchButton>
      {/if}
      <SearchButton checked active={queryType === 'metadata'} onclick={() => setType('metadata')}>
        {getSearchTypeTitle('metadata')}
      </SearchButton>
      <SearchButton checked active={queryType === 'description'} onclick={() => setType('description')}>
        {getSearchTypeTitle('description')}
      </SearchButton>
      <SearchButton checked active={queryType === 'fullPath'} onclick={() => setType('fullPath')}>
        {getSearchTypeTitle('fullPath')}
      </SearchButton>
      {#if config.machineLearning.ocr.enabled}
        <SearchButton checked active={queryType === 'ocr'} onclick={() => setType('ocr')}>
          {getSearchTypeTitle('ocr')}
        </SearchButton>
      {/if}
    </div>
    {#if queryType === 'smart'}
      <div class="mt-3 flex flex-wrap gap-2">
        <SearchButton
          checked
          active={useSceneDescriptions}
          onclick={() => (searchManager.filter.useSceneDescriptions = true)}
        >
          {$t('search_scene_evidence')}
        </SearchButton>
        <SearchButton
          checked
          active={!useSceneDescriptions}
          onclick={() => (searchManager.filter.useSceneDescriptions = false)}
        >
          {$t('search_broad_similarity')}
        </SearchButton>
      </div>
      {#if useSceneDescriptions}
        <div class="mt-3">
          <SearchButton
            checked
            active={includeDepictions}
            onclick={() => (searchManager.filter.includeDepictions = !includeDepictions)}
          >
            {$t('search_include_depictions')}
          </SearchButton>
        </div>
      {/if}
    {/if}
  </fieldset>
</section>
