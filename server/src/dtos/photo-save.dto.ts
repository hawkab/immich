import z from 'zod';
import { createZodDto } from 'src/zod.js';

export class PhotoSaveParams extends createZodDto(z.object({ id: z.uuidv4(), requestId: z.uuidv4() })) {}
export class PhotoSaveStatusDto extends createZodDto(
  z
    .object({
      requestId: z.uuidv4(),
      status: z.enum(['processing', 'saved', 'failed']),
    })
    .meta({ id: 'PhotoSaveStatusDto' }),
) {}
