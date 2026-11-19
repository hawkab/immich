import { spawn } from 'node:child_process';
import z from 'zod';

const RegionSchema = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    width: z.number().finite().positive().max(1),
    height: z.number().finite().positive().max(1),
  })
  .refine(
    (region) => region.x + region.width <= 1 + Number.EPSILON * 4 && region.y + region.height <= 1 + Number.EPSILON * 4,
  );
export type VisualRegion = z.infer<typeof RegionSchema>;

const ProposalsSchema = z.array(
  z.object({
    region: RegionSchema,
    confidence: z.number().finite().min(0).max(1),
    classId: z.number().int().nonnegative(),
  }),
);

export const parseObjectRegions = (output: string): VisualRegion[] =>
  ProposalsSchema.parse(JSON.parse(output)).map(({ region }) => region);

export const objectPixelBounds = (region: VisualRegion, width: number, height: number) => {
  RegionSchema.parse(region);
  const left = Math.floor(region.x * width);
  const top = Math.floor(region.y * height);
  const right = Math.min(width, Math.ceil((region.x + region.width) * width));
  const bottom = Math.min(height, Math.ceil((region.y + region.height) * height));
  return { left, top, width: right - left, height: bottom - top };
};

export const locateObjectRegions = (image: Buffer): Promise<VisualRegion[]> =>
  new Promise((resolve, reject) => {
    const child = spawn('/usr/local/bin/immich-visual-localizer', [], { stdio: ['pipe', 'pipe', 'pipe'] });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    child.on('error', reject);
    child.stdout.on('data', (chunk: Buffer) => {
      output.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      errors.push(chunk);
    });
    child.stdin.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Visual object localizer exited ${code}: ${Buffer.concat(errors).toString().trim()}`));
        return;
      }
      try {
        resolve(parseObjectRegions(Buffer.concat(output).toString()));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(image);
  });
