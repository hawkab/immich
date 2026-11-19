import { Kysely, sql } from 'kysely';
import { AssetType, AssetVisibility } from 'src/enum.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { SearchRepository } from 'src/repositories/search.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { transcriptFuzzyMatch } from 'src/utils/transcript-search.js';
import { TRANSCRIPT_KEY } from 'src/utils/transcription.js';
import { newMediumService } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

let database: Kysely<DB>;
beforeAll(async () => {
  database = await getKyselyDB();
});

const unrelated = [
  'Молоко, яйца, гречка. Кофе, молоко.',
  'Мы копали природ.',
  'Мотылёк на свечке, кольца до конца.',
  'Костя. Кошка. Не мучай кошу. Кость.',
  'Зачем ты ко мне с кофтой пришёл?',
  'Котик, котик, ты зачем написал котик?',
  'Никогда не ел яблоки. Не люблю пробовать новые вещи.',
  'Какой это покой, сколько танцев.',
  'Машуня, копошуня.',
  'Пойдём, мамочка, в комнату.',
];

it.each(unrelated)('rejects a shared word prefix as evidence for goat: %s', async (text) => {
  const result = await database.transaction().execute(async (trx) => {
    await sql`set local pg_trgm.word_similarity_threshold = 0.5`.execute(trx);
    await sql`set local pg_trgm.strict_word_similarity_threshold = 0.5`.execute(trx);
    return sql<{ matched: boolean }>`select ${transcriptFuzzyMatch('коза')} as matched
      from (select jsonb_build_object('text', ${text}::text) as value) transcript`.execute(trx);
  });
  expect(result.rows[0].matched).toBe(false);
});

it('retains inflections and genuine misspellings in legacy and structured speech search', async () => {
  const { ctx } = newMediumService(BaseService, {
    database,
    real: [AssetRepository, SearchRepository],
    mock: [LoggingRepository],
  });
  const { user } = await ctx.newUser();
  const assets = ctx.get(AssetRepository);
  const search = ctx.get(SearchRepository);
  const make = async (text: string) => {
    const { asset } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Video });
    await assets.upsertMetadata(asset.id, [
      {
        key: TRANSCRIPT_KEY,
        value: {
          schemaVersion: 1,
          sourceChecksum: asset.checksum.toString('base64'),
          status: 'complete',
          text,
        },
      },
    ]);
    return asset;
  };
  for (const text of unrelated) await make(text);
  const positives = await Promise.all(
    ['Коза пасётся.', 'Козы гуляют.', 'Мы гуляли с козой.'].map((text) => make(text)),
  );
  const scope = { userIds: [user.id], viewingUserId: user.id, lockedOwnerId: user.id };
  for (const query of ['коза', 'козы', 'козой', 'козза']) {
    const options = { embedding: '', transcriptQuery: query, transcriptOnly: true };
    const modern = await search.searchSmartV3({ take: 100 }, options, scope);
    const legacy = await search.searchSmart(
      { page: 1, size: 100 },
      { ...options, ...scope, visibility: AssetVisibility.Timeline },
    );
    for (const result of [modern, legacy]) {
      expect(result.items.map((row) => row.id).sort(), query).toEqual(positives.map((asset) => asset.id).sort());
    }
  }
});
