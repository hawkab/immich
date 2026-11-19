import { searchMatch } from 'src/utils/search-match.js';
import { transcriptSearchParts } from 'src/utils/transcript-search.js';
import type { Transcript } from 'src/utils/transcription.js';

it('reports literal, fuzzy and semantic speech separately without claiming a visual match', () => {
  const segments = [{ text: 'Поедем отдыхать на побережье.', start: 12, end: 17 }];
  for (const [score, source] of [
    [3, 'speech-lexical'],
    [2, 'speech-fuzzy'],
    [0.9, 'speech-semantic'],
  ] as const) {
    const match = searchMatch(
      Buffer.alloc(20),
      { query: 'море', size: 10 },
      { visual: false, scene: false, score, part: 0, segments, segment: segments[0] },
    );
    expect(match.sources).toEqual([source]);
    expect(match.speech).toEqual(segments[0]);
  }
});
it('retains real metadata constraints and exposes visual similarity as similarity', () => {
  const match = searchMatch(
    Buffer.alloc(20),
    { query: 'самолёт', city: 'Москва', size: 10 },
    { visual: true, scene: true, score: 0 },
  );
  expect(match.sources).toEqual(['visual', 'scene', 'metadata']);
  expect(match.filters).toEqual([{ field: 'city', value: 'Москва' }]);
  expect(match.speech).toBeUndefined();
});
it('maps an indexed semantic part back to its real timestamp without changing window contents', () => {
  const parts = transcriptSearchParts({
    segments: [
      { text: 'Первое предложение.', start: 0, end: 4 },
      { text: 'Завтра мы пойдём к доктору.', start: 40, end: 43 },
    ],
  } as Transcript);
  expect(parts[1]).toEqual({ text: 'Завтра мы пойдём к доктору.', start: 40, end: 43 });
});
