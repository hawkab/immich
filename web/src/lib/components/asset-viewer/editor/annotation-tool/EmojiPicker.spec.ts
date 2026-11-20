import EmojiPicker from '#lib/components/asset-viewer/editor/annotation-tool/EmojiPicker.svelte';
import { annotationManager } from '#lib/managers/edit/annotation-manager.svelte.ts';
import { tick } from 'svelte';
import { render } from 'vitest-browser-svelte';

afterEach(() => annotationManager.onDeactivate());

it('searches the complete local catalog including Unicode 18 without rendering thousands of buttons upfront', async () => {
  const { baseElement } = await render(EmojiPicker);
  await vi.waitFor(() => expect(baseElement.querySelectorAll('button').length).toBeGreaterThan(0));
  expect(baseElement.querySelectorAll('button').length).toBeLessThan(400);
  const input = baseElement.querySelector<HTMLInputElement>('#editor-emoji-search')!;
  input.value = '1faeb';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await tick();
  const buttons = baseElement.querySelectorAll('button');
  expect(buttons).toHaveLength(1);
  buttons[0].click();
  expect(annotationManager.layers[0]).toMatchObject({ type: 'emoji', emoji: '1faeb' });
});
