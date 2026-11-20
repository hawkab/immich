<script lang="ts">
  import { annotationManager } from '#lib/managers/edit/annotation-manager.svelte.ts';
  import { onMount } from 'svelte';
  import { locale, t } from 'svelte-i18n';

  type Emoji = { id: string; emoji: string; en: string; ru: string; tags: string[]; group: number };
  const groups = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
  let entries = $state<Emoji[]>([]);
  let query = $state('');
  let error = $state(false);
  let category = $state('');
  let visibleCount = $state(96);
  let scrollArea: HTMLDivElement;
  let sentinel: HTMLDivElement;
  const resetPage = () => {
    visibleCount = 96;
  };
  const russian = $derived(($locale ?? '').startsWith('ru'));
  const visible = $derived(
    entries.filter(
      (entry) =>
        (category === '' || entry.group === Number(category)) &&
        [entry.en, entry.ru, entry.emoji, entry.id, ...entry.tags]
          .join(' ')
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase().trim()),
    ),
  );

  onMount(() => {
    const controller = new AbortController();
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && visibleCount < visible.length) {
          visibleCount += 96;
        }
      },
      { root: scrollArea },
    );
    observer.observe(sentinel);
    void fetch('/editor-emoji/catalog.json', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Emoji catalog unavailable');
        }
        entries = await response.json();
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          error = true;
        }
      });
    return () => {
      controller.abort();
      observer.disconnect();
    };
  });
</script>

<div class="mt-4">
  <label class="block text-sm" for="editor-emoji-search">{$t('editor_emoji_search')}</label>
  <input
    id="editor-emoji-search"
    class="my-2 w-full rounded-lg border border-gray-500 p-2"
    type="search"
    bind:value={query}
    oninput={resetPage}
  />
  <label class="sr-only" for="editor-emoji-group">{$t('editor_emoji_category')}</label>
  <select
    id="editor-emoji-group"
    class="mb-2 w-full rounded-lg border border-gray-500 p-2"
    bind:value={category}
    onchange={resetPage}
  >
    <option value="">{$t('all')}</option>
    {#each groups as group (group)}
      <option value={String(group)}>{$t(`editor_emoji_group_${group}`)}</option>
    {/each}
  </select>
  {#if error}<p role="alert">{$t('editor_annotation_load_error')}</p>{/if}
  <div
    bind:this={scrollArea}
    class="grid max-h-72 grid-cols-6 gap-1 overflow-y-auto"
    aria-label={$t('editor_emoji_catalog')}
  >
    {#each visible.slice(0, visibleCount) as entry (entry.id)}
      <button
        type="button"
        class="flex size-10 items-center justify-center rounded-lg hover:bg-gray-600 focus:ring-2"
        style="content-visibility:auto;contain-intrinsic-size:40px"
        aria-label={russian ? entry.ru : entry.en}
        title={russian ? entry.ru : entry.en}
        onclick={() => annotationManager.addEmoji(entry.id)}
      >
        <img src={`/editor-emoji/${entry.id}.svg`} alt={entry.emoji} width="30" height="30" loading="lazy" />
      </button>
    {/each}
    <div bind:this={sentinel} class="col-span-full h-1" aria-hidden="true"></div>
  </div>
  <p class="mt-2 text-xs">Twemoji · OpenMoji</p>
</div>
