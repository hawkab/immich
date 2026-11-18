import 'package:drift/drift.dart';
import 'package:immich_mobile/data/db/util/defaults_mixin.dart';

class BackupDeletionExclusion extends Table with DriftDefaultsMixin {
  const BackupDeletionExclusion();

  TextColumn get ownerId => text()();
  TextColumn get checksum => text()();

  @override
  Set<Column> get primaryKey => {ownerId, checksum};
}
