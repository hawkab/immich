import { transcriptSearchTexts, transcriptTextChecksum } from 'src/utils/transcript-search.js';
import type { Transcript } from 'src/utils/transcription.js';

it('indexes every word in overlapping context windows without changing the transcript', () => {
  const words = Array.from({ length: 100 }, (_, i) => `слово${i}`);
  const transcript = { segments: [{ text: words.join(' ') }] } as Transcript;
  const before = structuredClone(transcript);
  const parts = transcriptSearchTexts(transcript);
  expect(new Set(parts.flatMap((part) => part.split(' ')))).toEqual(new Set(words));
  expect(parts[0].split(' ').slice(-3)).toEqual(parts[1].split(' ').slice(0, 3));
  expect(transcript).toEqual(before);
  expect(transcriptSearchTexts({ segments: [{ text: ' '.repeat(3) }] } as Transcript)).toEqual([]);
});

it('keeps sentence meaning and produces stable UTF-8 content identities', () => {
  const parts = transcriptSearchTexts({
    segments: [{ text: 'Мы купили автомобиль. Завтра пойдём к доктору!' }],
  } as Transcript);
  expect(parts).toEqual(['Мы купили автомобиль.', 'Завтра пойдём к доктору!']);
  expect(transcriptTextChecksum('Привет')).toBe('8a669e9418750c81ab90ae159a8ec410');
  expect(transcriptTextChecksum('Привет')).not.toBe(transcriptTextChecksum('Привет!'));
});
