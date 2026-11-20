import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { AnnotationLayer, AnnotationParameters } from 'src/dtos/annotation.dto.js';
import type { Bitmap } from 'src/types.js';

type Bounds = { left: number; top: number; width: number; height: number };
type BlurLayer = Extract<AnnotationLayer, { type: 'blur' }>;

let graphics: Promise<Record<string, string>> | undefined;
const loadGraphics = () =>
  (graphics ??= readFile(new URL('../data/editor-emoji-graphics.json', import.meta.url), 'utf8').then(
    (value) => JSON.parse(value) as Record<string, string>,
  ));

/** Find the smallest pixel rectangle needed by a normalized blur layer. */
const boundsOf = (layer: BlurLayer, width: number, height: number): Bounds | null => {
  const radius = layer.shape === 'brush' ? (layer.size * Math.min(width, height)) / 2 : 0;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (const point of layer.points) {
    minX = Math.min(minX, point.x * width);
    minY = Math.min(minY, point.y * height);
    maxX = Math.max(maxX, point.x * width);
    maxY = Math.max(maxY, point.y * height);
  }
  if (maxX + radius <= 0 || maxY + radius <= 0 || minX - radius >= width || minY - radius >= height) {
    return null;
  }
  const left = Math.min(width - 1, Math.max(0, Math.floor(minX - radius)));
  const top = Math.min(height - 1, Math.max(0, Math.floor(minY - radius)));
  return {
    left,
    top,
    width: Math.max(1, Math.min(width, Math.ceil(maxX + radius)) - left),
    height: Math.max(1, Math.min(height, Math.ceil(maxY + radius)) - top),
  };
};

/** Build a round-ended brush mask or a hard rectangular mask; no caller SVG is accepted. */
const maskFor = (layer: BlurLayer, bounds: Bounds, width: number, height: number) => {
  let shape = `<rect width="100%" height="100%" fill="white"/>`;
  if (layer.shape === 'brush') {
    const points = layer.points.map((p) => [p.x * width - bounds.left, p.y * height - bounds.top]);
    const radius = (layer.size * Math.min(width, height)) / 2;
    shape =
      points.length === 1
        ? `<circle cx="${points[0][0]}" cy="${points[0][1]}" r="${radius}" fill="white"/>`
        : `<polyline points="${points.map((p) => p.join(',')).join(' ')}" fill="none" stroke="white" stroke-width="${radius * 2}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}">${shape}</svg>`,
  );
};

async function blurLayer(image: Bitmap, layer: BlurLayer): Promise<Bitmap> {
  const { width, height } = image.info;
  const bounds = boundsOf(layer, width, height);
  if (!bounds) {
    return image;
  }
  const input = sharp(image.data, { raw: image.info }).extract(bounds);
  const effectSize = layer.strength * Math.min(width, height);
  let effect: Buffer;
  if (layer.style === 'pixelated') {
    const small = await input
      .resize(Math.max(1, Math.round(bounds.width / effectSize)), Math.max(1, Math.round(bounds.height / effectSize)), {
        kernel: 'nearest',
        fit: 'fill',
      })
      .png()
      .toBuffer();
    effect = await sharp(small)
      .resize(bounds.width, bounds.height, { kernel: 'nearest', fit: 'fill' })
      .png()
      .toBuffer();
  } else {
    // libvips accepts sigma up to 1000; scale the working image for larger physical blur radii.
    const sigma = Math.max(0.3, effectSize / 3);
    const scale = Math.min(1, 1000 / sigma);
    const small = await input
      .resize(Math.max(1, Math.round(bounds.width * scale)), Math.max(1, Math.round(bounds.height * scale)), {
        fit: 'fill',
      })
      .png()
      .toBuffer();
    const blurred = await sharp(small)
      .blur(sigma * scale)
      .png()
      .toBuffer();
    effect = await sharp(blurred).resize(bounds.width, bounds.height, { fit: 'fill' }).png().toBuffer();
  }
  const masked = await sharp(effect)
    .ensureAlpha()
    .composite([{ input: maskFor(layer, bounds, width, height), blend: 'dest-in' }])
    .png()
    .toBuffer();
  return sharp(image.data, { raw: image.info })
    .composite([{ input: masked, left: bounds.left, top: bounds.top }])
    .raw()
    .toBuffer({ resolveWithObject: true });
}

async function emojiLayer(
  image: Bitmap,
  layer: Extract<AnnotationLayer, { type: 'emoji' }>,
  affine?: [[number, number], [number, number]],
): Promise<Bitmap> {
  const graphics = await loadGraphics();
  const svg = graphics[layer.emoji];
  if (!svg) {
    throw new Error('Unsupported emoji');
  }
  const { width, height } = image.info;
  const side = Math.max(1, Math.round(layer.size * Math.min(width, height)));
  const left = Math.round(layer.x * width - side / 2);
  const top = Math.round(layer.y * height - side / 2);
  const x = Math.max(0, -left);
  const y = Math.max(0, -top);
  const visibleWidth = Math.min(side - x, width - Math.max(0, left));
  const visibleHeight = Math.min(side - y, height - Math.max(0, top));
  if (visibleWidth <= 0 || visibleHeight <= 0) {
    return image;
  }
  let graphic = sharp(Buffer.from(svg)).resize(side, side);
  if (affine) {
    graphic = graphic.affine(affine);
  }
  const rendered = await graphic.png().toBuffer();
  const cropped = await sharp(rendered)
    .extract({ left: x, top: y, width: visibleWidth, height: visibleHeight })
    .png()
    .toBuffer();
  return sharp(image.data, { raw: image.info })
    .composite([{ input: cropped, left: Math.max(0, left), top: Math.max(0, top) }])
    .raw()
    .toBuffer({ resolveWithObject: true });
}

/** Render ordered, editable layers on the display-space bitmap without modifying the original. */
export async function applyAnnotations(
  image: Bitmap,
  parameters: AnnotationParameters,
  affine?: [[number, number], [number, number]],
): Promise<Bitmap> {
  for (const layer of parameters.layers) {
    image = await (layer.type === 'blur' ? blurLayer(image, layer) : emojiLayer(image, layer, affine));
  }
  return image;
}
