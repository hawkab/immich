import sharp from 'sharp';
import { AssetType } from 'src/enum.js';
import { SearchService } from 'src/services/search.service.js';
import { AssetFactory } from 'test/factories/asset.factory.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { getForAsset } from 'test/mappers.js';
import { newUuid } from 'test/small.factory.js';
import { newTestService } from 'test/utils.js';

const setup = async () => {
  const { sut, mocks } = newTestService(SearchService);
  const auth = AuthFactory.create();
  const asset = AssetFactory.create({ ownerId: auth.user.id, type: AssetType.Video, duration: 2500 });
  mocks.asset.getById.mockResolvedValue(getForAsset(asset));
  mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
  mocks.machineLearning.encodeText.mockResolvedValue('[1,0]');
  mocks.machineLearning.encodeImageBuffer.mockResolvedValue('[1,0]');
  mocks.media.extractVideoFrame.mockResolvedValue(
    await sharp({ create: { width: 80, height: 40, channels: 3, background: 'red' } })
      .jpeg()
      .toBuffer(),
  );
  const dto = {
    assetId: asset.id,
    sourceChecksum: asset.checksum.toString('base64'),
    query: 'red',
    time: 1,
    localize: false,
  };
  return { sut, mocks, auth, asset, dto };
};

describe('visual evidence access and source binding', () => {
  it('extracts an actual frame at the returned playback time and caches the calculation', async () => {
    const { sut, mocks, auth, asset, dto } = await setup();
    const result = await sut.visualEvidence(auth, dto);
    expect(result).toMatchObject({
      assetId: asset.id,
      sourceChecksum: dto.sourceChecksum,
      time: 1,
      similarity: 1,
      localized: false,
    });
    expect(mocks.media.extractVideoFrame).toHaveBeenCalledWith(asset.originalPath, 1);
    await sut.visualEvidence(auth, dto);
    expect(mocks.media.extractVideoFrame).toHaveBeenCalledTimes(1);
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
    await expect(sut.visualEvidence(auth, dto)).rejects.toThrow('access');
  });
  it('refuses stale media and out-of-duration timestamps before inference', async () => {
    const { sut, mocks, auth, dto } = await setup();
    await expect(sut.visualEvidence(auth, { ...dto, sourceChecksum: 'changed' })).rejects.toThrow('changed');
    await expect(sut.visualEvidence(auth, { ...dto, time: 3 })).rejects.toThrow('unavailable');
    expect(mocks.machineLearning.encodeImageBuffer).not.toHaveBeenCalled();
  });
  it('rechecks access after inference and checks the reference asset independently', async () => {
    const { sut, mocks, auth, asset, dto } = await setup();
    mocks.access.asset.checkOwnerAccess.mockResolvedValueOnce(new Set([asset.id])).mockResolvedValue(new Set());
    await expect(sut.visualEvidence(auth, dto)).rejects.toThrow('access');
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
    await expect(sut.visualEvidence(auth, { ...dto, query: undefined, queryAssetId: newUuid() })).rejects.toThrow(
      'access',
    );
  });
});
