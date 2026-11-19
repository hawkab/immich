import 'package:openapi/api.dart';

class PartnerPermissionsRepository {
  final PartnersApi _api;

  const PartnerPermissionsRepository(this._api);

  Future<Set<String>> deleteOwners() async {
    final partners = await _api.getPartners(PartnerDirection.sharedWith) ?? [];
    return {
      for (final partner in partners)
        if (partner.canDelete.isPresent && partner.canDelete.value == true) partner.id,
    };
  }
}
