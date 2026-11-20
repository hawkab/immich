import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { AssetEditAction, type AssetEditActionItem } from 'src/dtos/editing.dto.js';
import { Colorspace, ImageEffort, ImageFormat } from 'src/enum.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MediaRepository } from 'src/repositories/media.repository.js';
import { automock } from 'test/utils.js';

it('renders annotations after crop and rotation and carries them into preview and thumbhash', async () => {
  const logger = automock(LoggingRepository, { args: [undefined, { getEnv: () => ({}) }], strict: false });
  const repository = new MediaRepository(logger);
  const input = await sharp({ create: { width: 160, height: 100, channels: 3, background: '#2255aa' } })
    .png()
    .toBuffer();
  const original = Buffer.from(input);
  const bitmap = await repository.decodeImage(input, { colorspace: Colorspace.Srgb, processInvalidImages: false });
  const edits: AssetEditActionItem[] = [
    { action: AssetEditAction.Crop, parameters: { x: 20, y: 10, width: 120, height: 80 } },
    { action: AssetEditAction.Rotate, parameters: { angle: 90 } },
    {
      action: AssetEditAction.Annotate,
      parameters: { layers: [{ type: 'emoji' as const, emoji: '1f600', x: 0.5, y: 0.5, size: 0.6 }] },
    },
  ];
  const directory = await mkdtemp(join(tmpdir(), 'immich-annotations-'));
  try {
    const output = join(directory, 'preview.webp');
    await repository.generateThumbnail(
      bitmap,
      {
        colorspace: Colorspace.Srgb,
        processInvalidImages: false,
        quality: 100,
        format: ImageFormat.Webp,
        effort: ImageEffort.Low,
        decodingTier: 0,
        edits,
      },
      output,
    );
    const image = await sharp(output).raw().toBuffer({ resolveWithObject: true });
    expect(image.info).toMatchObject({ width: 80, height: 120 });
    const channels = image.info.channels;
    const center = (60 * 80 + 40) * channels;
    expect(image.data[center]).toBeGreaterThan(100);
    const withLayers = await repository.generateThumbhash(bitmap, {
      colorspace: Colorspace.Srgb,
      processInvalidImages: false,
      edits,
    });
    const withoutLayers = await repository.generateThumbhash(bitmap, {
      colorspace: Colorspace.Srgb,
      processInvalidImages: false,
      edits: edits.slice(0, 2),
    });
    expect(withLayers).not.toEqual(withoutLayers);
    expect(input).toEqual(original);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('keeps full-resolution PNG pixels and transparency lossless instead of quantizing a palette', async () => {
  const logger = automock(LoggingRepository, { args: [undefined, { getEnv: () => ({}) }], strict: false });
  const repository = new MediaRepository(logger);
  const width = 48,
    height = 48;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) data.set([x * 5, y * 5, (x + y) * 2, x < 2 ? 0 : 255], (y * width + x) * 4);
  const directory = await mkdtemp(join(tmpdir(), 'immich-png-'));
  try {
    const output = join(directory, 'original.png');
    await repository.generateThumbnail(
      { data, info: { width, height, channels: 4 } },
      {
        colorspace: Colorspace.Srgb,
        processInvalidImages: false,
        quality: 80,
        effort: ImageEffort.Low,
        format: ImageFormat.Png,
        decodingTier: 0,
        edits: [],
      },
      output,
    );
    const info = await sharp(output).metadata();
    expect(info.isPalette).toBe(false);
    const result = await sharp(output).ensureAlpha().raw().toBuffer();
    expect(result).toEqual(data);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
