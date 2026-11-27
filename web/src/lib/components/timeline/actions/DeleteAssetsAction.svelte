<script lang="ts">
  import MenuOption from '#lib/components/shared-components/context-menu/MenuOption.svelte';
  import { assetMultiSelectManager } from '#lib/managers/asset-multi-select-manager.svelte.ts';
  import { authManager } from '#lib/managers/auth-manager.svelte.ts';
  import { featureFlagsManager } from '#lib/managers/feature-flags-manager.svelte.ts';
  import AssetDeleteConfirmModal from '#lib/modals/AssetDeleteConfirmModal.svelte';
  import { queryClient } from '#lib/queries/client.ts';
  import { getIncomingPartnersQuery } from '#lib/queries/partner.query.ts';
  import { showDeleteModal } from '#lib/stores/preferences.store.ts';
  import { deleteAssets, type OnDelete, type OnUndoDelete } from '#lib/utils/actions.ts';
  import { getAssetDeletionPlan } from '#lib/utils/asset-deletion.ts';
  import { handleError } from '#lib/utils/handle-error.ts';
  import { IconButton, modalManager } from '@immich/ui';
  import { mdiDeleteForeverOutline, mdiDeleteOutline, mdiTimerSand } from '@mdi/js';
  import { createQuery } from '@tanstack/svelte-query';
  import { t } from 'svelte-i18n';

  type Props = {
    onAssetDelete: OnDelete;
    onUndoDelete?: OnUndoDelete | undefined;
    menuItem?: boolean;
    force?: boolean;
  };

  let { onAssetDelete, onUndoDelete = undefined, menuItem = false, force: forceRequested }: Props = $props();

  const userId = $derived(authManager.authenticated ? authManager.user.id : undefined);
  const hasPartnerAssets = $derived(assetMultiSelectManager.assets.some((asset) => asset.ownerId !== userId));
  const partners = createQuery(
    () => ({
      ...getIncomingPartnersQuery(userId),
      enabled: !!userId && !authManager.isSharedLink && hasPartnerAssets && featureFlagsManager.value.trash,
    }),
    () => queryClient,
  );
  const plan = $derived(
    getAssetDeletionPlan(
      assetMultiSelectManager.assets,
      userId,
      partners.data ?? [],
      featureFlagsManager.value.trash,
      forceRequested,
      authManager.isSharedLink,
    ),
  );
  const force = $derived(plan?.force ?? false);
  const label = $derived(force ? $t('permanently_delete') : $t('delete'));
  let loading = $state(false);

  const onAction = async () => {
    if (loading || !plan) {
      return;
    }
    const assets = assetMultiSelectManager.assets;
    const actor = userId;
    loading = true;
    try {
      const grants = hasPartnerAssets ? await queryClient.query(getIncomingPartnersQuery(actor)) : [];
      if (assets !== assetMultiSelectManager.assets || actor !== userId) {
        return;
      }
      const current = getAssetDeletionPlan(
        assets,
        userId,
        grants,
        featureFlagsManager.value.trash,
        forceRequested,
        authManager.isSharedLink,
      );
      if (!current) {
        return;
      }
      if (current.force && $showDeleteModal) {
        const confirmed = await modalManager.show(AssetDeleteConfirmModal, { size: assets.length });
        if (!confirmed) {
          return;
        }
      }
      await deleteAssets(
        current.force,
        (ids) => {
          onAssetDelete(ids);
          assetMultiSelectManager.clear();
        },
        assets,
        onUndoDelete,
      );
    } catch (error) {
      handleError(error, $t('errors.unable_to_delete_assets'));
    } finally {
      loading = false;
    }
  };
</script>

{#if plan}
  {#if menuItem}
    <MenuOption text={label} icon={mdiDeleteOutline} onClick={onAction} />
  {:else if loading}
    <IconButton
      shape="round"
      color="secondary"
      variant="ghost"
      aria-label={$t('loading')}
      icon={mdiTimerSand}
      onclick={() => {}}
    />
  {:else}
    <IconButton
      shape="round"
      color="secondary"
      variant="ghost"
      aria-label={label}
      icon={force ? mdiDeleteForeverOutline : mdiDeleteOutline}
      onclick={onAction}
    />
  {/if}
{/if}
