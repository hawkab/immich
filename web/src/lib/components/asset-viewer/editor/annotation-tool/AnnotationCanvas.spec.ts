import AnnotationCanvas from '#lib/components/asset-viewer/editor/annotation-tool/AnnotationCanvas.svelte';
import { annotationManager } from '#lib/managers/edit/annotation-manager.svelte.ts';
import { transformManager } from '#lib/managers/edit/transform-manager.svelte.ts';
import { factory } from '#test/unit/factories.ts';
import { tick } from 'svelte';
import { render } from 'vitest-browser-svelte';

beforeEach(() => {
  annotationManager.onDeactivate();
  annotationManager.mode = 'rectangle';
  transformManager.reset();
  transformManager.cropImageSize = { width: 96, height: 80 };
  transformManager.originalImageSize = { width: 96, height: 80 };
  transformManager.region = { x: 0, y: 0, width: 96, height: 80 };
  vi.spyOn(HTMLCanvasElement.prototype, 'setPointerCapture').mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, 'hasPointerCapture').mockReturnValue(false);
});
afterEach(() => {
  annotationManager.onDeactivate();
  transformManager.reset();
  vi.restoreAllMocks();
});

async function surface() {
  const { baseElement } = await render(AnnotationCanvas, {
    asset: factory.asset({ exifInfo: { exifImageWidth: 96, exifImageHeight: 80 } }),
    src:
      'data:image/svg+xml,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="80"><rect width="96" height="80" fill="skyblue"/></svg>',
      ),
  });
  await vi.waitFor(() => expect(baseElement.querySelector('canvas')).not.toBeNull());
  return baseElement.querySelector('canvas')!;
}
function pointer(canvas: HTMLCanvasElement, type: string, x: number, y: number) {
  const bounds = canvas.getBoundingClientRect();
  canvas.dispatchEvent(
    new PointerEvent(type, {
      clientX: bounds.left + x * bounds.width,
      clientY: bounds.top + y * bounds.height,
      pointerId: 1,
      button: 0,
      bubbles: true,
    }),
  );
}

it('draws a rectangle as one undo step and cancels unfinished pointer gestures', async () => {
  const canvas = await surface();
  pointer(canvas, 'pointerdown', 0.2, 0.3);
  pointer(canvas, 'pointermove', 0.7, 0.8);
  pointer(canvas, 'pointerup', 0.7, 0.8);
  expect(annotationManager.layers).toHaveLength(1);
  expect(annotationManager.layers[0]).toMatchObject({
    type: 'blur',
    shape: 'rectangle',
    points: [
      { x: expect.closeTo(0.2), y: expect.closeTo(0.3) },
      { x: expect.closeTo(0.7), y: expect.closeTo(0.8) },
    ],
  });
  pointer(canvas, 'pointerdown', 0.1, 0.1);
  pointer(canvas, 'pointercancel', 0.4, 0.4);
  expect(annotationManager.layers).toHaveLength(1);
  annotationManager.undo();
  expect(annotationManager.layers).toEqual([]);
});

it('moves an inserted emoji by dragging while preserving the grab offset', async () => {
  const canvas = await surface();
  annotationManager.addEmoji('1f600');
  await tick();
  pointer(canvas, 'pointerdown', 0.53, 0.52);
  pointer(canvas, 'pointermove', 0.73, 0.32);
  pointer(canvas, 'pointerup', 0.73, 0.32);
  expect(annotationManager.layers[0]).toMatchObject({ type: 'emoji', x: expect.closeTo(0.7), y: expect.closeTo(0.3) });
});
