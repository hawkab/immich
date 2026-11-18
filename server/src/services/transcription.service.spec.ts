import { AssetType, JobStatus } from 'src/enum.js';
import { TranscriptionService } from 'src/services/transcription.service.js';
import { TRANSCRIPT_KEY, TranscriptionProviderError } from 'src/utils/transcription.js';
import { AssetFactory } from 'test/factories/asset.factory.js';
import { newTestService } from 'test/utils.js';

const setup = () => {
  const { sut, mocks } = newTestService(TranscriptionService);
  const asset = AssetFactory.create({ type: AssetType.Video });
  let value: Record<string, unknown> | undefined;
  mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { transcription: { enabled: true } } });
  mocks.asset.getById.mockResolvedValue(asset as never);
  mocks.asset.getMetadataByKey.mockImplementation(() =>
    Promise.resolve(value ? { key: TRANSCRIPT_KEY, value, updatedAt: new Date() } : undefined),
  );
  mocks.asset.upsertMetadata.mockImplementation((_, items) => {
    value = structuredClone(items[0].value);
    return Promise.resolve([]);
  });
  mocks.media.probe.mockResolvedValue({
    format: { duration: 50 },
    audioStreams: [{ index: 1 }],
    videoStreams: [],
  } as never);
  const audio = Buffer.alloc(48);
  audio.writeInt16LE(123, 44);
  mocks.media.extractSpeech.mockResolvedValue(audio);
  mocks.machineLearning.transcribe.mockResolvedValue({ text: 'Сегодня мы говорили о путешествии' });
  return { sut, mocks, asset, saved: () => value };
};

describe('video transcription recovery', () => {
  it('transcribes every chunk, persists timestamps and leaves the original unchanged', async () => {
    const { sut, mocks, asset, saved } = setup();
    expect(await sut.handleTranscription({ id: asset.id })).toBe(JobStatus.Success);
    expect(mocks.media.extractSpeech.mock.calls).toEqual([
      [asset.originalPath, 0, 24],
      [asset.originalPath, 24, 24],
      [asset.originalPath, 48, 2],
    ]);
    expect(saved()).toMatchObject({
      status: 'complete',
      nextStart: 50,
      sourceChecksum: asset.checksum.toString('base64'),
    });
    expect(mocks.asset.update).not.toHaveBeenCalled();
    expect(await sut.handleTranscription({ id: asset.id })).toBe(JobStatus.Skipped);
    expect(mocks.machineLearning.transcribe).toHaveBeenCalledTimes(3);
  });

  it('resumes after a provider outage without repeating accepted chunks', async () => {
    const { sut, mocks, asset, saved } = setup();
    mocks.machineLearning.transcribe
      .mockResolvedValueOnce({ text: 'Первый фрагмент' })
      .mockRejectedValueOnce(new Error('connection lost'));
    await expect(sut.handleTranscription({ id: asset.id })).rejects.toThrow('connection lost');
    expect(saved()).toMatchObject({ status: 'processing', nextStart: 24, text: 'Первый фрагмент' });
    await sut.handleTranscription({ id: asset.id });
    expect(mocks.media.extractSpeech.mock.calls.map((call) => call[1])).toEqual([0, 24, 24, 48]);
    expect(mocks.machineLearning.transcribe.mock.calls[1][2]).toBe(mocks.machineLearning.transcribe.mock.calls[2][2]);
    expect(saved()).toMatchObject({ status: 'complete' });
  });

  it('records silent videos without invoking the provider', async () => {
    const { sut, mocks, asset, saved } = setup();
    mocks.media.probe.mockResolvedValue({ format: { duration: 50 }, audioStreams: [], videoStreams: [] } as never);
    await sut.handleTranscription({ id: asset.id });
    expect(saved()).toMatchObject({ status: 'no_audio', text: '' });
    expect(mocks.machineLearning.transcribe).not.toHaveBeenCalled();
  });

  it('skips disabled transcription, photos, deleted and offline media', async () => {
    for (const properties of [{ type: AssetType.Image }, { deletedAt: new Date() }, { isOffline: true }]) {
      const { sut, mocks, asset } = setup();
      mocks.asset.getById.mockResolvedValue({ ...asset, ...properties } as never);
      expect(await sut.handleTranscription({ id: asset.id })).toBe(JobStatus.Skipped);
      expect(mocks.media.probe).not.toHaveBeenCalled();
    }
    const { sut, mocks, asset } = setup();
    mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { transcription: { enabled: false } } });
    expect(await sut.handleTranscription({ id: asset.id })).toBe(JobStatus.Skipped);
  });

  it('stops between chunks if the user disables transcription', async () => {
    const { sut, mocks, asset, saved } = setup();
    mocks.machineLearning.transcribe.mockImplementationOnce(() => {
      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { transcription: { enabled: false } } });
      return Promise.resolve({ text: 'Сохранённый фрагмент' });
    });
    expect(await sut.handleTranscription({ id: asset.id })).toBe(JobStatus.Skipped);
    expect(saved()).toMatchObject({ status: 'processing', nextStart: 24 });
    expect(mocks.machineLearning.transcribe).toHaveBeenCalledTimes(1);
  });
});

it('uses a new request only after a reconciled terminal provider failure', async () => {
  const { sut, mocks, asset, saved } = setup();
  mocks.machineLearning.transcribe.mockRejectedValueOnce(new TranscriptionProviderError(503));
  await expect(sut.handleTranscription({ id: asset.id })).rejects.toThrow('503');
  expect(saved()).toMatchObject({ nextStart: 0, requestAttempt: 1 });
  await sut.handleTranscription({ id: asset.id });
  expect(mocks.machineLearning.transcribe.mock.calls[0][2]).not.toBe(mocks.machineLearning.transcribe.mock.calls[1][2]);
  expect(saved()).toMatchObject({ status: 'complete', requestAttempt: 0 });
});

it('finishes silent tails without sending empty audio to the provider', async () => {
  const { sut, mocks, asset, saved } = setup();
  mocks.media.extractSpeech
    .mockResolvedValueOnce(Buffer.alloc(44))
    .mockResolvedValueOnce(Buffer.alloc(44))
    .mockResolvedValueOnce(Buffer.alloc(44));
  expect(await sut.handleTranscription({ id: asset.id })).toBe(JobStatus.Success);
  expect(saved()).toMatchObject({ status: 'complete', nextStart: 50, text: '' });
  expect(mocks.machineLearning.transcribe).not.toHaveBeenCalled();
});
