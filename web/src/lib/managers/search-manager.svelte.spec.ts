import { searchManager } from '#lib/managers/search-manager.svelte.ts';

describe('SearchManager', () => {
  beforeEach(() => {
    localStorage.clear();
    searchManager.reset();
  });

  it('defaults to smart search', () => {
    expect(searchManager.filter.queryType).toBe('smart');
  });

  it('preserves an explicit broad-similarity choice and resets to indexed content', () => {
    searchManager.setQuery({ query: 'самолёт', useSceneDescriptions: false, includeDepictions: true });
    expect(searchManager.filter.useSceneDescriptions).toBe(false);
    expect(searchManager.filter.includeDepictions).toBe(true);
    searchManager.reset();
    expect(searchManager.filter.useSceneDescriptions).toBeUndefined();
    expect(searchManager.filter.includeDepictions).toBeUndefined();
  });

  it('drops a stale similar-photo reference when opening a text query', () => {
    searchManager.setQuery({ query: 'Маша с собакой', queryAssetId: 'old-reference' });
    expect(searchManager.filter.queryAssetId).toBeUndefined();
    expect(searchManager.filter.query).toBe('Маша с собакой');
    searchManager.setQuery({ queryAssetId: 'image-reference' });
    expect(searchManager.filter.queryAssetId).toBe('image-reference');
  });

  it('remembers the selected query type', () => {
    searchManager.setQueryType('metadata');
    expect(searchManager.filter.queryType).toBe('metadata');

    searchManager.reset();
    expect(searchManager.filter.queryType).toBe('metadata');
  });

  it('overrides a previously stored query type', () => {
    localStorage.setItem('searchQueryType', 'metadata');
    searchManager.reset();

    searchManager.setQueryType('smart');
    searchManager.reset();
    expect(searchManager.filter.queryType).toBe('smart');
  });

  it('ignores an invalid stored query type', () => {
    localStorage.setItem('searchQueryType', 'invalid');
    searchManager.reset();
    expect(searchManager.filter.queryType).toBe('smart');
  });
});
