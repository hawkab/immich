import AnnotationTool from '#lib/components/asset-viewer/editor/annotation-tool/AnnotationTool.svelte';
import { annotationManager } from '#lib/managers/edit/annotation-manager.svelte.ts';
import { AnnotationBlurStyle, AnnotationBlurType, AnnotationRectangleShape } from '@immich/sdk';
import { tick } from 'svelte';
import { render } from 'vitest-browser-svelte';

afterEach(() => annotationManager.onDeactivate());

it('changes the selected blur from the real type selector using the new selection value', async () => {
  annotationManager.add({
    type: AnnotationBlurType.Blur,
    shape: AnnotationRectangleShape.Rectangle,
    style: AnnotationBlurStyle.Pixelated,
    strength: 0.025,
    points: [
      { x: 0.2, y: 0.3 },
      { x: 0.7, y: 0.8 },
    ],
  });
  const { baseElement } = await render(AnnotationTool);
  const selector = baseElement.querySelector<HTMLSelectElement>('#annotation-style')!;
  selector.value = 'frosted';
  selector.dispatchEvent(new Event('change', { bubbles: true }));
  await tick();
  expect(annotationManager.layers[0]).toMatchObject({ style: 'frosted' });
  annotationManager.undo();
  expect(annotationManager.layers[0]).toMatchObject({ style: 'pixelated' });
});
