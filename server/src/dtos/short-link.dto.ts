import z from 'zod';
import { createZodDto } from 'nestjs-zod';

export const ShortLinkCreateSchema = z
  .object({ type: z.enum(['asset', 'album', 'person']).meta({ id: 'ShortLinkTargetType' }), id: z.uuid() })
  .meta({ id: 'ShortLinkCreateDto' });
export class ShortLinkCreateDto extends createZodDto(ShortLinkCreateSchema) {}
export class ShortLinkCodeDto extends createZodDto(
  z.object({ code: z.string().regex(/^[A-Za-z0-9_-]{16}$/) }).meta({ id: 'ShortLinkCodeDto' }),
) {}
export class ShortLinkResponseDto extends createZodDto(
  z.object({ code: z.string(), path: z.string() }).meta({ id: 'ShortLinkResponseDto' }),
) {}
