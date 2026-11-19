import { Kysely } from 'kysely';
import { AssetVisibility } from 'src/enum.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { OcrRepository } from 'src/repositories/ocr.repository.js';
import { SearchRepository } from 'src/repositories/search.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { tokenizeOcrSearch } from 'src/utils/ocr-search.js';
import { newMediumService } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

let database: Kysely<DB>;
beforeAll(async () => {
  database = await getKyselyDB();
});

it('finds mixed-script OCR in both search contracts without admitting unrelated or foreign photos', async () => {
  const { ctx } = newMediumService(BaseService, {
    database,
    real: [AssetRepository, OcrRepository, SearchRepository],
    mock: [LoggingRepository],
  });
  const { user } = await ctx.newUser();
  const { user: foreign } = await ctx.newUser();
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  const { asset: forbidden } = await ctx.newAsset({ ownerId: foreign.id });
  const ocr = ctx.get(OcrRepository);
  const search = ctx.get(SearchRepository);
  const text = 'PОMAH OЛbГA';
  const write = (id: string, searchText: string) =>
    ocr.upsert(
      id,
      [
        {
          assetId: id,
          x1: 0,
          y1: 0,
          x2: 1,
          y2: 0,
          x3: 1,
          y3: 1,
          x4: 0,
          y4: 1,
          text,
          boxScore: 0.9,
          textScore: 0.76,
        },
      ],
      searchText,
    );
  const scope = { userIds: [user.id], viewingUserId: user.id, lockedOwnerId: user.id };
  const legacy = (ocr: string) =>
    search.searchMetadata({ page: 1, size: 100 }, { ...scope, ocr, visibility: AssetVisibility.Timeline });
  await write(asset.id, text);
  const before = await legacy('роман');
  expect(before.items).toHaveLength(0);
  await write(asset.id, tokenizeOcrSearch(text).join(' '));
  await write(forbidden.id, tokenizeOcrSearch(text).join(' '));
  for (const query of ['роман', 'ОЛЬГА']) {
    const modern = await search.searchMetadataV3({ take: 100 }, { filter: { ocr: { matches: query } } }, scope);
    expect(modern.items.map((row) => row.id)).toEqual([asset.id]);
    const result = await legacy(query);
    expect(result.items.map((row) => row.id)).toEqual([asset.id]);
  }
  for (const query of ['кошка', 'кофе']) {
    const result = await legacy(query);
    expect(result.items).toHaveLength(0);
  }
  const regions = await ocr.getByAssetId(asset.id);
  expect(regions[0].text).toBe(text);
});
