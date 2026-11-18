import { JobName, JobStatus } from 'src/enum.js';
import { AutoAlbumEventService } from 'src/services/auto-album-event.service.js';
import { AssetFactory } from 'test/factories/asset.factory.js';
import { getForAsset } from 'test/mappers.js';
import { envData } from 'test/repositories/config.repository.mock.js';
import { factory } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

describe(AutoAlbumEventService.name, () => {
  let sut: AutoAlbumEventService;
  let mocks: ServiceMocks;
  const directory = '/secure/memory-events';

  beforeEach(() => {
    ({ sut, mocks } = newTestService(AutoAlbumEventService));
    mocks.config.getEnv.mockReturnValue({ ...envData, memoryEventsDir: directory });
    mocks.storage.writeMemoryEvent.mockResolvedValue(undefined);
  });

  it('does no database or filesystem work when not configured', async () => {
    mocks.config.getEnv.mockReturnValue(envData);
    const asset = AssetFactory.create();
    await sut.onAssetCreate({ asset });
    expect(mocks.asset.getById).not.toHaveBeenCalled();
    expect(mocks.storage.writeMemoryEvent).not.toHaveBeenCalled();
  });

  it('binds the spool filename and payload to the actual asset owner', async () => {
    const asset = AssetFactory.create();
    mocks.asset.getById.mockResolvedValue(getForAsset(asset));
    await sut.onAssetCreate({ asset: { id: asset.id, ownerId: factory.uuid() } });
    expect(mocks.storage.writeMemoryEvent).toHaveBeenCalledWith(
      directory,
      `${asset.ownerId}.${asset.id}.json`,
      expect.any(Buffer),
    );
    const payload = JSON.parse(mocks.storage.writeMemoryEvent.mock.lastCall![2].toString());
    expect(payload).toEqual({
      ownerId: asset.ownerId,
      assetId: asset.id,
      reason: 'upload',
      timestamp: expect.any(String),
    });
    expect(new Date(payload.timestamp).toISOString()).toBe(payload.timestamp);
  });

  it('signals completed metadata extraction without trusting the caller user id', async () => {
    const asset = AssetFactory.create();
    mocks.asset.getById.mockResolvedValue(getForAsset(asset));
    await sut.onAssetMetadataExtracted({ assetId: asset.id, userId: factory.uuid() });
    expect(mocks.storage.writeMemoryEvent.mock.lastCall![1]).toBe(`${asset.ownerId}.${asset.id}.json`);
  });

  it.each([
    JobName.SmartSearch,
    JobName.Ocr,
    JobName.AssetDetectFaces,
    JobName.AssetDetectDuplicates,
    JobName.AssetEditThumbnailGeneration,
    JobName.AssetEncodeVideo,
  ] as const)('signals the actual asset-scoped job %s', async (name) => {
    const asset = AssetFactory.create();
    mocks.asset.getById.mockResolvedValue(getForAsset(asset));
    await sut.onJobSuccess({ job: { name, data: { id: asset.id } }, response: JobStatus.Success });
    expect(mocks.asset.getById).toHaveBeenCalledWith(asset.id);
    expect(mocks.storage.writeMemoryEvent).toHaveBeenCalledOnce();
  });

  it('resolves the face id to an asset id after facial recognition', async () => {
    const asset = AssetFactory.create();
    const faceId = factory.uuid();
    mocks.person.getAssetIdForFace.mockResolvedValue({ assetId: asset.id });
    mocks.asset.getById.mockResolvedValue(getForAsset(asset));
    await sut.onJobSuccess({
      job: { name: JobName.FacialRecognition, data: { id: faceId } },
      response: JobStatus.Success,
    });
    expect(mocks.person.getAssetIdForFace).toHaveBeenCalledWith(faceId);
    expect(mocks.asset.getById).toHaveBeenCalledWith(asset.id);
    expect(mocks.asset.getById).not.toHaveBeenCalledWith(faceId);
  });

  it('ignores unrelated jobs and unsuccessful handler statuses', async () => {
    await sut.onJobSuccess({ job: { name: JobName.MemoryGenerate }, response: JobStatus.Success });
    await sut.onJobSuccess({
      job: { name: JobName.SmartSearch, data: { id: factory.uuid() } },
      response: JobStatus.Failed,
    });
    expect(mocks.asset.getById).not.toHaveBeenCalled();
    expect(mocks.storage.writeMemoryEvent).not.toHaveBeenCalled();
  });

  it('does not publish an event for a missing asset or an invalid identifier', async () => {
    mocks.asset.getById.mockResolvedValue(undefined);
    await sut.onSceneMetadataUpdated({ assetId: factory.uuid() });
    await sut.onSceneMetadataUpdated({ assetId: '../another-owner' });
    expect(mocks.asset.getById).toHaveBeenCalledOnce();
    expect(mocks.storage.writeMemoryEvent).not.toHaveBeenCalled();
  });

  it('preserves a completed operation when the spool or owner lookup fails', async () => {
    const asset = AssetFactory.create();
    mocks.asset.getById.mockResolvedValue(getForAsset(asset));
    mocks.storage.writeMemoryEvent.mockRejectedValue(new Error('filesystem unavailable'));
    await expect(sut.onSceneMetadataUpdated({ assetId: asset.id })).resolves.toBeUndefined();
    expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('filesystem unavailable'));
    mocks.asset.getById.mockRejectedValue(new Error('database unavailable'));
    await expect(sut.onAssetCreate({ asset })).resolves.toBeUndefined();
  });
});
