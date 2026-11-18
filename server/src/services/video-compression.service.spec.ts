import { AssetStatus, AssetType, JobName, JobStatus, Permission } from 'src/enum.js';
import { VideoCompressionService } from 'src/services/video-compression.service.js';
import type { VideoInfo } from 'src/types.js';
import { compressionCommand, compressionPath, type CompressionDraft } from 'src/utils/video-compression.js';
import { ApiKeyFactory } from 'test/factories/api-key.factory.js';
import { AssetFactory } from 'test/factories/asset.factory.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { newTestService } from 'test/utils.js';

const setup = () => {
  const { sut, mocks } = newTestService(VideoCompressionService);
  const auth = AuthFactory.create();
  const asset = AssetFactory.create({
    ownerId: auth.user.id,
    checksum: Buffer.alloc(20, 1),
    type: AssetType.Video,
    status: AssetStatus.Active,
    libraryId: null,
  });
  let draft: CompressionDraft | undefined;
  mocks.asset.getById.mockResolvedValue(asset as never);
  mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
  mocks.videoCompression.get.mockImplementation(() => Promise.resolve(draft && structuredClone(draft)));
  mocks.videoCompression.create.mockImplementation((_, __, value) => {
    draft = structuredClone(value);
    return Promise.resolve(true);
  });
  mocks.videoCompression.update.mockImplementation((_, requestId, patch, states, producerId) => {
    if (
      !draft ||
      draft.requestId !== requestId ||
      !states.includes(draft.status) ||
      (producerId !== undefined && draft.producerId !== producerId)
    )
      return Promise.resolve(false);
    draft = { ...draft, ...patch };
    return Promise.resolve(true);
  });
  mocks.videoCompression.isOriginal.mockResolvedValue(false);
  mocks.videoCompression.hasEditAccess.mockResolvedValue(true);
  mocks.storage.stat.mockResolvedValue({ size: 1000 } as never);
  mocks.crypto.hashFile.mockResolvedValue(Buffer.alloc(20, 2));
  const info: VideoInfo = {
    format: { duration: 31, bitrate: 250_000_000 },
    audioStreams: [],
    videoStreams: [
      {
        index: 0,
        width: 1920,
        height: 1080,
        rotation: 0,
        frameRate: 30,
        frameCount: 930,
        pixelFormat: 'yuv420p',
      } as never,
    ],
  };
  mocks.media.probe.mockResolvedValue(info);
  const dto = {
    requestId: 'fc18ce44-5470-4d8a-af4e-ce6e8b7ef071',
    sourceChecksum: asset.checksum.toString('base64'),
    quality: 55,
  };
  mocks.crypto.randomUUID.mockReturnValue(dto.requestId);
  return { sut, mocks, auth, asset, dto, info, saved: () => draft!, set: (value: CompressionDraft) => (draft = value) };
};

describe('video compression', () => {
  it('preserves edit and download scopes for API keys', async () => {
    const { sut, mocks, auth, asset, dto } = setup();
    auth.apiKey = ApiKeyFactory.create({ userId: auth.user.id, permissions: [Permission.AssetEditCreate] });
    await expect(sut.preview(auth, asset.id, dto)).rejects.toThrow('required permission');
    auth.apiKey = ApiKeyFactory.create({
      userId: auth.user.id,
      permissions: [Permission.AssetDownload],
    });
    await expect(sut.create(auth, asset.id, dto)).rejects.toThrow('required permission');
    expect(mocks.videoCompression.commit).not.toHaveBeenCalled();
    expect(mocks.crypto.hashFile).not.toHaveBeenCalled();
  });
  it('finishes a durable save before declaring success and never extracts capture dates again', async () => {
    const { sut, mocks, auth, asset, dto, saved, set } = setup();
    await sut.create(auth, asset.id, dto);
    await sut.run({ id: asset.id });
    mocks.crypto.hashFile.mockImplementation((path) =>
      Promise.resolve(path === asset.originalPath ? asset.checksum : Buffer.alloc(20, 2)),
    );
    mocks.videoCompression.commit.mockImplementation(() => {
      set({ ...saved(), status: 'saving', cleanup: [asset.originalPath] });
      mocks.asset.getById.mockResolvedValue({
        ...asset,
        checksum: Buffer.alloc(20, 2),
        exifInfo: { assetId: asset.id, make: 'Camera', latitude: 55, dateTimeOriginal: asset.fileCreatedAt },
      } as never);
      return Promise.resolve(true);
    });
    mocks.asset.upsertExif.mockResolvedValue();
    expect(mocks.storage.unlink).not.toHaveBeenCalledWith(asset.originalPath);
    await sut.confirm(auth, asset.id, { ...dto, confirmation: 'replace-original' });
    expect(saved().status).toBe('saving');
    expect(mocks.storage.unlink).not.toHaveBeenCalledWith(asset.originalPath);
    await sut.run({ id: asset.id });
    expect(saved()).toMatchObject({ status: 'committed', cleanup: [], finalized: true });
    expect(mocks.storage.unlink).toHaveBeenCalledWith(asset.originalPath);
    expect(mocks.asset.upsertExif).toHaveBeenCalledWith(
      expect.objectContaining({
        exif: expect.objectContaining({ make: 'Camera', latitude: 55, dateTimeOriginal: asset.fileCreatedAt }),
      }),
    );
    expect(mocks.asset.update).not.toHaveBeenCalled();
    expect(mocks.job.queue.mock.calls.some(([job]) => job.name === JobName.AssetExtractMetadata)).toBe(false);
  });

  it('keeps a canceled in-flight encode from becoming a savable preview', async () => {
    const { sut, mocks, auth, asset, dto, saved } = setup();
    await sut.create(auth, asset.id, dto);
    mocks.media.transcode.mockImplementation(async () => {
      await sut.discard(auth, asset.id, dto);
    });
    await sut.run({ id: asset.id });
    expect(saved().status).toBe('discarded');
    expect(mocks.storage.unlink).toHaveBeenCalledWith(compressionPath(asset.originalPath, dto.requestId));
    expect(mocks.storage.unlink).not.toHaveBeenCalledWith(asset.originalPath);
  });
  it('prepares an independent full-length preview and never replaces the original', async () => {
    const { sut, mocks, auth, asset, dto, saved } = setup();
    await sut.create(auth, asset.id, dto);
    expect(await sut.run({ id: asset.id })).toBe(JobStatus.Success);
    expect(saved()).toMatchObject({ status: 'ready', compressedSize: 1000, sourceChecksum: dto.sourceChecksum });
    expect(mocks.media.transcode.mock.calls[0][0]).toBe(asset.originalPath);
    expect(mocks.media.transcode.mock.calls[0][1]).not.toBe(asset.originalPath);
    expect(mocks.videoCompression.commit).not.toHaveBeenCalled();
    expect(mocks.asset.update).not.toHaveBeenCalled();
    expect(mocks.storage.unlink).not.toHaveBeenCalledWith(asset.originalPath);
  });

  it('rejects a stale original before scheduling work', async () => {
    const { sut, mocks, auth, asset, dto } = setup();
    await expect(
      sut.create(auth, asset.id, { ...dto, sourceChecksum: Buffer.alloc(20).toString('base64') }),
    ).rejects.toThrow('original changed');
    expect(mocks.job.queue).not.toHaveBeenCalled();
  });

  it('requires an effective edit grant rather than view-only sharing', async () => {
    const { sut, mocks, auth, asset, dto } = setup();
    mocks.asset.getById.mockResolvedValue({ ...asset, ownerId: 'other-owner' } as never);
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
    mocks.access.asset.checkPartnerEditAccess.mockResolvedValue(new Set());
    await expect(sut.create(auth, asset.id, dto)).rejects.toThrow('access');
    expect(mocks.videoCompression.create).not.toHaveBeenCalled();
    mocks.access.asset.checkPartnerEditAccess.mockResolvedValue(new Set([asset.id]));
    await sut.create(auth, asset.id, dto);
    expect(mocks.videoCompression.create).toHaveBeenCalled();
  });

  it('does not encode external, missing or deleted videos', async () => {
    for (const patch of [
      { libraryId: 'external' },
      { deletedAt: new Date() },
      { isOffline: true },
      { type: AssetType.Image },
    ]) {
      const { sut, mocks, auth, asset, dto } = setup();
      mocks.asset.getById.mockResolvedValue({ ...asset, ...patch } as never);
      await expect(sut.create(auth, asset.id, dto)).rejects.toThrow('available uploaded video');
    }
  });

  it('does not return a preview for an earlier request', async () => {
    const { sut, auth, asset, dto, saved, set } = setup();
    await sut.create(auth, asset.id, dto);
    set({ ...saved(), status: 'ready' });
    await expect(sut.preview(auth, asset.id, { ...dto, requestId: 'another-request' })).rejects.toThrow(
      'older original',
    );
  });

  it('keeps the original when encoding fails and permits a fresh request', async () => {
    const { sut, mocks, auth, asset, dto, saved } = setup();
    await sut.create(auth, asset.id, dto);
    mocks.media.transcode.mockRejectedValue(new Error('encoder failed'));
    await sut.run({ id: asset.id });
    expect(saved().status).toBe('failed');
    expect(mocks.videoCompression.commit).not.toHaveBeenCalled();
    expect(mocks.storage.unlink).not.toHaveBeenCalledWith(asset.originalPath);
    await sut.create(auth, asset.id, { ...dto, requestId: 'cd18ce44-5470-4d8a-af4e-ce6e8b7ef071' });
    expect(saved().status).toBe('queued');
  });

  it('rejects a truncated encoding instead of offering it for save', async () => {
    const { sut, mocks, auth, asset, dto, info, saved } = setup();
    await sut.create(auth, asset.id, dto);
    mocks.media.probe
      .mockResolvedValueOnce(info)
      .mockResolvedValueOnce({ ...info, format: { ...info.format, duration: 2 } });
    await sut.run({ id: asset.id });
    expect(saved().status).toBe('failed');
  });

  it('discards a preview without touching the original', async () => {
    const { sut, mocks, auth, asset, dto, saved, set } = setup();
    await sut.create(auth, asset.id, dto);
    set({ ...saved(), status: 'ready' });
    await sut.discard(auth, asset.id, dto);
    await sut.run({ id: asset.id });
    expect(saved().status).toBe('discarded');
    expect(mocks.storage.unlink).toHaveBeenCalledWith(compressionPath(asset.originalPath, dto.requestId));
    expect(mocks.videoCompression.commit).not.toHaveBeenCalled();
  });

  it('does not commit an unready preview', async () => {
    const { sut, mocks, auth, asset, dto } = setup();
    await sut.create(auth, asset.id, dto);
    await expect(sut.confirm(auth, asset.id, { ...dto, confirmation: 'replace-original' })).rejects.toThrow(
      'review a preview',
    );
    expect(mocks.videoCompression.commit).not.toHaveBeenCalled();
  });

  it('detects a changed preview or changed source before replacement', async () => {
    const { sut, mocks, auth, asset, dto, saved, set } = setup();
    await sut.create(auth, asset.id, dto);
    set({ ...saved(), status: 'ready', outputChecksum: Buffer.alloc(20, 2).toString('base64'), compressedSize: 1000 });
    mocks.crypto.hashFile.mockResolvedValue(Buffer.alloc(20, 3));
    await expect(sut.confirm(auth, asset.id, { ...dto, confirmation: 'replace-original' })).rejects.toThrow(
      'preview changed',
    );
    expect(mocks.videoCompression.commit).not.toHaveBeenCalled();
  });

  it('recovers persisted unfinished requests after restart', async () => {
    const { sut, mocks, asset } = setup();
    mocks.videoCompression.pending.mockResolvedValue([{ assetId: asset.id }]);
    await sut.recover();
    expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.VideoCompress, data: { id: asset.id } });
  });

  it('maps the quality control monotonically to the real encoder range without shrinking resolution', () => {
    const { mocks, info } = setup();
    const config = {
      targetVideoCodec: 'h264',
      preset: 'ultrafast',
      threads: 0,
      targetResolution: '720',
      maxBitrate: '0',
      bframes: -1,
      refs: 0,
      gopSize: 0,
      npl: 100,
      tonemap: 'hable',
    } as never;
    for (const quality of [0, 55, 100]) {
      const command = compressionCommand(info, quality, config);
      const at = command.outputOptions.indexOf('-crf');
      expect(command.outputOptions[at + 1]).toBe(String(Math.round(((100 - quality) * 51) / 100)));
      expect(command.outputOptions).not.toContain('-t');
      expect(command.outputOptions.join(' ')).not.toContain('720');
    }
    expect(mocks.asset.update).not.toHaveBeenCalled();
  });
});
