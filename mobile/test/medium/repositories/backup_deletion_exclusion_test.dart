import 'dart:io';

import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/album/local_album.model.dart';
import 'package:immich_mobile/infrastructure/repositories/backup.repository.dart';
import 'package:immich_mobile/services/action.service.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart' show SyncAssetDeleteV1;

import '../../repository.mocks.dart';
import '../repository_context.dart';

void main() {
  test('a deleted server original is not uploaded again while the device copy remains', () async {
    final ctx = MediumRepositoryContext();
    addTearDown(ctx.dispose);
    final user = await ctx.newUser();
    await ctx.newAuthUser(id: user.id);
    final remote = await ctx.newRemoteAsset(ownerId: user.id);
    final local = await ctx.newLocalAsset(checksum: remote.checksum);
    final album = await ctx.newLocalAlbum(backupSelection: BackupSelection.selected);
    await ctx.newLocalAlbumAsset(albumId: album.id, assetId: local.id);
    final backup = BackupRepository(ctx.db);
    await backup.excludeDeletedRemoteAssets([remote.id]);
    await backup.excludeDeletedRemoteAssets([remote.id]);
    await ctx.db.remoteAssetRepository.deleteAssets([remote.id]);
    expect(await ctx.db.localAssetRepository.get(local.id), isNotNull);
    expect(await backup.getCandidates(user.id), isEmpty);
    expect((await backup.getAllCounts(user.id)).remainder, 0);
    expect((await backup.getAllCounts(user.id)).total, 0);
    expect(await ctx.db.select(ctx.db.backupDeletionExclusion).get(), hasLength(1));
  });

  test('a partner deletion cannot suppress the authenticated owners backup', () async {
    final ctx = MediumRepositoryContext();
    addTearDown(ctx.dispose);
    final user = await ctx.newUser();
    final partner = await ctx.newUser();
    await ctx.newAuthUser(id: user.id);
    final remote = await ctx.newRemoteAsset(ownerId: partner.id);
    final local = await ctx.newLocalAsset(checksum: remote.checksum);
    final album = await ctx.newLocalAlbum(backupSelection: BackupSelection.selected);
    await ctx.newLocalAlbumAsset(albumId: album.id, assetId: local.id);
    final backup = BackupRepository(ctx.db);
    await backup.excludeDeletedRemoteAssets([remote.id]);
    expect(await ctx.db.select(ctx.db.backupDeletionExclusion).get(), isEmpty);
    expect((await backup.getCandidates(user.id)).map((asset) => asset.id), contains(local.id));
  });

  test('the owner-scoped exclusion survives database and repository restart', () async {
    final directory = await Directory.systemTemp.createTemp('immich-deletion-test-');
    addTearDown(() => directory.delete(recursive: true));
    final file = File('${directory.path}/test.sqlite');
    var db = Drift(drift.DatabaseConnection(NativeDatabase(file)));
    await db.customStatement('INSERT INTO backup_deletion_exclusion (owner_id, checksum) VALUES (?, ?)', [
      'owner',
      'checksum',
    ]);
    await db.close();
    db = Drift(drift.DatabaseConnection(NativeDatabase(file)));
    try {
      final rows = await db.select(db.backupDeletionExclusion).get();
      expect(rows, hasLength(1));
      expect(rows.single.ownerId, 'owner');
      expect(rows.single.checksum, 'checksum');
    } finally {
      await db.close();
    }
  });

  test('server trash remains excluded from the first automatic backup', () async {
    final ctx = MediumRepositoryContext();
    addTearDown(ctx.dispose);
    final user = await ctx.newUser();
    await ctx.newAuthUser(id: user.id);
    final trashed = await ctx.newRemoteAsset(ownerId: user.id, deletedAt: DateTime(2026));
    final local = await ctx.newLocalAsset(checksum: trashed.checksum);
    final album = await ctx.newLocalAlbum(backupSelection: BackupSelection.selected);
    await ctx.newLocalAlbumAsset(albumId: album.id, assetId: local.id);
    final backup = BackupRepository(ctx.db);
    expect(await backup.getCandidates(user.id), isEmpty);
    expect((await backup.getAllCounts(user.id)).remainder, 0);
  });

  test('a full remote sync reset retains known checksums and local originals', () async {
    final ctx = MediumRepositoryContext();
    addTearDown(ctx.dispose);
    final user = await ctx.newUser();
    await ctx.newAuthUser(id: user.id);
    final remote = await ctx.newRemoteAsset(ownerId: user.id);
    final local = await ctx.newLocalAsset(checksum: remote.checksum);
    final album = await ctx.newLocalAlbum(backupSelection: BackupSelection.selected);
    await ctx.newLocalAlbumAsset(albumId: album.id, assetId: local.id);
    final backup = BackupRepository(ctx.db);
    await backup.excludeKnownAssetsBeforeReset();
    await ctx.db.syncStreamRepository.reset();
    await ctx.newAuthUser(id: user.id);
    expect(await ctx.db.localAssetRepository.get(local.id), isNotNull);
    expect(await BackupRepository(ctx.db).getCandidates(user.id), isEmpty);
    expect(await ctx.db.select(ctx.db.backupDeletionExclusion).get(), hasLength(1));
  });

  test('active server copies remain in the backup counts after a full resync', () async {
    final ctx = MediumRepositoryContext();
    addTearDown(ctx.dispose);
    final user = await ctx.newUser();
    await ctx.newAuthUser(id: user.id);
    final remote = await ctx.newRemoteAsset(ownerId: user.id);
    final local = await ctx.newLocalAsset(checksum: remote.checksum);
    final album = await ctx.newLocalAlbum(backupSelection: BackupSelection.selected);
    await ctx.newLocalAlbumAsset(albumId: album.id, assetId: local.id);
    final backup = BackupRepository(ctx.db);
    await backup.excludeKnownAssetsBeforeReset();
    await ctx.db.syncStreamRepository.reset();
    await ctx.newAuthUser(id: user.id);
    await ctx.newUser(id: user.id);
    await ctx.newRemoteAsset(id: remote.id, ownerId: user.id, checksum: remote.checksum);
    final counts = await backup.getAllCounts(user.id);
    expect(counts.total, 1);
    expect(counts.remainder, 0);
    expect(counts.processing, 0);
    expect(await backup.getCandidates(user.id), isEmpty);
  });

  test('empty trash preserves deletion intent before late sync and keeps partner originals', () async {
    final ctx = MediumRepositoryContext();
    addTearDown(ctx.dispose);
    final user = await ctx.newUser();
    final partner = await ctx.newUser();
    await ctx.newAuthUser(id: user.id);
    final remote = await ctx.newRemoteAsset(ownerId: user.id, deletedAt: DateTime(2026));
    final partnerRemote = await ctx.newRemoteAsset(ownerId: partner.id, deletedAt: DateTime(2026));
    final local = await ctx.newLocalAsset(checksum: remote.checksum);
    final album = await ctx.newLocalAlbum(backupSelection: BackupSelection.selected);
    await ctx.newLocalAlbumAsset(albumId: album.id, assetId: local.id);
    final api = MockAssetApiRepository();
    when(api.emptyTrash).thenAnswer((_) async => 1);
    final service = ActionService(api, ctx.db.remoteAssetRepository);
    expect(await service.emptyTrash(user.id), 1);
    await ctx.db.syncStreamRepository.deleteAssetsV1([SyncAssetDeleteV1(assetId: remote.id)]);
    expect(await BackupRepository(ctx.db).getCandidates(user.id), isEmpty);
    expect(await ctx.db.localAssetRepository.get(local.id), isNotNull);
    expect(await ctx.db.remoteAssetRepository.get(partnerRemote.id), isNotNull);
    final exclusions = await ctx.db.select(ctx.db.backupDeletionExclusion).get();
    expect(exclusions, hasLength(1));
    expect(exclusions.single.ownerId, user.id);
    expect(exclusions.single.checksum, remote.checksum);
  });

  test('empty trash API failure does not delete the cached or device original', () async {
    final ctx = MediumRepositoryContext();
    addTearDown(ctx.dispose);
    final user = await ctx.newUser();
    await ctx.newAuthUser(id: user.id);
    final remote = await ctx.newRemoteAsset(ownerId: user.id, deletedAt: DateTime(2026));
    final local = await ctx.newLocalAsset(checksum: remote.checksum);
    final api = MockAssetApiRepository();
    when(api.emptyTrash).thenThrow(StateError('Remote operation failed'));
    final service = ActionService(api, ctx.db.remoteAssetRepository);
    await expectLater(service.emptyTrash(user.id), throwsStateError);
    expect(await ctx.db.remoteAssetRepository.get(remote.id), isNotNull);
    expect(await ctx.db.localAssetRepository.get(local.id), isNotNull);
    expect(await ctx.db.select(ctx.db.backupDeletionExclusion).get(), isEmpty);
  });
}
