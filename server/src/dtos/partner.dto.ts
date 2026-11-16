import z from 'zod';
import { UserResponseSchema } from 'src/dtos/user.dto.js';
import { PartnerDirectionSchema } from 'src/enum.js';
import { createZodDto } from 'src/zod.js';

const PartnerCreateSchema = z
  .object({
    sharedWithId: z.uuidv4().describe('User ID to share with'),
  })
  .meta({ id: 'PartnerCreateDto' });

const PartnerUpdateSchema = z
  .object({
    inTimeline: z.boolean().describe('Show partner assets in timeline'),
  })
  .meta({ id: 'PartnerUpdateDto' });

const PartnerPermissionsSchema = z
  .object({
    canEdit: z.boolean().describe('Allow the recipient to edit shared photos and manage their faces'),
  })
  .meta({ id: 'PartnerPermissionsDto' });

const PartnerSearchSchema = z
  .object({
    direction: PartnerDirectionSchema,
  })
  .meta({ id: 'PartnerSearchDto' });

const PartnerResponseSchema = UserResponseSchema.extend({
  inTimeline: z.boolean().optional().describe('Show in timeline'),
  canEdit: z.boolean().optional().describe('Permission granted by the sharing owner to edit photos and faces'),
})
  .describe('Partner response')
  .meta({ id: 'PartnerResponseDto' });

export class PartnerCreateDto extends createZodDto(PartnerCreateSchema) {}
export class PartnerUpdateDto extends createZodDto(PartnerUpdateSchema) {}
export class PartnerPermissionsDto extends createZodDto(PartnerPermissionsSchema) {}
export class PartnerSearchDto extends createZodDto(PartnerSearchSchema) {}
export class PartnerResponseDto extends createZodDto(PartnerResponseSchema) {}
