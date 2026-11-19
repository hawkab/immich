import { LRUMap } from 'mnemonist';
import sharp from 'sharp';

type Region = { x: number; y: number; width: number; height: number };
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
      pending = Promise.try(async () => this.calculate(await image(), target, encode, localize));
      this.cache.set(identity, pending);
      pending.catch(() => {
        if (this.cache.get(identity) === pending) this.cache.set(identity, undefined);
      });
    }
    return pending;
  }

  private async calculate(
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
    for (const scale of [2 / 3, 1 / 2]) {
      const w = Math.max(1, Math.floor(width * scale)),
        h = Math.max(1, Math.floor(height * scale));
      for (const y of [0, Math.floor((height - h) / 2), height - h]) {
        for (const x of [0, Math.floor((width - w) / 2), width - w]) {
          const crop = await sharp(normalized).extract({ left: x, top: y, width: w, height: h }).jpeg().toBuffer();
          const similarity = cosineSimilarity(await encode(crop), target);
          if (similarity > best.similarity + 1e-6)
            best = {
              similarity,
              region: { x: x / width, y: y / height, width: w / width, height: h / height },
              localized: true,
            };
        }
      }
    }
    return best;
  }
}
