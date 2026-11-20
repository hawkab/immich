import {
  annotationPoint,
  originalAnnotationPoint,
  renderAnnotations,
  transformedPreview,
  type AnnotationLayer,
} from '#lib/utils/annotations.ts';
import {
  AnnotationBlurStyle,
  AnnotationBlurType,
  AnnotationBrushShape,
  AnnotationRectangleShape,
  AssetEditAction,
} from '@immich/sdk';

const canvas = () => {
  const value = document.createElement('canvas');
  value.width = 96;
  value.height = 80;
  const ctx = value.getContext('2d')!;
  for (let y = 0; y < 80; y++) {
    for (let x = 0; x < 96; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#fff' : '#000';
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return value;
};
const pixel = (image: HTMLCanvasElement, x: number, y: number) => [
  ...image.getContext('2d')!.getImageData(x, y, 1, 1).data,
];

describe('photo annotation coordinates and rendering', () => {
  it('maps CSS pointer coordinates correctly at a different DPI and zoom', () => {
    expect(annotationPoint(110, 70, { left: 10, top: 20, width: 200, height: 100 })).toEqual({ x: 0.5, y: 0.5 });
    expect(annotationPoint(-1, 300, { left: 10, top: 20, width: 200, height: 100 })).toEqual({ x: 0, y: 1 });
  });
  it.each([AnnotationBlurStyle.Pixelated, AnnotationBlurStyle.Frosted])(
    'renders a %s rectangle without changing the original canvas or outside pixels',
    async (style) => {
      const original = canvas();
      const before = original.toDataURL();
      const layer: AnnotationLayer = {
        type: AnnotationBlurType.Blur,
        shape: AnnotationRectangleShape.Rectangle,
        style,
        strength: 0.1,
        points: [
          { x: 0.25, y: 0.25 },
          { x: 0.75, y: 0.75 },
        ],
      };
      const result = await renderAnnotations(original, [layer]);
      expect(result.toDataURL()).not.toBe(before);
      expect(original.toDataURL()).toBe(before);
      expect(pixel(result, 2, 2)).toEqual(pixel(original, 2, 2));
    },
  );
  it('brush uses the path and not its full bounding rectangle', async () => {
    const original = canvas();
    const result = await renderAnnotations(original, [
      {
        type: AnnotationBlurType.Blur,
        shape: AnnotationBrushShape.Brush,
        style: AnnotationBlurStyle.Frosted,
        strength: 0.1,
        size: 0.15,
        points: [
          { x: 0.2, y: 0.2 },
          { x: 0.8, y: 0.8 },
        ],
      },
    ]);
    expect(pixel(result, 48, 40)).not.toEqual(pixel(original, 48, 40));
    expect(pixel(result, 22, 59)).toEqual(pixel(original, 22, 59));
  });
  it('previews native crop and 90-degree rotation before annotations', async () => {
    const image = new Image();
    image.src = canvas().toDataURL();
    await image.decode();
    const result = transformedPreview(
      image,
      [
        { action: AssetEditAction.Crop, parameters: { x: 10, y: 5, width: 60, height: 40 } },
        { action: AssetEditAction.Rotate, parameters: { angle: 90 } },
      ],
      { width: 96, height: 80 },
    );
    expect([result.width, result.height]).toEqual([40, 60]);
  });
});

it('maps a pointer on the rotated crop back onto the original source pixels', () => {
  const result = originalAnnotationPoint(
    { x: 0.75, y: 1 / 3 },
    [
      { action: AssetEditAction.Crop, parameters: { x: 20, y: 10, width: 60, height: 40 } },
      { action: AssetEditAction.Rotate, parameters: { angle: 90 } },
    ],
    { width: 100, height: 80 },
  );
  expect(result.x).toBeCloseTo(0.4);
  expect(result.y).toBeCloseTo(0.25);
});
