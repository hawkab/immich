import { defaults, mapUserConfig } from 'src/dtos/config.dto.js';
import { speechQuery, speechWave, transcriptionIdentity } from 'src/utils/transcription.js';

describe('speech search', () => {
  it.each(['speech: путешествие', 'речь: путешествие'])('accepts %s', (query) =>
    expect(speechQuery(query)).toEqual({ query: 'путешествие', only: true }),
  );
  it('does not rewrite ordinary searches', () =>
    expect(speechQuery('Маша с лошадью')).toEqual({ query: 'Маша с лошадью', only: false }));
  it('does not invalidate cached transcription after credential rotation', () => {
    const config = defaults.machineLearning.transcription;
    expect(transcriptionIdentity(config)).toBe(transcriptionIdentity({ ...config, apiKey: 'rotated' }));
    expect(transcriptionIdentity(config)).not.toBe(transcriptionIdentity({ ...config, model: 'different' }));
  });
});

it('never exposes provider credentials or internal endpoints in user configuration', () => {
  const config = structuredClone(defaults);
  config.machineLearning.transcription.apiKey = 'private-provider-secret';
  const view = mapUserConfig(config);
  expect(JSON.stringify(view)).not.toContain('private-provider-secret');
  expect(JSON.stringify(view)).not.toContain('172.30.72.254');
  expect(view.machineLearning).not.toHaveProperty('transcription');
});

it('finalizes the PCM WAV length so GigaAM does not mistake streamed WAV headers for a multi-hour recording', () => {
  const audio = speechWave(Buffer.alloc(16_000 * 2 * 24));
  expect(audio.toString('ascii', 0, 4)).toBe('RIFF');
  expect(audio.readUInt32LE(4)).toBe(audio.length - 8);
  expect(audio.readUInt32LE(40)).toBe(16_000 * 2 * 24);
  expect(audio.readUInt32LE(24)).toBe(16_000);
  expect(audio.readUInt32LE(40) / audio.readUInt32LE(28)).toBe(24);
});

it('bounds decoded AAC overshoot to the requested sample window instead of creating a tiny provider tail', () => {
  const frames = 24 * 16_000;
  const decoded = Buffer.alloc((frames + 6) * 2);
  decoded.writeInt16LE(1234, 0);
  decoded.writeInt16LE(5678, (frames - 1) * 2);
  const wave = speechWave(decoded, 24);
  expect(wave.readUInt32LE(40)).toBe(frames * 2);
  expect(wave.length).toBe(frames * 2 + 44);
  expect(wave.readInt16LE(44)).toBe(1234);
  expect(wave.readInt16LE(wave.length - 2)).toBe(5678);
  expect(wave.readUInt32LE(40) / wave.readUInt32LE(28)).toBe(24);
});

it('keeps every shorter decoded sample and pads short tails for the speech model', () => {
  const samples = Buffer.alloc(100);
  samples.writeInt16LE(4321, 98);
  const wave = speechWave(samples, 0.5);
  expect(wave.readUInt32LE(40)).toBe(32_000);
  expect(wave.subarray(44, 144)).toEqual(samples);
  expect(wave.subarray(144).every((byte) => byte === 0)).toBe(true);
});

it.each([0, -1, NaN, Infinity])('rejects invalid speech window duration %s', (duration) => {
  expect(() => speechWave(Buffer.alloc(100), duration)).toThrow(RangeError);
});
