import { tokenizeOcrSearch } from 'src/utils/ocr-search.js';

it('keeps observed OCR and adds a script-consistent alias for mixed Cyrillic words', () => {
  expect(tokenizeOcrSearch('PОMAH OЛbГA')).toEqual(['PОMAH', 'роман', 'OЛbГA', 'ольга']);
  expect(tokenizeOcrSearch('KA3bMИP')).toEqual(['KA3bMИP', 'казьмир']);
});

it('leaves Russian, English, identifiers and digit-only strings unchanged', () => {
  expect(tokenizeOcrSearch('КОШКА Hello coffee KY3bMMHA 392883')).toEqual([
    'КОШКА',
    'Hello',
    'coffee',
    'KY3bMMHA',
    '392883',
  ]);
});

it('preserves existing CJK tokenization and punctuation', () => {
  expect(tokenizeOcrSearch('機器學習 PОMAH,')).toEqual(['機器', '器學', '學習', 'PОMAH,', 'роман,']);
});

it('does not infer names or replace different-looking letters', () => {
  expect(tokenizeOcrSearch('ZФN QДW')).toEqual(['ZФN', 'QДW']);
});
