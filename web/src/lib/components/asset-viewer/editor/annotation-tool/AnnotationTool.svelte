<script lang="ts">
  import EmojiPicker from '#lib/components/asset-viewer/editor/annotation-tool/EmojiPicker.svelte';
  import { annotationManager as manager } from '#lib/managers/edit/annotation-manager.svelte.ts';
  import { AnnotationBlurStyle } from '@immich/sdk';
  import { Button, HStack } from '@immich/ui';
  import { t } from 'svelte-i18n';

  const modes = ['rectangle', 'brush', 'move'] as const;
  let showEmoji = $state(false);
  const selectedEmoji = $derived(manager.selected === null ? null : manager.layers[manager.selected]);
</script>

<div class="space-y-4 px-4">
  <h2>{$t('editor_annotation_tool')}</h2>
  <HStack>
    {#each modes as mode (mode)}
      <Button
        size="small"
        color={manager.mode === mode ? 'primary' : 'secondary'}
        onclick={() => {
          manager.mode = mode;
          manager.selected = null;
        }}
      >
        {$t(`editor_annotation_${mode}`)}
      </Button>
    {/each}
  </HStack>
  <label class="block" for="annotation-style">{$t('editor_blur_style')}</label>
  <select
    id="annotation-style"
    class="w-full rounded-lg border border-gray-500 p-2"
    bind:value={manager.style}
    onchange={(event) => manager.updateSelectedBlur({ style: event.currentTarget.value as AnnotationBlurStyle })}
  >
    <option value="pixelated">{$t('editor_blur_pixelated')}</option>
    <option value="frosted">{$t('editor_blur_frosted')}</option>
  </select>
  <label class="block" for="annotation-strength">{$t('editor_blur_strength')}</label>
  <input
    id="annotation-strength"
    class="w-full"
    type="range"
    min="0.005"
    max="0.15"
    step="0.005"
    bind:value={manager.strength}
    onchange={(event) => manager.updateSelectedBlur({ strength: Number(event.currentTarget.value) })}
  />
  {#if manager.mode === 'brush'}
    <label class="block" for="annotation-brush-size">{$t('editor_brush_size')}</label>
    <input
      id="annotation-brush-size"
      class="w-full"
      type="range"
      min="0.01"
      max="0.5"
      step="0.01"
      bind:value={manager.brushSize}
    />
  {/if}
  <Button size="small" onclick={() => (showEmoji = !showEmoji)}>{$t('editor_add_emoji')}</Button>
  {#if showEmoji}<EmojiPicker />{/if}
  {#if selectedEmoji?.type === 'emoji'}
    <label class="block" for="annotation-emoji-size">{$t('editor_emoji_size')}</label>
    <input
      id="annotation-emoji-size"
      class="w-full"
      type="range"
      min="0.02"
      max="1"
      step="0.01"
      value={selectedEmoji.size / manager.displayScale}
      onchange={(event) =>
        manager.updateEmoji(manager.selected!, { size: Number(event.currentTarget.value) * manager.displayScale })}
    />
  {/if}
  <HStack>
    <Button size="small" disabled={!manager.canUndo} onclick={() => manager.undo()}>{$t('undo')}</Button>
    <Button size="small" disabled={!manager.canRedo} onclick={() => manager.redo()}>{$t('redo')}</Button>
    <Button size="small" disabled={manager.selected === null} onclick={() => manager.removeSelected()}
      >{$t('delete')}</Button
    >
  </HStack>
  {#if manager.layers.length > 0}
    <ol class="max-h-40 space-y-1 overflow-y-auto" aria-label={$t('editor_annotation_layers')}>
      {#each manager.layers as layer, index (index)}
        <li>
          <button
            type="button"
            class="w-full rounded-lg p-2 text-left hover:bg-gray-600"
            aria-pressed={manager.selected === index}
            onclick={() => manager.select(index)}
          >
            {index + 1}. {layer.type === 'emoji'
              ? $t('editor_add_emoji')
              : $t(layer.shape === 'brush' ? 'editor_annotation_brush' : 'editor_annotation_rectangle')}
            {#if layer.type === 'blur'}
              — {$t(layer.style === 'frosted' ? 'editor_blur_frosted' : 'editor_blur_pixelated')}{/if}
          </button>
        </li>
      {/each}
    </ol>
  {/if}
  <p class="text-sm">{$t('editor_annotation_hint')}</p>
</div>
