import 'dart:io';

import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/album/local_album.model.dart';
import 'package:immich_mobile/infrastructure/repositories/backup.repository.dart';

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
}
