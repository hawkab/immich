import type { EditActions } from '#lib/managers/edit/edit-manager.svelte.ts';
import { soften } from '#lib/utils/annotation-blur.ts';
import { buildAffineFromEdits } from '#lib/utils/editor.ts';
import type { AnnotationLayer, AnnotationPoint } from '@immich/sdk';

export {
  AnnotationBlurStyle,
  AnnotationBlurType,
  AnnotationBrushShape,
  AnnotationRectangleShape,
  AnnotationEmojiType,
} from '@immich/sdk';
export type { AnnotationPoint, AnnotationLayer } from '@immich/sdk';

export type BlurLayer = Extract<AnnotationLayer, { points: unknown }>;
export type EmojiLayer = Extract<AnnotationLayer, { emoji: string }>;

const canvas = (width: number, height: number) => {
  const result = document.createElement('canvas');
  result.width = width;
  result.height = height;
  return result;
};

/** Preview the same crop and affine order as MediaRepository, before applying annotation layers. */
export function transformedPreview(
  image: HTMLImageElement | HTMLCanvasElement,
  edits: EditActions,
  original: { width: number; height: number },
) {
  const crop = edits.find((e) => e.action === 'crop')?.parameters as
    { x: number; y: number; width: number; height: number } | undefined;
  const ratio = (image instanceof HTMLImageElement ? image.naturalWidth : image.width) / original.width;
  const region = crop ?? { x: 0, y: 0, width: original.width, height: original.height };
  const w = Math.max(1, Math.round(region.width * ratio));
  const h = Math.max(1, Math.round(region.height * ratio));
  const rotation = edits.find((e) => e.action === 'rotate')?.parameters as { angle: number } | undefined;
  const sideways = rotation && rotation.angle % 180 !== 0;
  const result = canvas(sideways ? h : w, sideways ? w : h);
  const ctx = result.getContext('2d')!;
  const { a, b, c, d } = buildAffineFromEdits(edits);
  ctx.translate(result.width / 2, result.height / 2);
  ctx.transform(a, c, b, d, 0, 0);
  ctx.drawImage(
    image,
    region.x * ratio,
    region.y * ratio,
    region.width * ratio,
    region.height * ratio,
    -w / 2,
    -h / 2,
    w,
    h,
  );
  return result;
}

const emojiImages = new Map<string, Promise<HTMLImageElement>>();
export function loadEmoji(id: string) {
  let pending = emojiImages.get(id);
  if (!pending) {
    pending = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.addEventListener('load', () => resolve(image), { once: true });
      image.addEventListener('error', () => reject(new Error('Unable to load emoji')), { once: true });
      image.src = `/editor-emoji/${id}.svg`;
    });
    emojiImages.set(id, pending);
    pending.catch(() => emojiImages.delete(id));
  }
  return pending;
}

function drawBlur(target: HTMLCanvasElement, layer: BlurLayer) {
  const { width, height } = target;
  const short = Math.min(width, height);
  const radius = layer.shape === 'brush' ? (layer.size * short) / 2 : 0;
  let minX = width,
    minY = height,
    maxX = 0,
    maxY = 0;
  for (const point of layer.points) {
    minX = Math.min(minX, point.x * width);
    minY = Math.min(minY, point.y * height);
    maxX = Math.max(maxX, point.x * width);
    maxY = Math.max(maxY, point.y * height);
  }
  const left = Math.min(width - 1, Math.max(0, Math.floor(minX - radius)));
  const top = Math.min(height - 1, Math.max(0, Math.floor(minY - radius)));
  const w = Math.max(1, Math.min(width, Math.ceil(maxX + radius)) - left);
  const h = Math.max(1, Math.min(height, Math.ceil(maxY + radius)) - top);
  const effect = canvas(w, h);
  const ctx = effect.getContext('2d')!;
  if (layer.style === 'pixelated') {
    const small = canvas(
      Math.max(1, Math.round(w / (layer.strength * short))),
      Math.max(1, Math.round(h / (layer.strength * short))),
    );
    const smallContext = small.getContext('2d')!;
    smallContext.imageSmoothingEnabled = false;
    smallContext.drawImage(target, left, top, w, h, 0, 0, small.width, small.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, w, h);
  } else {
    ctx.drawImage(target, left, top, w, h, 0, 0, w, h);
    ctx.putImageData(soften(ctx.getImageData(0, 0, w, h), Math.max(0.3, (layer.strength * short) / 3)), 0, 0);
  }
  if (layer.shape === 'brush') {
    const mask = canvas(w, h);
    const m = mask.getContext('2d')!;
    m.strokeStyle = 'white';
    m.fillStyle = 'white';
    m.lineWidth = layer.size * short;
    m.lineCap = 'round';
    m.lineJoin = 'round';
    const path = new Path2D();
    const first = layer.points[0];
    if (layer.points.length === 1) {
      path.arc(first.x * width - left, first.y * height - top, m.lineWidth / 2, 0, Math.PI * 2);
      m.fill(path);
    } else {
      path.moveTo(first.x * width - left, first.y * height - top);
      for (const point of layer.points.slice(1)) {
        path.lineTo(point.x * width - left, point.y * height - top);
      }
      m.stroke(path);
    }
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(mask, 0, 0);
  }
  target.getContext('2d')!.drawImage(effect, left, top);
}

/** Render local effects in layer order using only same-origin, bundled emoji artwork. */
export async function renderAnnotations(base: HTMLCanvasElement, layers: AnnotationLayer[]) {
  const result = canvas(base.width, base.height);
  const ctx = result.getContext('2d')!;
  ctx.drawImage(base, 0, 0);
  for (const layer of layers) {
    if (layer.type === 'blur') {
      drawBlur(result, layer);
    } else {
      const image = await loadEmoji(layer.emoji);
      const side = layer.size * Math.min(result.width, result.height);
      ctx.drawImage(image, layer.x * result.width - side / 2, layer.y * result.height - side / 2, side, side);
    }
  }
  return result;
}

/** Convert CSS pointer coordinates to image-relative coordinates, independent of zoom and device DPI. */
export function annotationPoint(
  clientX: number,
  clientY: number,
  bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
): AnnotationPoint {
  return {
    x: Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (clientY - bounds.top) / bounds.height)),
  };
}

/** Map a pointer on the transformed crop back to the original, oriented image. */
export function originalAnnotationPoint(
  point: AnnotationPoint,
  edits: EditActions,
  original: { width: number; height: number },
): AnnotationPoint {
  const crop = edits.find((edit) => edit.action === 'crop')?.parameters as
    { x: number; y: number; width: number; height: number } | undefined;
  const region = crop ?? { x: 0, y: 0, ...original };
  const rotation = edits.find((edit) => edit.action === 'rotate')?.parameters as { angle: number } | undefined;
  const sideways = rotation && rotation.angle % 180 !== 0;
  const width = sideways ? region.height : region.width;
  const height = sideways ? region.width : region.height;
  const { a, b, c, d } = buildAffineFromEdits(edits);
  const dx = (point.x - 0.5) * width;
  const dy = (point.y - 0.5) * height;
  const determinant = a * d - b * c;
  return {
    x: Math.max(0, Math.min(1, ((d * dx - b * dy) / determinant + region.width / 2 + region.x) / original.width)),
    y: Math.max(0, Math.min(1, ((-c * dx + a * dy) / determinant + region.height / 2 + region.y) / original.height)),
  };
}

export function annotationImage(image: HTMLImageElement) {
  const result = canvas(image.naturalWidth, image.naturalHeight);
  result.getContext('2d')!.drawImage(image, 0, 0);
  return result;
}
