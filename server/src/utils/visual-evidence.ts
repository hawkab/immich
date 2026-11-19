import { LRUMap } from 'mnemonist';
import sharp from 'sharp';
import { locateObjectRegions, objectPixelBounds, type VisualRegion } from 'src/utils/visual-localizer.js';

type Region = VisualRegion;
type Evidence = { similarity: number; region: Region; localized: boolean };
const whole: Region = { x: 0, y: 0, width: 1, height: 1 };

export const cosineSimilarity = (a: string, b: string): number => {
  const x: number[] = JSON.parse(a);
  const y: number[] = JSON.parse(b);
  if (
    !Array.isArray(x) ||
    !Array.isArray(y) ||
    x.length === 0 ||
    x.length !== y.length ||
    [...x, ...y].some((value) => !Number.isFinite(value))
  )
    throw new Error('Invalid visual embedding');
  let dot = 0,
    xx = 0,
    yy = 0;
  for (let i = 0; i < x.length; i++) {
    dot += x[i] * y[i];
    xx += x[i] ** 2;
    yy += y[i] ** 2;
  }
  if (!xx || !yy) throw new Error('Empty visual embedding');
  return dot / Math.sqrt(xx * yy);
};

export class VisualEvidenceEngine {
  private cache = new LRUMap<string, Promise<Evidence> | undefined>(100);

  private objects = new LRUMap<string, Promise<Region[]> | undefined>(100);

  constructor(private locate: (image: Buffer) => Promise<Region[]> = locateObjectRegions) {}

  private objectRegions(key: string, image: Buffer): Promise<Region[]> {
    let pending = this.objects.get(key);
    if (!pending) {
      pending = this.locate(image);
      this.objects.set(key, pending);
      pending.catch(() => {
        if (this.objects.get(key) === pending) this.objects.set(key, undefined);
      });
    }
    return pending;
  }

  async explain(
    key: string,
    image: () => Promise<Buffer>,
    target: string,
    encode: (image: Buffer) => Promise<string>,
    localize: boolean,
  ): Promise<Evidence> {
    const identity = JSON.stringify([key, target, localize]);
    let pending = this.cache.get(identity);
    if (!pending) {
      pending = Promise.try(async () => this.calculate(key, await image(), target, encode, localize));
      this.cache.set(identity, pending);
      pending.catch(() => {
        if (this.cache.get(identity) === pending) this.cache.set(identity, undefined);
      });
    }
    return pending;
  }

  private async calculate(
    key: string,
    image: Buffer,
    target: string,
    encode: (image: Buffer) => Promise<string>,
    localize: boolean,
  ): Promise<Evidence> {
    const normalized = await sharp(image).rotate().jpeg().toBuffer();
    const { width, height } = await sharp(normalized).metadata();
    if (!width || !height) throw new Error('Visual evidence has no dimensions');
    let best: Evidence = {
      similarity: cosineSimilarity(await encode(normalized), target),
      region: whole,
      localized: false,
    };
    if (!localize) return best;
    let strongestContribution = 0;
    for (const proposal of await this.objectRegions(key, normalized)) {
      const bounds = objectPixelBounds(proposal, width, height);
      const masked = await sharp(normalized)
        .composite([
          {
            input: {
              create: {
                width: bounds.width,
                height: bounds.height,
                channels: 3,
                background: { r: 114, g: 114, b: 114 },
              },
            },
            left: bounds.left,
            top: bounds.top,
          },
        ])
        .jpeg()
        .toBuffer();
      const contribution = best.similarity - cosineSimilarity(await encode(masked), target);
      if (!(contribution > strongestContribution + 1e-6)) {
        continue;
      }

      strongestContribution = contribution;
      best = {
        ...best,
        region: {
          x: bounds.left / width,
          y: bounds.top / height,
          width: bounds.width / width,
          height: bounds.height / height,
        },
        localized: true,
      };
    }
    return best;
  }
}
