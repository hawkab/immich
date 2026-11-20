<script lang="ts">
  import { annotationManager as manager } from '#lib/managers/edit/annotation-manager.svelte.ts';
  import { transformManager } from '#lib/managers/edit/transform-manager.svelte.ts';
  import {
    annotationImage,
    annotationPoint,
    originalAnnotationPoint,
    renderAnnotations,
    transformedPreview,
    type AnnotationLayer,
    type AnnotationPoint,
    type BlurLayer,
  } from '#lib/utils/annotations.ts';
  import { getDimensions } from '#lib/utils/asset-utils.ts';
  import { handleError } from '#lib/utils/handle-error.ts';
  import {
    AnnotationBlurType,
    AnnotationBrushShape,
    AnnotationRectangleShape,
    type AssetResponseDto,
  } from '@immich/sdk';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  let { asset, src }: { asset: AssetResponseDto; src: string } = $props();
  let surface = $state<HTMLCanvasElement>();
  let image = $state<HTMLImageElement>();
  let draft = $state<BlurLayer | null>(null);
  let moving = $state<{ index: number; start: AnnotationPoint; x: number; y: number; point: AnnotationPoint } | null>(
    null,
  );
  let rendering = 0;
  let drawing = false;
  let pointerId: number | null = null;
  const dimensions = $derived({
    width: getDimensions(asset.exifInfo!).width ?? image?.naturalWidth ?? 1,
    height: getDimensions(asset.exifInfo!).height ?? image?.naturalHeight ?? 1,
  });
  const base = $derived(image && annotationImage(image));

  $effect(() => {
    const edits = transformManager.edits;
    const crop = edits.find((edit) => edit.action === 'crop')?.parameters as
      { width: number; height: number } | undefined;
    manager.displayScale = crop ? Math.min(crop.width, crop.height) / Math.min(dimensions.width, dimensions.height) : 1;
    manager.insertionPoint = originalAnnotationPoint({ x: 0.5, y: 0.5 }, edits, dimensions);
  });

  onMount(() => {
    const picture = new Image();
    const loaded = () => {
      image = picture;
    };
    const failed = (error: Event) => handleError(error, 'errors.unable_to_load_image');
    picture.addEventListener('load', loaded, { once: true });
    picture.addEventListener('error', failed, { once: true });
    picture.src = src;
    return () => {
      picture.removeEventListener('load', loaded);
      picture.removeEventListener('error', failed);
      rendering++;
    };
  });

  const visibleLayers = $derived.by(() => {
    const layers: AnnotationLayer[] = manager.layers.map((layer, index) =>
      moving?.index === index && layer.type === 'emoji' ? { ...layer, x: moving.point.x, y: moving.point.y } : layer,
    );
    return draft ? [...layers, draft] : layers;
  });

  $effect(() => {
    const destination = surface;
    const source = base;
    const selected = manager.selected;
    const transforms = transformManager.edits;
    const original = dimensions;
    const layers = $state.snapshot(visibleLayers);
    const sequence = ++rendering;
    if (!destination || !source) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      void renderAnnotations(source, layers)
        .then((rendered) => {
          if (sequence !== rendering) {
            return;
          }
          const ctx = rendered.getContext('2d')!;
          const layer = selected === null ? undefined : layers[selected];
          if (layer?.type === 'emoji') {
            const side = layer.size * Math.min(rendered.width, rendered.height);
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.strokeRect(layer.x * rendered.width - side / 2, layer.y * rendered.height - side / 2, side, side);
          }
          const transformed = transformedPreview(rendered, transforms, original);
          destination.width = transformed.width;
          destination.height = transformed.height;
          destination.getContext('2d')!.drawImage(transformed, 0, 0);
        })
        .catch((error) => handleError(error, 'editor_annotation_load_error'));
    });
    return () => cancelAnimationFrame(frame);
  });

  function point(event: PointerEvent) {
    return originalAnnotationPoint(
      annotationPoint(event.clientX, event.clientY, surface!.getBoundingClientRect()),
      transformManager.edits,
      dimensions,
    );
  }

  function start(event: PointerEvent) {
    if (event.button !== 0 || pointerId !== null || !base) {
      return;
    }
    event.preventDefault();
    pointerId = event.pointerId;
    surface!.setPointerCapture(event.pointerId);
    const p = point(event);
    if (manager.mode === 'move') {
      manager.selected = null;
      for (let i = manager.layers.length - 1; i >= 0; i--) {
        const layer = manager.layers[i];
        if (layer.type !== 'emoji') {
          continue;
        }
        const half = (layer.size * Math.min(base.width, base.height)) / 2;
        if (Math.abs(p.x - layer.x) * base.width <= half && Math.abs(p.y - layer.y) * base.height <= half) {
          manager.selected = i;
          moving = { index: i, start: p, x: layer.x, y: layer.y, point: p };
          moving.point = { x: layer.x, y: layer.y };
          break;
        }
      }
    } else {
      drawing = true;
      manager.selected = null;
      const common = {
        type: AnnotationBlurType.Blur,
        style: manager.style,
        strength: manager.strength * manager.displayScale,
      };
      draft =
        manager.mode === 'rectangle'
          ? { ...common, shape: AnnotationRectangleShape.Rectangle, points: [p, p] }
          : {
              ...common,
              shape: AnnotationBrushShape.Brush,
              points: [p],
              size: manager.brushSize * manager.displayScale,
            };
    }
  }

  function move(event: PointerEvent) {
    if (event.pointerId !== pointerId) {
      return;
    }
    const p = point(event);
    if (moving) {
      moving.point = {
        x: Math.max(0, Math.min(1, moving.x + p.x - moving.start.x)),
        y: Math.max(0, Math.min(1, moving.y + p.y - moving.start.y)),
      };
    } else if (drawing && draft) {
      if (draft.shape === 'rectangle') {
        draft.points[1] = p;
      } else {
        const last = draft.points.at(-1)!;
        if (
          Math.hypot((p.x - last.x) * base!.width, (p.y - last.y) * base!.height) >=
          (draft.size * Math.min(base!.width, base!.height)) / 8
        ) {
          draft.points.push(p);
        }
      }
    }
  }

  function finish(event: PointerEvent, cancelled = false) {
    if (event.pointerId !== pointerId) {
      return;
    }
    if (!cancelled) {
      move(event);
      if (moving) {
        manager.updateEmoji(moving.index, moving.point);
      } else if (draft) {
        if (draft.shape === 'brush') {
          draft.points.push(point(event));
        }
        const valid =
          draft.shape === 'brush' ||
          (draft.points[0].x !== draft.points[1].x && draft.points[0].y !== draft.points[1].y);
        if (valid) {
          manager.add($state.snapshot(draft));
        }
      }
    }
    draft = null;
    moving = null;
    drawing = false;
    pointerId = null;
    if (surface?.hasPointerCapture(event.pointerId)) {
      surface.releasePointerCapture(event.pointerId);
    }
  }
</script>

<div class="flex size-full min-h-0 items-center justify-center p-8">
  {#if image}
    <canvas
      bind:this={surface}
      class="max-h-full max-w-full touch-none"
      style:cursor={manager.mode === 'move' ? 'move' : 'crosshair'}
      aria-label={$t('editor_annotation_canvas')}
      onpointerdown={start}
      onpointermove={move}
      onpointerup={(event) => finish(event)}
      onpointercancel={(event) => finish(event, true)}>{$t('editor_annotation_canvas')}</canvas
    >
  {:else}
    <p>{$t('loading')}</p>
  {/if}
</div>
