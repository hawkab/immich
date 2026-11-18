import { Kysely } from 'kysely';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PartnerRepository } from 'src/repositories/partner.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { DB } from 'src/schema/index.js';
import { PartnerService } from 'src/services/partner.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let database: Kysely<DB>;
beforeAll(async () => {
  database = await getKyselyDB();
});

it('updates deletion and editing grants independently without resetting omitted permissions', async () => {
  const { sut, ctx } = newMediumService(PartnerService, {
    database,
    real: [AccessRepository, PartnerRepository, UserRepository],
    mock: [LoggingRepository],
  });
  const { user: owner } = await ctx.newUser();
  const { user: recipient } = await ctx.newUser();
  const auth = factory.auth({ user: owner });
  await sut.create(auth, { sharedWithId: recipient.id });
  await expect(sut.updatePermissions(auth, recipient.id, { canEdit: true })).resolves.toMatchObject({
    canEdit: true,
    canDelete: false,
  });
  await expect(sut.updatePermissions(auth, recipient.id, { canDelete: true })).resolves.toMatchObject({
    canEdit: true,
    canDelete: true,
  });
  await expect(sut.updatePermissions(auth, recipient.id, { canEdit: false })).resolves.toMatchObject({
    canEdit: false,
    canDelete: true,
  });
  await expect(sut.updatePermissions(auth, recipient.id, { canDelete: false })).resolves.toMatchObject({
    canEdit: false,
    canDelete: false,
  });
});
