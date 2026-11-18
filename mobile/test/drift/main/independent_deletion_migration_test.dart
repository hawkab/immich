import 'package:drift_dev/api/migrations_native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/data/db/main/database.dart';

import 'generated/schema.dart';

void main() {
  test('v35 to v36 preserves original records and adds durable deletion exclusions', () async {
    final verifier = SchemaVerifier(GeneratedHelper());
    final schema = await verifier.schemaAt(35);
    schema.rawDatabase.execute('''
      INSERT INTO local_asset_entity (id, name, type, created_at, updated_at, checksum)
      VALUES ('original', 'camera.jpg', 1, '2024-01-02T03:04:05.000Z', '2024-01-02T03:04:05.000Z', 'original-checksum');
    ''');
    final db = Drift(schema.newConnection());
    try {
      await verifier.migrateAndValidate(db, 36);
      final original = await db.localAssetRepository.get('original');
      expect(original?.checksum, 'original-checksum');
      expect(original?.name, 'camera.jpg');
      expect(await db.select(db.backupDeletionExclusion).get(), isEmpty);
    } finally {
      await db.close();
    }
  });
}
