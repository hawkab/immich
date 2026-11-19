import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/infrastructure/repositories/partner_permissions.repository.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/providers/app_life_cycle.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';

final partnerPermissionsRepositoryProvider = Provider(
  (ref) => PartnerPermissionsRepository(ref.watch(apiServiceProvider).partnersApi),
);

final partnerDeleteOwnersProvider = FutureProvider.autoDispose<Set<String>>((ref) {
  ref.watch(authUserProvider.select((user) => user.id));
  ref.listen(appStateProvider, (previous, next) {
    if (next == AppLifeCycleEnum.resumed || next == AppLifeCycleEnum.active) ref.invalidateSelf();
  });
  return ref.watch(partnerPermissionsRepositoryProvider).deleteOwners();
});
