import z from 'zod';
import emojiIds from 'src/data/editor-emoji-ids.json' with { type: 'json' };

const supportedEmoji = new Set(emojiIds);
const Unit = z.number().min(0).max(1).meta({ format: 'double' });
const Size = z.number().positive().max(1).meta({ format: 'double' });
const Point = z.object({ x: Unit, y: Unit }).meta({ id: 'AnnotationPoint' });
const blur = {
  type: z.literal('blur').meta({ id: 'AnnotationBlurType' }),
  style: z.enum(['pixelated', 'frosted']).meta({ id: 'AnnotationBlurStyle' }),
  strength: Size.describe('Effect strength as a fraction of the shorter image edge'),
};

export const AnnotationLayerSchema = z
  .union([
    z.object({
      ...blur,
      shape: z.literal('rectangle').meta({ id: 'AnnotationRectangleShape' }),
      points: z.array(Point).length(2),
    }),
    z.object({
      ...blur,
      shape: z.literal('brush').meta({ id: 'AnnotationBrushShape' }),
      points: z.array(Point).min(1),
      size: Size,
    }),
    z.object({
      type: z.literal('emoji').meta({ id: 'AnnotationEmojiType' }),
      emoji: z.string().refine((id) => supportedEmoji.has(id), { error: 'Choose an emoji from the catalog' }),
      x: Unit,
      y: Unit,
      size: Size,
    }),
  ])
  .meta({ id: 'AnnotationLayer' });

export const AnnotationParametersSchema = z
  .object({
    layers: z.array(AnnotationLayerSchema).min(1),
  })
  .describe('Ordered annotation layers in normalized coordinates of the oriented original image')
  .meta({ id: 'AnnotationParameters' });

export type AnnotationLayer = z.infer<typeof AnnotationLayerSchema>;
export type AnnotationParameters = z.infer<typeof AnnotationParametersSchema>;
