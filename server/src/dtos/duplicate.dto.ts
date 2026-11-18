import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { AssetResponseSchema } from 'src/dtos/asset-response.dto.js';

const DuplicateResponseSchema = z
  .object({
    duplicateId: z.uuidv4().describe('Duplicate group ID'),
    assets: z.array(AssetResponseSchema).describe('Duplicate assets'),
    suggestedKeepAssetIds: z.array(z.uuidv4()).describe('Suggested asset IDs to keep based on file size and EXIF data'),
  })
  .meta({ id: 'DuplicateResponseDto' });

const DuplicateResolveGroupSchema = z
  .object({
    duplicateId: z.uuidv4(),
    keepAssetIds: z.array(z.uuidv4()).describe('Asset IDs to keep'),
    trashAssetIds: z.array(z.uuidv4()).describe('Asset IDs to trash or delete'),
  })
  .meta({ id: 'DuplicateResolveGroupDto' });

const DuplicateResolveSchema = z
  .object({
    groups: z.array(DuplicateResolveGroupSchema).min(1).describe('List of duplicate groups to resolve'),
  })
  .meta({ id: 'DuplicateResolveDto' });

export class DuplicateResponseDto extends createZodDto(DuplicateResponseSchema) {}
export class DuplicateResolveGroupDto extends createZodDto(DuplicateResolveGroupSchema) {}
export class DuplicateResolveDto extends createZodDto(DuplicateResolveSchema) {}

const DuplicateCandidateSearchSchema = z
  .object({
    mode: z.enum(['content', 'size', 'name', 'metadata']).default('content'),
    page: z.coerce.number().int().min(1).default(1),
    size: z.coerce.number().int().min(1).max(1000).default(50),
  })
  .meta({ id: 'DuplicateCandidateSearchDto' });

const DuplicateCandidateGroupSchema = z
  .object({
    key: z.string(),
    reason: z.enum(['checksum', 'visual', 'size', 'name', 'metadata']),
    assetIds: z.array(z.uuidv4()),
    previews: z.array(AssetResponseSchema),
  })
  .meta({ id: 'DuplicateCandidateGroupDto' });

const DuplicateCandidatesResponseSchema = z
  .object({
    groups: z.array(DuplicateCandidateGroupSchema),
    totalGroups: z.int(),
    page: z.int(),
    nextPage: z.int().nullable(),
    readOnly: z.literal(true),
  })
  .meta({ id: 'DuplicateCandidatesResponseDto' });

export class DuplicateCandidateSearchDto extends createZodDto(DuplicateCandidateSearchSchema) {}
export class DuplicateCandidatesResponseDto extends createZodDto(DuplicateCandidatesResponseSchema) {}
