import { createServer } from 'node:http';
import { defaults } from 'src/dtos/config.dto.js';
import { MachineLearningRepository } from 'src/repositories/machine-learning.repository.js';

it.each(['gigaam', 'openai'] as const)('sends bounded audio with stable request identity to %s', async (provider) => {
  const requests: { headers: Record<string, unknown>; body: Buffer }[] = [];
  const server = createServer((request, response) => {
    void (async () => {
    const chunks: Buffer[] = await Array.fromAsync(request);
    requests.push({ headers: request.headers, body: Buffer.concat(chunks) });
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ text: '  Проверка русской речи  ' }));
    })().catch((error) => response.destroy(error));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as { port: number };
    const sut = new MachineLearningRepository({ setContext: () => {} } as never);
    const config = {
      ...defaults.machineLearning.transcription,
      provider,
      url: `http://127.0.0.1:${address.port}/v1/audio/transcriptions`,
    };
    const audio = Buffer.from('native-audio');
    expect(await sut.transcribe(audio, config, 'source-chunk')).toEqual({ text: 'Проверка русской речи' });
    await sut.transcribe(audio, config, 'source-chunk');
    expect(requests[0].headers['x-spark-request-id']).toBe(requests[1].headers['x-spark-request-id']);
    expect(requests[0].body).toEqual(requests[1].body);
    if (provider === 'gigaam') {
      expect(requests[0].body).toEqual(audio);
    } else {
      expect(requests[0].body.toString()).toContain('name="file"; filename="audio.wav"');
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
