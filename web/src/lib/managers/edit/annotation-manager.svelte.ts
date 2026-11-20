import type { EditActions, EditToolManager } from '#lib/managers/edit/edit-manager.svelte.ts';
import type { AnnotationLayer, BlurLayer, EmojiLayer } from '#lib/utils/annotations.ts';
import { AnnotationBlurStyle, AnnotationEmojiType, AssetEditAction, type AssetResponseDto } from '@immich/sdk';

/** Maintain an undoable document independently of the selected editor tool. */
export class AnnotationManager implements EditToolManager {
  layers = $state<AnnotationLayer[]>([]);
  mode = $state<'rectangle' | 'brush' | 'move'>('rectangle');
  style = $state<AnnotationBlurStyle>(AnnotationBlurStyle.Pixelated);
  strength = $state(0.025);
  brushSize = $state(0.08);
  selected = $state<number | null>(null);
  displayScale = $state(1);
  insertionPoint = { x: 0.5, y: 0.5 };
  private initial = $state('[]');
  private history = $state<AnnotationLayer[][]>([[]]);
  private cursor = $state(0);

  hasChanges = $derived(JSON.stringify(this.layers) !== this.initial);
  canReset = $derived(this.layers.length > 0);
  canUndo = $derived(this.cursor > 0);
  canRedo = $derived(this.cursor < this.history.length - 1);
  edits: EditActions = $derived(
    this.layers.length > 0 ? [{ action: AssetEditAction.Annotate, parameters: { layers: this.layers } }] : [],
  );

  onActivate(_: AssetResponseDto, edits: EditActions) {
    const annotation = edits.find((edit) => edit.action === 'annotate');
    const parameters = annotation?.parameters as { layers: AnnotationLayer[] } | undefined;
    this.layers = structuredClone(parameters?.layers ?? []);
    this.initial = JSON.stringify(this.layers);
    this.history = [$state.snapshot(this.layers)];
    this.cursor = 0;
    this.selected = null;
    return Promise.resolve();
  }

  onDeactivate() {
    this.layers = [];
    this.history = [[]];
    this.cursor = 0;
    this.initial = '[]';
    this.selected = null;
    this.displayScale = 1;
    this.insertionPoint = { x: 0.5, y: 0.5 };
  }

  /** Commit one gesture as one undo step, rather than retaining each pointer event. */
  commit(layers: AnnotationLayer[]) {
    this.layers = layers;
    this.history = [...this.history.slice(0, this.cursor + 1), $state.snapshot(layers)];
    this.cursor++;
  }

  add(layer: AnnotationLayer) {
    this.commit([...this.layers, layer]);
    this.select(this.layers.length - 1);
  }

  select(index: number) {
    this.selected = index;
    const layer = this.layers[index];
    if (layer.type === 'blur') {
      this.mode = layer.shape;
      this.style = layer.style;
      this.strength = layer.strength / this.displayScale;
      if (layer.shape === 'brush') {
        this.brushSize = layer.size / this.displayScale;
      }
    } else {
      this.mode = 'move';
    }
  }

  updateSelectedBlur(changes: Partial<Pick<BlurLayer, 'style' | 'strength'>>) {
    if (this.selected === null || this.layers[this.selected].type !== 'blur') {
      return;
    }
    if (changes.strength !== undefined) {
      changes = { ...changes, strength: changes.strength * this.displayScale };
    }
    this.commit(
      this.layers.map((layer, index) =>
        index === this.selected && layer.type === 'blur' ? { ...layer, ...changes } : layer,
      ),
    );
  }

  addEmoji(emoji: string) {
    this.add({ type: AnnotationEmojiType.Emoji, emoji, ...this.insertionPoint, size: 0.2 * this.displayScale });
    this.mode = 'move';
  }

  updateEmoji(index: number, changes: Partial<Pick<EmojiLayer, 'x' | 'y' | 'size'>>) {
    this.commit(
      this.layers.map((layer, i) => (i === index && layer.type === 'emoji' ? { ...layer, ...changes } : layer)),
    );
  }

  removeSelected() {
    if (this.selected !== null) {
      this.commit(this.layers.filter((_, index) => index !== this.selected));
      this.selected = null;
    }
  }

  undo() {
    if (this.canUndo) {
      this.layers = structuredClone($state.snapshot(this.history[--this.cursor]));
      this.selected = null;
    }
  }

  redo() {
    if (this.canRedo) {
      this.layers = structuredClone($state.snapshot(this.history[++this.cursor]));
      this.selected = null;
    }
  }

  resetAllChanges() {
    this.commit([]);
    this.selected = null;
    return Promise.resolve();
  }
}

export const annotationManager = new AnnotationManager();
