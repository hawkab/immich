import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';

class IndependentDeletionSettings extends ConsumerWidget {
  const IndependentDeletionSettings({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final independent = ref.watch(appConfigProvider.select((config) => config.keepCopiesIndependent));
    return SwitchListTile.adaptive(
      value: independent,
      title: Text(context.t.independent_deletion_title),
      subtitle: Text(context.t.independent_deletion_description),
      onChanged: (value) => ref.read(settingsProvider).write(.keepCopiesIndependent, value),
    );
  }
}
