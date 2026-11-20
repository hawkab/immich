import { describe, expect, it } from 'vitest';
import { AssetEditAction, type AssetEditActionItem } from 'src/dtos/editing.dto.js';
import { projectAnnotations } from 'src/utils/annotation-transform.js';

describe('annotations stay attached to source pixels', () => {
  const edits: AssetEditActionItem[] = [
    { action: AssetEditAction.Crop, parameters: { x: 20, y: 10, width: 60, height: 40 } },
    { action: AssetEditAction.Rotate, parameters: { angle: 90 } },
  ];
  it('projects emoji positions and physical sizes through crop and rotation', () => {
    const result = projectAnnotations(
      { layers: [{ type: 'emoji', emoji: '1f600', x: 0.4, y: 0.25, size: 0.2 }] },
      edits,
      { width: 100, height: 80 },
    );
    expect(result.layers[0]).toMatchObject({ x: expect.closeTo(0.75), y: expect.closeTo(1 / 3), size: 0.4 });
  });
  it('projects brush paths, diameters and blur radii with the same geometry', () => {
    const result = projectAnnotations(
      {
        layers: [
          { type: 'blur', shape: 'brush', style: 'frosted', strength: 0.1, size: 0.2, points: [{ x: 0.4, y: 0.25 }] },
        ],
      },
      edits,
      { width: 100, height: 80 },
    );
    expect(result.layers[0]).toMatchObject({
      strength: 0.2,
      size: 0.4,
      points: [{ x: expect.closeTo(0.75), y: expect.closeTo(1 / 3) }],
    });
  });
});
