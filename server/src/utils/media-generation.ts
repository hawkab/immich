import { createHash } from 'node:crypto';
import { extname } from 'node:path';

export type LogicalEdit = { action: string; parameters: object };
export type MediaSource = { id: string; checksum: Buffer; edits: LogicalEdit[] };
export type MediaProof = {
  assetId: string;
  sourceChecksum: string;
  edits: LogicalEdit[];
  previewKind: 'edited';
  generation: string;
};

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => canonical(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
};

export const mediaProof = (source: MediaSource): MediaProof => {
  const edits = source.edits.map(({ action, parameters }) => ({ action, parameters: canonical(parameters) as object }));
  const sourceChecksum = source.checksum.toString('base64');
  const generation = createHash('sha256').update(JSON.stringify({ sourceChecksum, edits })).digest('hex');
  return { assetId: source.id, sourceChecksum, edits, previewKind: 'edited', generation };
};

export const generationPath = (path: string, generation: string, producer: string) => {
  const extension = extname(path);
  return (extension ? path.slice(0, -extension.length) : path) + `_${generation}_${producer}` + extension;
};

export const proofForPath = (path: string, proof: MediaProof): string | undefined => {
  const match = /_edited_([a-f\d]{64})_[a-f\d-]{36}\.[^/.]+$/.exec(path);
  if (proof.edits.length === 0 || match?.[1] !== proof.generation) {
    return;
  }
  return Buffer.from(JSON.stringify(proof)).toString('base64url');
};
