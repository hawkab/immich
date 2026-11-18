import { AssetType, JobStatus } from 'src/enum.js';
import { TranscriptionService } from 'src/services/transcription.service.js';
import { transcriptTextChecksum } from 'src/utils/transcript-search.js';
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

it('checkpoints before stopping and does not start the next audio segment', async () => {
  const { sut, mocks, asset, saved } = setup();
  mocks.machineLearning.transcribe.mockImplementationOnce(() => {
    sut.onShutdown();
    return Promise.resolve({ text: 'Фрагмент до остановки' });
  });
  expect(await sut.handleTranscription({ id: asset.id })).toBe(JobStatus.Skipped);
  expect(saved()).toMatchObject({ status: 'processing', nextStart: 24, text: 'Фрагмент до остановки' });
  expect(mocks.machineLearning.transcribe).toHaveBeenCalledTimes(1);
});

it('respects the global machine learning switch', async () => {
  const { sut, mocks, asset } = setup();
  mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { enabled: false, transcription: { enabled: true } } });
  expect(await sut.handleTranscription({ id: asset.id })).toBe(JobStatus.Skipped);
  expect(mocks.media.extractSpeech).not.toHaveBeenCalled();
});

const indexSetup = async () => {
  const state = setup();
  state.mocks.machineLearning.transcribe
    .mockResolvedValueOnce({ text: 'Первый фрагмент' })
    .mockResolvedValueOnce({ text: 'Второй фрагмент' })
    .mockResolvedValueOnce({ text: 'Третий фрагмент' });
  await state.sut.handleTranscription({ id: state.asset.id });
  const rows: Array<Record<string, unknown>> = [];
  state.mocks.search.getTranscriptSearch.mockImplementation(() => Promise.resolve(structuredClone(rows) as never));
  state.mocks.search.upsertTranscriptSearch.mockImplementation((row) => {
    rows[row.part] = structuredClone(row);
    return Promise.resolve([]);
  });
  state.mocks.search.pruneTranscriptSearch.mockResolvedValue([]);
  state.mocks.machineLearning.encodeText.mockResolvedValue('[1,0]');
  return { ...state, rows };
};

describe('speech meaning index', () => {
  it('indexes accepted speech independently and reuses unchanged vectors after restart', async () => {
    const { sut, mocks, asset, saved, rows } = await indexSetup();
    expect(await sut.handleSearch({ id: asset.id })).toBe(JobStatus.Success);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      assetId: asset.id,
      part: 0,
      partCount: 3,
      sourceChecksum: asset.checksum.toString('base64'),
      textChecksum: transcriptTextChecksum(String(saved()?.text)),
    });
    await sut.handleSearch({ id: asset.id });
    expect(mocks.machineLearning.encodeText).toHaveBeenCalledTimes(3);
    expect(mocks.machineLearning.transcribe).toHaveBeenCalledTimes(3);
  });

  it('resumes from persisted vectors after an embedding-provider outage', async () => {
    const { sut, mocks, asset, rows } = await indexSetup();
    mocks.machineLearning.encodeText.mockResolvedValueOnce('[1,0]').mockRejectedValueOnce(new Error('ML offline'));
    await expect(sut.handleSearch({ id: asset.id })).rejects.toThrow('ML offline');
    expect(rows).toHaveLength(1);
    await sut.handleSearch({ id: asset.id });
    expect(rows).toHaveLength(3);
    expect(mocks.machineLearning.encodeText).toHaveBeenCalledTimes(4);
  });

  it('rejects invalid provider vectors without persisting a poisoned search row', async () => {
    const { sut, mocks, asset, rows } = await indexSetup();
    mocks.machineLearning.encodeText.mockResolvedValue('[0,0]');
    await expect(sut.handleSearch({ id: asset.id })).rejects.toThrow('invalid embedding');
    expect(rows).toHaveLength(0);
  });

  it('does not index changed sources, disabled models or work after shutdown', async () => {
    const { sut, mocks, asset, rows } = await indexSetup();
    mocks.asset.getById.mockResolvedValue({ ...asset, checksum: Buffer.from('changed') } as never);
    expect(await sut.handleSearch({ id: asset.id })).toBe(JobStatus.Skipped);
    expect(rows).toHaveLength(0);
    mocks.asset.getById.mockResolvedValue(asset as never);
    mocks.systemMetadata.get.mockResolvedValue({
      machineLearning: { transcription: { enabled: true }, clip: { enabled: false } },
    });
    expect(await sut.handleSearch({ id: asset.id })).toBe(JobStatus.Skipped);
    sut.onShutdown();
    expect(await sut.handleSearch({ id: asset.id })).toBe(JobStatus.Skipped);
    expect(mocks.machineLearning.encodeText).not.toHaveBeenCalled();
  });
});
