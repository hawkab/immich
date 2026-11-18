import 'dart:io';

import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/album/local_album.model.dart';
import 'package:immich_mobile/infrastructure/repositories/backup.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/repositories/auth.repository.dart';

import '../repository_context.dart';

class InterruptedResetDatabase extends Drift {
  InterruptedResetDatabase(super.executor);

  bool interruptVacuum = false;

  @override
  Future<void> customStatement(String statement, [List<Object?>? args]) async {
    if (interruptVacuum && statement == 'VACUUM;') {
      throw StateError('Simulated interrupted cache reset');
    }
    return super.customStatement(statement, args);
  }
}

void main() {
  test('logout preserves known originals across a later login after server deletion', () async {
    final ctx = MediumRepositoryContext();
    addTearDown(ctx.dispose);
    final settings = await SettingsRepository.ensureInitialized(ctx.db);
    addTearDown(SettingsRepository.reset);
    final user = await ctx.newUser();
    await ctx.newAuthUser(id: user.id);
    final remote = await ctx.newRemoteAsset(ownerId: user.id);
    final local = await ctx.newLocalAsset(checksum: remote.checksum);
    final album = await ctx.newLocalAlbum(backupSelection: BackupSelection.selected);
    await ctx.newLocalAlbumAsset(albumId: album.id, assetId: local.id);
    await AuthRepository(ctx.db, settings).clearLocalData();
    await ctx.newUser(id: user.id);
    await ctx.newAuthUser(id: user.id);
    expect(await BackupRepository(ctx.db).getCandidates(user.id), isEmpty);
    expect(await ctx.db.localAssetRepository.get(local.id), isNotNull);
    expect(await ctx.db.select(ctx.db.backupDeletionExclusion).get(), hasLength(1));
  });

  test('logout respects an explicit coupled-deletion preference', () async {
    final ctx = MediumRepositoryContext();
    addTearDown(ctx.dispose);
    final settings = await SettingsRepository.ensureInitialized(ctx.db);
    addTearDown(SettingsRepository.reset);
    await settings.write(.keepCopiesIndependent, false);
    final user = await ctx.newUser();
    await ctx.newAuthUser(id: user.id);
    await ctx.newRemoteAsset(ownerId: user.id);
    await AuthRepository(ctx.db, settings).clearLocalData();
    expect(await ctx.db.select(ctx.db.backupDeletionExclusion).get(), isEmpty);
  });

  for (final interrupt in [false, true]) {
    test('SQLite reset retains deletion history and owner isolation after restart (interrupt=$interrupt)', () async {
      final directory = await Directory.systemTemp.createTemp('immich-history-reset-');
      addTearDown(() => directory.delete(recursive: true));
      final file = File('${directory.path}/test.sqlite');
      final database = InterruptedResetDatabase(drift.DatabaseConnection(NativeDatabase(file)));
      await database.customStatement('''
        INSERT INTO backup_deletion_exclusion (owner_id, checksum)
        VALUES ('owner-a', 'own-history'), ('owner-b', 'partner-only')
      ''');
      database.interruptVacuum = interrupt;
      if (interrupt) {
        await expectLater(database.reset(), throwsStateError);
      } else {
        await database.reset();
      }
      await database.close();
      final reopened = Drift(drift.DatabaseConnection(NativeDatabase(file)));
      try {
        await reopened.customStatement('''
          INSERT OR IGNORE INTO backup_deletion_exclusion (owner_id, checksum)
          VALUES ('owner-a', 'own-history')
        ''');
        expect(await reopened.select(reopened.backupDeletionExclusion).get(), hasLength(2));
        final backup = BackupRepository(reopened);
        expect(await backup.isAutomaticUploadAllowed('owner-a', 'own-history'), isFalse);
        expect(await backup.isAutomaticUploadAllowed('owner-a', 'partner-only'), isTrue);
        expect(await reopened.select(reopened.authUserEntity).get(), isEmpty);
      } finally {
        await reopened.close();
      }
    });
  }
}
