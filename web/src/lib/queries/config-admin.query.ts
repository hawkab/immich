import { eventManager } from '#lib/managers/event-manager.svelte.ts';
import { queryClient } from '#lib/queries/client.ts';
import { getPublicConfigQuery } from '#lib/queries/config-public.query.ts';
import { getUserConfigQuery } from '#lib/queries/config-user.query.ts';
import { getFormatter } from '#lib/utils/i18n.ts';
import { Provider, getAdminConfig, getAdminConfigDefaults, updateAdminConfig, type AdminConfigDto } from '@immich/sdk';
import { toastManager } from '@immich/ui';
import { mutationOptions, queryOptions } from '@tanstack/svelte-query';
import { isEqual } from 'lodash-es';

export const normalizeAdminConfig = (config: AdminConfigDto) => {
  const value = config.machineLearning.transcription;
  return {
    ...config,
    job: { ...config.job, transcription: config.job.transcription ?? { concurrency: 1 } },
    machineLearning: {
      ...config.machineLearning,
      transcription: {
        enabled: value?.enabled ?? false,
        provider: value?.provider ?? Provider.Gigaam,
        url: value?.url ?? 'http://172.30.72.254:8000/v1/audio/transcriptions',
        model: value?.model ?? 'v3_e2e_ctc',
        language: value?.language ?? 'ru',
        apiKey: value?.apiKey ?? '',
        searchMinSimilarity: value?.searchMinSimilarity ?? 0.85,
      },
    },
  };
};

export const getAdminConfigQuery = () =>
  queryOptions({
    queryKey: ['config', 'admin'],
    queryFn: ({ signal }) => getAdminConfig({ signal }),
    select: normalizeAdminConfig,
    gcTime: Infinity,
  });

export const getAdminConfigDefaultsQuery = () =>
  queryOptions({
    queryKey: ['config', 'admin', 'defaults'],
    queryFn: ({ signal }) => getAdminConfigDefaults({ signal }),
    select: normalizeAdminConfig,
  });

export const updateAdminConfigMutation = () =>
  mutationOptions({
    mutationFn: async (update: Partial<AdminConfigDto>) => {
      const config = await getAdminConfig();
      const adminConfigDto = { ...config, ...update };

      if (isEqual(config, adminConfigDto)) {
        return;
      }

      return updateAdminConfig({ adminConfigDto });
    },
    onSuccess: async (config) => {
      if (!config) {
        return;
      }

      queryClient.setQueryData(getAdminConfigQuery().queryKey, config);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getUserConfigQuery().queryKey }),
        queryClient.invalidateQueries({ queryKey: getPublicConfigQuery().queryKey }),
      ]);
      eventManager.emit('SystemConfigUpdate', config);

      const $t = await getFormatter();
      toastManager.primary($t('settings_saved'));
    },
    meta: { error: { toast: 'errors.unable_to_save_settings' } },
  });
