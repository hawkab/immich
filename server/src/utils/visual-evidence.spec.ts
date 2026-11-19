import sharp from 'sharp';
import { VisualEvidenceEngine, cosineSimilarity } from 'src/utils/visual-evidence.js';

const image = () =>
  sharp({ create: { width: 120, height: 80, channels: 3, background: 'blue' } })
    .composite([{ input: { create: { width: 60, height: 80, channels: 3, background: 'red' } }, left: 60, top: 0 }])
    .jpeg()
    .toBuffer();

const encode = async (input: Buffer) => {
  const { channels } = await sharp(input).stats();
  return JSON.stringify([channels[0].mean, channels[2].mean]);
};

describe('VisualEvidenceEngine', () => {
  it('locates a measured region instead of inventing an object box', async () => {
    const engine = new VisualEvidenceEngine();
    const evidence = await engine.explain('red-on-right', image, '[1,0]', encode, true);
    expect(evidence.localized).toBe(true);
    expect(evidence.region.x).toBeGreaterThanOrEqual(0.5);
    expect(evidence.region.x + evidence.region.width).toBeLessThanOrEqual(1);
    expect(evidence.similarity).toBeGreaterThan(0.99);
  });
  it('keeps the whole frame when no crop is more similar', async () => {
    const engine = new VisualEvidenceEngine();
    const result = await engine.explain('uniform', image, '[1,0]', () => Promise.resolve('[1,0]'), true);
    expect(result).toEqual({ similarity: 1, localized: false, region: { x: 0, y: 0, width: 1, height: 1 } });
  });
  it('coalesces duplicate requests and permits recovery after a failed inference', async () => {
    const engine = new VisualEvidenceEngine();
    const load = vitest.fn(image);
    const inference = vitest.fn(encode).mockRejectedValueOnce(new Error('ML restarted'));
    await expect(engine.explain('frame', load, '[1,0]', inference, false)).rejects.toThrow('ML restarted');
    const [first, second] = await Promise.all([
      engine.explain('frame', load, '[1,0]', inference, false),
      engine.explain('frame', load, '[1,0]', inference, false),
    ]);
    expect(first).toEqual(second);
    expect(load).toHaveBeenCalledTimes(2);
    expect(inference).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['[]', '[]'],
    ['[0,0]', '[1,0]'],
    ['[1]', '[1,0]'],
    ['["wrong"]', '[1]'],
  ])('rejects unusable embeddings %s', (a, b) => {
    expect(() => cosineSimilarity(a, b)).toThrow();
  });
});
