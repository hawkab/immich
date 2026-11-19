import { Kysely } from 'kysely';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { CryptoRepository } from 'src/repositories/crypto.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { ShortLinkRepository } from 'src/repositories/short-link.repository.js';
import { DB } from 'src/schema/index.js';
import { ShortLinkService } from 'src/services/short-link.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let database: Kysely<DB>;
beforeAll(async () => {
  database = await getKyselyDB();
});
const setup = () =>
  newMediumService(ShortLinkService, {
    database,
    real: [AccessRepository, CryptoRepository, ShortLinkRepository],
    mock: [LoggingRepository],
  });
it('creates one stable alias concurrently and keeps it private to normal resource access', async () => {
  const { sut, ctx } = setup();
  const { user: owner } = await ctx.newUser();
  const { user: viewer } = await ctx.newUser();
  const { asset } = await ctx.newAsset({ ownerId: owner.id });
  const auth = factory.auth({ user: { id: owner.id } });
  const other = factory.auth({ user: { id: viewer.id } });
  const links = await Promise.all(Array.from({ length: 5 }, () => sut.create(auth, { type: 'asset', id: asset.id })));
  expect(new Set(links.map((link) => link.code)).size).toBe(1);
  const code = links[0].code;
  const ownLinks=await sut.getAll(auth);
  expect(ownLinks).toHaveLength(1);
  expect(await sut.getAll(other)).toEqual([]);
  await expect(sut.get(other, code)).rejects.toThrow();
  await database.insertInto('partner').values({ sharedById: owner.id, sharedWithId: viewer.id }).execute();
  expect(await sut.get(other, code)).toEqual({ code, path: `/photos/${asset.id}` });
  await sut.remove(other, code);
  expect(await sut.get(auth, code)).toEqual({ code, path: `/photos/${asset.id}` });
  await database.deleteFrom('partner').where('sharedWithId', '=', viewer.id).execute();
  await expect(sut.get(other, code)).rejects.toThrow();
  await sut.remove(auth, code);
  await expect(sut.get(auth, code)).rejects.toThrow();
});
it('checks asset existence on every resolution without deleting the source', async () => {
  const { sut, ctx } = setup();
  const { user } = await ctx.newUser();
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  const auth = factory.auth({ user: { id: user.id } });
  const { code } = await sut.create(auth, { type: 'asset', id: asset.id });
  expect(await database.selectFrom('asset').select('id').where('id', '=', asset.id).executeTakeFirst()).toBeDefined();
  await database.deleteFrom('asset').where('id', '=', asset.id).execute();
  await expect(sut.get(auth, code)).rejects.toThrow();
});
