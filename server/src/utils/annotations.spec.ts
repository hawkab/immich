import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { AnnotationParametersSchema, type AnnotationLayer } from 'src/dtos/annotation.dto.js';
import { AssetEditsCreateDto } from 'src/dtos/editing.dto.js';
import type { Bitmap } from 'src/types.js';
import { applyAnnotations } from 'src/utils/annotations.js';

const image = (): Bitmap => {
  const width = 96,
    height = 80;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = (x + y) % 2 ? 240 : 16;
      data.set([value, value, value, 255], (y * width + x) * 4);
    }
  }
  return { data, info: { width, height, channels: 4 } };
};
const pixel = (bitmap: Bitmap, x: number, y: number) => [
  ...bitmap.data.subarray((y * bitmap.info.width + x) * 4, (y * bitmap.info.width + x) * 4 + 4),
];
const region: AnnotationLayer = {
  type: 'blur',
  shape: 'rectangle',
  style: 'frosted',
  strength: 0.15,
  points: [
    { x: 0.25, y: 0.25 },
    { x: 0.75, y: 0.75 },
  ],
};

describe('native photo annotation rendering', () => {
  it.each(['pixelated', 'frosted'] as const)('%s changes only the requested rectangle', async (style) => {
    const original = image();
    const checksum = Buffer.from(original.data);
    const result = await applyAnnotations(original, { layers: [{ ...region, style }] });
    expect(result.data).not.toEqual(original.data);
    expect(pixel(result, 1, 1)).toEqual(pixel(original, 1, 1));
    expect(pixel(result, 80, 70)).toEqual(pixel(original, 80, 70));
    expect(original.data).toEqual(checksum);
    expect(result.info).toMatchObject({ width: 96, height: 80 });
  });

  it('paints a round brush path without filling the path bounding rectangle', async () => {
    const original = image();
    const result = await applyAnnotations(original, {
      layers: [
        {
          type: 'blur',
          shape: 'brush',
          style: 'frosted',
          strength: 0.1,
          size: 0.2,
          points: [
            { x: 0.2, y: 0.2 },
            { x: 0.8, y: 0.8 },
          ],
        },
      ],
    });
    expect(pixel(result, 48, 40)).not.toEqual(pixel(original, 48, 40));
    expect(pixel(result, 21, 59)).toEqual(pixel(original, 21, 59));
  });

  it('supports a brush dot and clips it at an image edge', async () => {
    const result = await applyAnnotations(image(), {
      layers: [
        { type: 'blur', shape: 'brush', style: 'pixelated', strength: 0.2, size: 0.3, points: [{ x: 1, y: 0 }] },
      ],
    });
    expect(result.info).toMatchObject({ width: 96, height: 80 });
  });

  it.each(['1f600', '1f469-1f3fd-200d-1f4bb', '1f1f7-1f1fa', '1faeb'])(
    'renders bundled emoji %s without network or host fonts',
    async (emoji) => {
      const original = image();
      const result = await applyAnnotations(original, {
        layers: [{ type: 'emoji', emoji, x: 0.5, y: 0.5, size: 0.5 }],
      });
      expect(result.data).not.toEqual(original.data);
      expect(pixel(result, 0, 0)).toEqual(pixel(original, 0, 0));
    },
  );

  it('clips a partially off-image emoji', async () => {
    const result = await applyAnnotations(image(), {
      layers: [{ type: 'emoji', emoji: '1f600', x: 0, y: 1, size: 0.5 }],
    });
    expect(result.info).toMatchObject({ width: 96, height: 80 });
  });

  it('keeps layer order: a blur above an emoji changes the emoji pixels', async () => {
    const emoji: AnnotationLayer = { type: 'emoji', emoji: '1f600', x: 0.5, y: 0.5, size: 0.4 };
    const first = await applyAnnotations(image(), { layers: [region, emoji] });
    const second = await applyAnnotations(image(), { layers: [emoji, region] });
    expect(first.data).not.toEqual(second.data);
    await expect(sharp(second.data, { raw: second.info }).png().toBuffer()).resolves.toBeInstanceOf(Buffer);
  });
});

describe('annotation input contract', () => {
  it('accepts native annotations alongside existing crop/rotate edits', () => {
    expect(
      AssetEditsCreateDto.schema.safeParse({
        edits: [
          { action: 'crop', parameters: { x: 0, y: 0, width: 100, height: 80 } },
          { action: 'rotate', parameters: { angle: 90 } },
          { action: 'annotate', parameters: { layers: [region] } },
        ],
      }).success,
    ).toBe(true);
  });
  it.each(['../secret', '<svg onload="alert(1)"/>', '1f600.svg', 'https://example.com/a.svg'])(
    'rejects arbitrary artwork %s',
    (emoji) => {
      expect(
        AnnotationParametersSchema.safeParse({ layers: [{ type: 'emoji', emoji, x: 0.5, y: 0.5, size: 0.2 }] }).success,
      ).toBe(false);
    },
  );
  it.each([-0.1, 1.1, NaN, Infinity])('rejects invalid coordinates %s', (x) => {
    expect(
      AnnotationParametersSchema.safeParse({ layers: [{ type: 'emoji', emoji: '1f600', x, y: 0.5, size: 0.2 }] })
        .success,
    ).toBe(false);
  });
  it('rejects duplicate annotation operations but allows many ordered layers', () => {
    const action = { action: 'annotate', parameters: { layers: Array.from({ length: 200 }, () => region) } };
    expect(AssetEditsCreateDto.schema.safeParse({ edits: [action] }).success).toBe(true);
    expect(AssetEditsCreateDto.schema.safeParse({ edits: [action, action] }).success).toBe(false);
  });
});
