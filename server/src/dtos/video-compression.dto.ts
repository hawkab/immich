import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const request = z.object({
  requestId: z.uuid().describe('Idempotency key for this preview'),
  sourceChecksum: z
    .string()
    .regex(/^[A-Za-z0-9+/]{27}=$/)
    .describe('Original asset SHA1 in base64'),
});

export class VideoCompressionCreateDto extends createZodDto(
  request
    .extend({
      quality: z.number().int().min(0).max(100).describe('Higher values retain more quality'),
    })
    .meta({ id: 'VideoCompressionCreateDto' }),
) {}

export class VideoCompressionConfirmDto extends createZodDto(
  request
    .extend({
      confirmation: z.literal('replace-original').describe('Explicit irreversible replacement confirmation'),
    })
    .meta({ id: 'VideoCompressionConfirmDto' }),
) {}

export class VideoCompressionRequestDto extends createZodDto(request.meta({ id: 'VideoCompressionRequestDto' })) {}

const preview = z
  .object({
    requestId: z.uuid(),
    sourceChecksum: z.string(),
    quality: z.number().int(),
    status: z.enum(['queued', 'processing', 'ready', 'failed', 'saving', 'committed', 'discarded']),
    originalSize: z.number().int(),
    compressedSize: z.number().int().optional(),
    error: z.string().optional(),
  })
  .meta({ id: 'VideoCompressionPreview' });

export class VideoCompressionResponseDto extends createZodDto(
  z.object({ draft: preview.nullable() }).meta({ id: 'VideoCompressionResponseDto' }),
) {}
