import z from 'zod';
import { createZodDto } from 'src/zod.js';

export const ShortLinkTargetSchema = z
  .object({ type: z.enum(['asset', 'album', 'person']), id: z.uuid() })
  .meta({ id: 'ShortLinkTarget' });
export class ShortLinkCreateDto extends createZodDto(ShortLinkTargetSchema) {}
export class ShortLinkCodeDto extends createZodDto(
  z.object({ code: z.string().regex(/^[A-Za-z0-9_-]{16}$/) }).meta({ id: 'ShortLinkCodeDto' }),
) {}
export class ShortLinkResponseDto extends createZodDto(
  z.object({ code: z.string(), path: z.string() }).meta({ id: 'ShortLinkResponseDto' }),
) {}
