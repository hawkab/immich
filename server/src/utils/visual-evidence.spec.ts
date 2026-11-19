import sharp from 'sharp';
import { VisualEvidenceEngine, cosineSimilarity } from 'src/utils/visual-evidence.js';
import { objectPixelBounds, parseObjectRegions } from 'src/utils/visual-localizer.js';

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
  it('ranks complete object proposals instead of arbitrary grid squares', async () => {
    const engine = new VisualEvidenceEngine(() => Promise.resolve([{ x: 0.5, y: 0, width: 0.5, height: 1 }]));
    const evidence = await engine.explain('red-on-right', image, '[1,0]', encode, true);
    expect(evidence.localized).toBe(true);
    expect(evidence.region.x).toBeGreaterThanOrEqual(0.5);
    expect(evidence.region.x + evidence.region.width).toBeLessThanOrEqual(1);
    expect(evidence.similarity).toBeGreaterThan(0.7);
  });
  it('keeps the whole frame when no crop is more similar', async () => {
    const engine = new VisualEvidenceEngine(() => Promise.resolve([{ x: 0.5, y: 0, width: 0.5, height: 1 }]));
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

it('keeps the entire off-center object in its returned box and complete-object ablation', async () => {
  const input = await sharp({ create: { width: 200, height: 100, channels: 3, background: 'black' } })
    .composite([
      { input: { create: { width: 5, height: 30, channels: 3, background: 'red' } }, left: 10, top: 35 },
      { input: { create: { width: 5, height: 30, channels: 3, background: 'green' } }, left: 185, top: 35 },
    ])
    .png()
    .toBuffer();
  const engine = new VisualEvidenceEngine(() => Promise.resolve([{ x: 0.05, y: 0.35, width: 0.9, height: 0.3 }]));
  const encoded: { width: number; height: number }[] = [];
  const evidence = await engine.explain(
    'wide-object',
    () => Promise.resolve(input),
    '[1,0]',
    async (data) => {
      const { info, data: pixels } = await sharp(data).raw().toBuffer({ resolveWithObject: true });
      encoded.push({ width: info.width, height: info.height });
      const hasRed = pixels.some((_, i) => i % info.channels === 0 && pixels[i] > 180 && pixels[i + 1] < 80);
      const hasGreen = pixels.some((_, i) => i % info.channels === 0 && pixels[i + 1] > 90 && pixels[i] < 80);
      return JSON.stringify(hasRed && hasGreen ? [1, 0] : [0, 1]);
    },
    true,
  );
  expect(evidence.region).toEqual({ x: 0.05, y: 0.35, width: 0.9, height: 0.3 });
  expect(evidence.region.x + evidence.region.width / 2).toBe(0.5);
  expect(evidence.region.y + evidence.region.height / 2).toBe(0.5);
  expect(encoded).toEqual([
    { width: 200, height: 100 },
    { width: 200, height: 100 },
  ]);
});

it('reuses object proposals across queries and recovers from detector failure', async () => {
  const locate = vitest.fn(() => Promise.resolve([{ x: 0.5, y: 0, width: 0.5, height: 1 }]));
  locate.mockRejectedValueOnce(new Error('worker restarted'));
  const engine = new VisualEvidenceEngine(locate);
  await expect(engine.explain('one-source', image, '[1,0]', encode, true)).rejects.toThrow('worker restarted');
  await Promise.all([
    engine.explain('one-source', image, '[1,0]', encode, true),
    engine.explain('one-source', image, '[0,1]', encode, true),
  ]);
  expect(locate).toHaveBeenCalledTimes(2);
  await engine.explain('changed-source', image, '[1,0]', encode, true);
  expect(locate).toHaveBeenCalledTimes(3);
});

it('rounds object bounds outwards without moving them outside the source image', () => {
  expect(objectPixelBounds({ x: 0.399, y: 0.532, width: 0.238, height: 0.301 }, 1440, 1440)).toEqual({
    left: 574,
    top: 766,
    width: 344,
    height: 434,
  });
  expect(objectPixelBounds({ x: 0, y: 0, width: 1, height: 1 }, 1295, 1514)).toEqual({
    left: 0,
    top: 0,
    width: 1295,
    height: 1514,
  });
});

it.each([
  [{ x: -0.1, y: 0, width: 0.5, height: 1 }],
  [{ x: 0.8, y: 0, width: 0.5, height: 1 }],
  [{ x: 0, y: 0, width: 0, height: 1 }],
])('rejects unusable detector coordinates %s', (region) => {
  expect(() => parseObjectRegions(JSON.stringify([{ region, confidence: 0.9, classId: 15 }]))).toThrow();
});
