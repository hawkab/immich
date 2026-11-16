import { resolveNamedSearch } from 'src/utils/search-intent.js';

describe('named scene search', () => {
  const people = [
    { name: 'Маша', personGroupId: 'masha' },
    { name: 'Настя', personGroupId: 'nastya' },
    { name: 'Маша Петрова', personGroupId: 'masha-petrova' },
  ];

  it('requires the named person and leaves the scene for the visual model', () => {
    expect(resolveNamedSearch('Маша на море', people)).toEqual({ query: 'на море', personIds: ['masha'] });
  });

  it('does not confuse words with names inside them', () => {
    expect(resolveNamedSearch('машина на море', people)).toBeUndefined();
    expect(resolveNamedSearch('самолёт', people)).toBeUndefined();
  });

  it('handles case and punctuation without inventing aliases', () => {
    expect(resolveNamedSearch('«МАША», на море', people)).toEqual({ query: 'на море', personIds: ['masha'] });
    expect(resolveNamedSearch('Мария на море', people)).toBeUndefined();
  });

  it('prefers the longest catalogue name', () => {
    expect(resolveNamedSearch('Маша Петрова на море', people)).toEqual({
      query: 'на море',
      personIds: ['masha-petrova'],
    });
  });

  it('deduplicates repeated references and supports a name-only query', () => {
    expect(resolveNamedSearch('Маша', people)).toEqual({ query: '', personIds: ['masha'] });
    expect(resolveNamedSearch('Маша Маша на море', people)).toEqual({ query: 'на море', personIds: ['masha'] });
  });

  it('requires both explicitly named people for a conjunction', () => {
    expect(resolveNamedSearch('Маша и Настя на море', people)).toEqual({
      query: 'на море',
      personIds: ['masha', 'nastya'],
    });
  });

  it('does not turn an alternative into a conjunction', () => {
    expect(resolveNamedSearch('Маша или Настя на море', people)).toBeUndefined();
  });

  it('does not silently pick an identity when catalogue names collide', () => {
    expect(resolveNamedSearch('Маша на море', [...people, { name: 'Маша', personGroupId: 'another' }])).toBeUndefined();
  });
});
