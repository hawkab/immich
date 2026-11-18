import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/deletion_policy.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';

final deletionPolicyProvider = Provider(
  (ref) => DeletionPolicy(keepCopiesIndependent: () => ref.read(settingsProvider).appConfig.keepCopiesIndependent),
);
