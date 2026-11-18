import { generationPath, mediaProof, proofForPath } from 'src/utils/media-generation.js';

const source = {
  id: 'asset-id',
  checksum: Buffer.from('original'),
  edits: [{ action: 'crop', parameters: { width: 100, height: 90, x: 5, y: 3 } }],
};
const producer = '82b710aa-09ec-4be4-8aa3-a8aa0e2719c3';

describe('producer-bound media generations', () => {
  it('binds checksum and ordered logical edits, independent of JSON key insertion order', () => {
    const equivalent = { ...source, edits: [{ action: 'crop', parameters: { x: 5, y: 3, height: 90, width: 100 } }] };
    expect(mediaProof(source)).toEqual(mediaProof(equivalent));
    expect(mediaProof({ ...source, checksum: Buffer.from('changed') }).generation).not.toEqual(
      mediaProof(source).generation,
    );
  });

  it.each([
    [{ action: 'crop', parameters: { x: 6, y: 3, width: 100, height: 90 } }],
    [{ action: 'rotate', parameters: { angle: 90 } }],
    [{ action: 'mirror', parameters: { axis: 'horizontal' } }],
  ])('changes generation for a changed crop, rotate or mirror while isEdited can stay true', (edit) => {
    expect(mediaProof({ ...source, edits: [edit] }).generation).not.toEqual(mediaProof(source).generation);
  });

  it('serves proof only for the matching immutable generated path', () => {
    const proof = mediaProof(source);
    const path = generationPath('/thumbs/asset-id_preview_edited.jpeg', proof.generation, producer);
    const encoded = proofForPath(path, proof)!;
    expect(JSON.parse(Buffer.from(encoded, 'base64url').toString())).toEqual(proof);
    expect(proofForPath('/thumbs/asset-id_preview_edited.jpeg', proof)).toBeUndefined();
    expect(proofForPath(path, mediaProof({ ...source, edits: [] }))).toBeUndefined();
    expect(proofForPath(path, mediaProof({ ...source, checksum: Buffer.from('new') }))).toBeUndefined();
  });

  it('does not reuse a queued-for-deletion filename for a subsequent producer of the same edits', () => {
    const proof = mediaProof(source);
    const a = generationPath('/thumbs/asset-id_preview_edited.jpeg', proof.generation, producer);
    const b = generationPath(
      '/thumbs/asset-id_preview_edited.jpeg',
      proof.generation,
      'd22ecf1c-15fd-4dde-aaf9-45e57df63816',
    );
    expect(a).not.toEqual(b);
    expect(proofForPath(a, proof)).toEqual(proofForPath(b, proof));
  });
});
