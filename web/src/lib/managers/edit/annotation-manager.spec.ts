import { AnnotationManager } from '#lib/managers/edit/annotation-manager.svelte.ts';
import type { AnnotationLayer } from '#lib/utils/annotations.ts';
import { factory } from '#test/unit/factories.ts';
import { AnnotationBlurStyle, AnnotationBlurType, AnnotationRectangleShape, AssetEditAction } from '@immich/sdk';

describe('annotation document', () => {
  let manager: AnnotationManager;
  beforeEach(() => {
    manager = new AnnotationManager();
  });

  it('adds, moves and resizes an emoji, undoing each complete action', () => {
    manager.addEmoji('1f600');
    manager.updateEmoji(0, { x: 0.7, y: 0.2, size: 0.4 });
    expect(manager.layers[0]).toMatchObject({ x: 0.7, y: 0.2, size: 0.4 });
    manager.undo();
    expect(manager.layers[0]).toMatchObject({ x: 0.5, y: 0.5, size: 0.2 });
    manager.undo();
    expect(manager.layers).toEqual([]);
    manager.redo();
    manager.redo();
    expect(manager.layers[0]).toMatchObject({ x: 0.7, y: 0.2, size: 0.4 });
  });

  it('reloads saved layers without marking them dirty and preserves their native API contract', async () => {
    const layer: AnnotationLayer = {
      type: AnnotationBlurType.Blur,
      shape: AnnotationRectangleShape.Rectangle,
      style: AnnotationBlurStyle.Frosted,
      strength: 0.05,
      points: [
        { x: 0.2, y: 0.3 },
        { x: 0.6, y: 0.7 },
      ],
    };
    await manager.onActivate(factory.asset(), [{ action: AssetEditAction.Annotate, parameters: { layers: [layer] } }]);
    expect(manager.layers).toEqual([layer]);
    expect(manager.hasChanges).toBe(false);
    expect(manager.edits).toEqual([{ action: AssetEditAction.Annotate, parameters: { layers: [layer] } }]);
    manager.addEmoji('1f600');
    expect(manager.hasChanges).toBe(true);
    manager.undo();
    expect(manager.hasChanges).toBe(false);
  });

  it('reset removes saved annotations and is itself undoable', async () => {
    manager.addEmoji('1f600');
    await manager.resetAllChanges();
    expect(manager.edits).toEqual([]);
    manager.undo();
    expect(manager.layers).toHaveLength(1);
  });

  it('does not keep redo effects after a different edit and safely deletes the selection', () => {
    manager.addEmoji('1f600');
    manager.addEmoji('1f1f7-1f1fa');
    manager.undo();
    manager.addEmoji('1f431');
    expect(manager.canRedo).toBe(false);
    manager.removeSelected();
    expect(manager.layers).toHaveLength(1);
  });

  it('releases history on close rather than leaking it to the next asset', () => {
    manager.addEmoji('1f600');
    manager.onDeactivate();
    expect(manager.layers).toEqual([]);
    expect(manager.canUndo).toBe(false);
    expect(manager.hasChanges).toBe(false);
  });
});
