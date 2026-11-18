import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/config/app_config.dart';
import 'package:immich_mobile/domain/models/deletion_policy.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';

void main() {
  test('fresh installations keep copies independent', () {
    expect(const AppConfig().keepCopiesIndependent, isTrue);
    expect(const DeletionPolicy().syncDeletions, isFalse);
  });

  test('the preference round-trips and can restore native coupled behavior', () {
    final config = const AppConfig().write(SettingsKey.keepCopiesIndependent, false);
    final rebuilt = AppConfig.fromEntries({SettingsKey.keepCopiesIndependent: config.keepCopiesIndependent});
    final policy = DeletionPolicy(keepCopiesIndependent: () => rebuilt.keepCopiesIndependent);
    expect(rebuilt.read(SettingsKey.keepCopiesIndependent), isFalse);
    expect(policy.syncDeletions, isTrue);
    expect(policy.localTargetsForDelete(['local']), ['local']);
  });

  test('ordinary deletion never targets local copies in independent mode', () {
    const policy = DeletionPolicy();
    expect(policy.localTargetsForDelete(['local']), isEmpty);
  });

  test('long-running services observe preference changes when the action happens', () {
    var independent = false;
    final policy = DeletionPolicy(keepCopiesIndependent: () => independent);
    expect(policy.syncDeletions, isTrue);
    independent = true;
    expect(policy.syncDeletions, isFalse);
  });
}
