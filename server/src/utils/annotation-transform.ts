import type { AnnotationParameters } from 'src/dtos/annotation.dto.js';
import type { AssetEditActionItem } from 'src/dtos/editing.dto.js';
import type { ImageDimensions } from 'src/types.js';
import { getOutputDimensions, transformPoints } from 'src/utils/transform.js';

/** Project original-image annotations onto a transformed crop without losing their attachment to image content. */
export function projectAnnotations(
  parameters: AnnotationParameters,
  edits: AssetEditActionItem[],
  original: ImageDimensions,
): AnnotationParameters {
  const output = getOutputDimensions(edits, original);
  const scale = Math.min(original.width, original.height) / Math.min(output.width, output.height);
  const points = (input: { x: number; y: number }[]) =>
    transformPoints(
      input.map((p) => ({ x: p.x * original.width, y: p.y * original.height })),
      edits,
      original,
    ).points.map((p) => ({ x: p.x / output.width, y: p.y / output.height }));
  return {
    layers: parameters.layers.map((layer) =>
      layer.type === 'emoji'
        ? { ...layer, ...points([layer])[0], size: layer.size * scale }
        : layer.shape === 'brush'
          ? { ...layer, points: points(layer.points), strength: layer.strength * scale, size: layer.size * scale }
          : { ...layer, points: points(layer.points), strength: layer.strength * scale },
    ),
  };
}
