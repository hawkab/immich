import { createZodDto } from 'nestjs-zod';
import z from 'zod';

export class VisualEvidenceDto extends createZodDto(
  z
    .object({
      assetId: z.uuidv4(),
      sourceChecksum: z.string(),
      generation: z.string().optional(),
      query: z.string().trim().min(1).optional(),
      queryAssetId: z.uuidv4().optional(),
      language: z.string().optional(),
      time: z.number().meta({ format: 'double' }).finite().nonnegative().optional(),
      localize: z.boolean().default(true),
    })
    .refine((value) => !!value.query || !!value.queryAssetId, { message: 'A query or reference asset is required' }),
) {}

export const VisualEvidenceSchema = z
  .object({
    assetId: z.uuidv4(),
    sourceChecksum: z.string(),
    generation: z.string(),
    model: z.string(),
    time: z.number().meta({ format: 'double' }).optional(),
    similarity: z.number().meta({ format: 'double' }),
    region: z.object({
      x: z.number().meta({ format: 'double' }),
      y: z.number().meta({ format: 'double' }),
      width: z.number().meta({ format: 'double' }),
      height: z.number().meta({ format: 'double' }),
    }),
    localized: z.boolean(),
  })
  .meta({ id: 'VisualEvidenceResponseDto' });
export class VisualEvidenceResponseDto extends createZodDto(VisualEvidenceSchema) {}
