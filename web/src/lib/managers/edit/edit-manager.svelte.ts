import AnnotationTool from '#lib/components/asset-viewer/editor/annotation-tool/AnnotationTool.svelte';
import TransformTool from '#lib/components/asset-viewer/editor/transform-tool/TransformTool.svelte';
import { annotationManager } from '#lib/managers/edit/annotation-manager.svelte.ts';
import { transformManager } from '#lib/managers/edit/transform-manager.svelte.ts';
import { eventManager } from '#lib/managers/event-manager.svelte.ts';
import { waitForWebsocketEvent } from '#lib/stores/websocket.ts';
import { getFormatter } from '#lib/utils/i18n.ts';
import { editAsset, removeAssetEdits, type AssetEditsCreateDto, type AssetResponseDto } from '@immich/sdk';
import { ConfirmModal, modalManager, toastManager } from '@immich/ui';
import { mdiCropRotate, mdiDraw } from '@mdi/js';
import type { Component } from 'svelte';

export type EditAction = AssetEditsCreateDto['edits'][number];
export type EditActions = EditAction[];

export interface EditToolManager {
  onActivate: (asset: AssetResponseDto, edits: EditActions) => Promise<void>;
  onDeactivate: () => void;
  resetAllChanges: () => Promise<void>;
  hasChanges: boolean;
  canReset: boolean;
  edits: EditAction[];
}

export enum EditToolType {
  Transform = 'transform',
  Annotate = 'annotate',
}

export interface EditTool {
  type: EditToolType;
  icon: string;
  component: Component;
  manager: EditToolManager;
}

export class EditManager {
  private saveController?: AbortController;
  private toolDefinitions?: EditTool[];

  get tools(): EditTool[] {
    return (this.toolDefinitions ??= [
      {
        type: EditToolType.Transform,
        icon: mdiCropRotate,
        component: TransformTool,
        manager: transformManager,
      },
      { type: EditToolType.Annotate, icon: mdiDraw, component: AnnotationTool, manager: annotationManager },
    ]);
  }

  currentAsset = $state<AssetResponseDto | null>(null);
  selectedTool = $state<EditTool | null>(null);

  // used to disable multiple confirm dialogs and mouse events while one is open
  isShowingConfirmDialog = $state(false);
  isApplyingEdits = $state(false);
  hasAppliedEdits = $state(false);

  hasUnsavedChanges = $derived(this.tools.some((t) => t.manager.hasChanges) && !this.hasAppliedEdits);
  canReset = $derived(this.tools.some((t) => t.manager.canReset));

  async closeConfirm(): Promise<boolean> {
    // Prevent multiple dialogs (usually happens with rapid escape key presses)
    if (this.isShowingConfirmDialog) {
      return false;
    }

    if (!this.hasUnsavedChanges) {
      return true;
    }

    this.isShowingConfirmDialog = true;

    const t = await getFormatter();

    const confirmed = await modalManager.show(ConfirmModal, {
      title: t('editor_discard_edits_title'),
      prompt: t('editor_discard_edits_prompt'),
      confirmText: t('editor_discard_edits_confirm'),
    });

    this.isShowingConfirmDialog = false;

    return confirmed;
  }

  reset() {
    for (const tool of this.tools) {
      tool.manager.onDeactivate?.();
    }
    this.selectedTool = this.tools[0];
  }

  async activateTool(toolType: EditToolType, asset: AssetResponseDto, edits: AssetEditsCreateDto) {
    this.hasAppliedEdits = false;
    const newTool = this.tools.find((tool) => tool.type === toolType);
    if (!newTool) {
      return;
    }
    if (this.currentAsset?.id === asset.id) {
      this.selectedTool = newTool;
    } else {
      this.cleanup();
      this.currentAsset = asset;
      this.selectedTool = newTool;
      for (const tool of this.tools) {
        await tool.manager.onActivate(asset, edits.edits);
      }
    }
  }

  selectTool(type: EditToolType) {
    this.selectedTool = this.tools.find((tool) => tool.type === type) ?? null;
  }

  cleanup() {
    this.saveController?.abort();
    for (const tool of this.tools) {
      tool.manager.onDeactivate?.();
    }
    this.currentAsset = null;
    this.selectedTool = null;
  }

  async resetAllChanges() {
    for (const tool of this.tools) {
      await tool.manager.resetAllChanges();
    }
  }

  async applyEdits(): Promise<boolean> {
    if (this.isApplyingEdits) {
      return false;
    }
    this.isApplyingEdits = true;

    const edits = this.tools.flatMap((tool) => tool.manager.edits);
    if (!this.currentAsset) {
      this.isApplyingEdits = false;
      return false;
    }

    const assetId = this.currentAsset.id;
    const t = await getFormatter();

    try {
      // Setup the websocket listener before sending the edit request
      this.saveController = new AbortController();
      const editCompleted = waitForWebsocketEvent(
        'AssetEditReadyV2',
        (event) => event.asset.id === assetId,
        null,
        this.saveController.signal,
      );

      await Promise.all([
        editCompleted,
        edits.length === 0
          ? removeAssetEdits({ id: assetId, includeAnnotations: true })
          : editAsset({
              id: assetId,
              includeAnnotations: true,
              assetEditsCreateDto: {
                edits,
              },
            }),
      ]);

      eventManager.emit('AssetEditsApplied', assetId);

      toastManager.primary(t('editor_edits_applied_success'));
      this.hasAppliedEdits = true;

      return true;
    } catch {
      toastManager.danger(t('editor_edits_applied_error'));
      return false;
    } finally {
      this.saveController?.abort();
      this.saveController = undefined;
      this.isApplyingEdits = false;
    }
  }
}

export const editManager = new EditManager();
