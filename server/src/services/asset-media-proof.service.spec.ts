import { AssetMediaSize } from 'src/dtos/asset-media.dto.js';
import { Permission } from 'src/enum.js';
import { AssetMediaService } from 'src/services/asset-media.service.js';
import { ImmichFileResponse } from 'src/utils/file.js';
import { generationPath, mediaProof } from 'src/utils/media-generation.js';
import { AssetFactory } from 'test/factories/asset.factory.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { getForAsset } from 'test/mappers.js';
import { newTestService } from 'test/utils.js';

describe('authenticated rendered-media proof', () => {
  const setup = (auth = AuthFactory.create()) => {
    const { sut, mocks } = newTestService(AssetMediaService);
    const asset = AssetFactory.from({ ownerId: auth.user.id }).edit().build();
    const proof = mediaProof(asset);
    const path = generationPath(
      '/thumbs/preview_edited.jpeg',
      proof.generation,
      'd22ecf1c-15fd-4dde-aaf9-45e57df63816',
    );
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
    mocks.access.asset.checkSharedLinkAccess.mockResolvedValue(new Set([asset.id]));
    mocks.asset.getForThumbnail.mockResolvedValue({
      originalPath: asset.originalPath,
      originalFileName: asset.originalFileName,
      path,
      isEdited: true,
    });
    mocks.asset.getById.mockResolvedValue(getForAsset(asset));
    mocks.assetEdit.getAll.mockResolvedValue(asset.edits);
    return { sut, mocks, auth, asset, proof, path };
  };

  it('returns a producer-path-bound proof after normal asset-view authorization', async () => {
    const { sut, auth, asset, proof } = setup();
    const result = await sut.viewThumbnail(auth, asset.id, { size: AssetMediaSize.PREVIEW, edited: true });
    const encoded = (result as ImmichFileResponse).headers!['X-Immich-Media-Proof'];
    expect(JSON.parse(Buffer.from(encoded, 'base64url').toString())).toEqual(proof);
  });

  it('keeps serving a legacy UI preview without falsely stamping current edits', async () => {
    const { sut, mocks, auth, asset } = setup();
    mocks.asset.getForThumbnail.mockResolvedValue({
      originalPath: asset.originalPath,
      originalFileName: asset.originalFileName,
      path: '/thumbs/preview_edited.jpeg',
      isEdited: true,
    });
    const result = await sut.viewThumbnail(auth, asset.id, { size: AssetMediaSize.PREVIEW, edited: true });
    expect((result as ImmichFileResponse).path).toBe('/thumbs/preview_edited.jpeg');
    expect((result as ImmichFileResponse).headers).toEqual({ 'X-Immich-Media-Kind': 'edited' });
    expect(mocks.assetEdit.getAll).not.toHaveBeenCalled();
  });

  it('does not authenticate an older edited generation using an unchanged isEdited or thumbhash', async () => {
    const { sut, mocks, auth, asset } = setup();
    mocks.assetEdit.getAll.mockResolvedValue([]);
    const result = await sut.viewThumbnail(auth, asset.id, { size: AssetMediaSize.PREVIEW, edited: true });
    expect((result as ImmichFileResponse).headers).toEqual({ 'X-Immich-Media-Kind': 'edited' });
  });

  it.each([
    AuthFactory.from().sharedLink().build(),
    AuthFactory.from()
      .apiKey({ permissions: [Permission.AssetView] })
      .build(),
  ])('does not leak checksums or edit geometry through shared links or view-only API keys', async (auth) => {
    const { sut, mocks, asset } = setup(auth);
    const result = await sut.viewThumbnail(auth, asset.id, { size: AssetMediaSize.PREVIEW, edited: true });
    expect((result as ImmichFileResponse).headers).toEqual({ 'X-Immich-Media-Kind': 'edited' });
    expect(mocks.assetEdit.getAll).not.toHaveBeenCalled();
  });

  it('does not provide an owner-bound proof for another owner asset', async () => {
    const { sut, mocks, auth, asset } = setup();
    mocks.asset.getById.mockResolvedValue({ ...getForAsset(asset), ownerId: 'stranger' });
    const result = await sut.viewThumbnail(auth, asset.id, { size: AssetMediaSize.PREVIEW, edited: true });
    expect((result as ImmichFileResponse).headers).toEqual({ 'X-Immich-Media-Kind': 'edited' });
  });

  it('reports the actual edited fallback after current edits were removed', async () => {
    const { sut, mocks, auth, asset } = setup();
    mocks.asset.getById.mockResolvedValue({ ...getForAsset(asset), isEdited: false });
    mocks.assetEdit.getAll.mockResolvedValue([]);
    const result = await sut.viewThumbnail(auth, asset.id, { size: AssetMediaSize.PREVIEW, edited: false });
    expect((result as ImmichFileResponse).headers).toEqual({ 'X-Immich-Media-Kind': 'edited' });
  });

  it('reports an original-file fallback without claiming it contains the current edits', async () => {
    const { sut, mocks, auth, asset } = setup();
    mocks.asset.getForThumbnail.mockResolvedValue({
      originalPath: asset.originalPath,
      originalFileName: asset.originalFileName,
      path: '/thumbs/preview.jpeg',
      isEdited: false,
    });
    const result = await sut.viewThumbnail(auth, asset.id, { size: AssetMediaSize.PREVIEW, edited: true });
    expect((result as ImmichFileResponse).headers).toEqual({ 'X-Immich-Media-Kind': 'original' });
  });

  it('preserves an authorized UI preview without a false proof when current provenance is unavailable', async () => {
    const { sut, mocks, auth, asset, path } = setup();
    mocks.assetEdit.getAll.mockRejectedValue(new Error('provenance unavailable'));
    const result = await sut.viewThumbnail(auth, asset.id, { size: AssetMediaSize.PREVIEW, edited: true });
    expect((result as ImmichFileResponse).path).toBe(path);
    expect((result as ImmichFileResponse).headers).toEqual({ 'X-Immich-Media-Kind': 'edited' });
  });
});
