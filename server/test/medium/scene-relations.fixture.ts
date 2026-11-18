import { Kysely } from 'kysely';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { DatabaseRepository } from 'src/repositories/database.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MachineLearningRepository } from 'src/repositories/machine-learning.repository.js';
import { PartnerRepository } from 'src/repositories/partner.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { SearchRepository } from 'src/repositories/search.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { DB } from 'src/schema/index.js';
import { SearchService } from 'src/services/search.service.js';
import { newMediumService } from 'test/medium.factory.js';

export const sceneEmbedding = JSON.stringify(Array.from({ length: 512 }, (_, i) => (i === 0 ? 1 : 0)));

export const sceneRelationFixture = async (database: Kysely<DB>) => {
  const { sut, ctx } = newMediumService(SearchService, {
    database,
    real: [
      AccessRepository,
      AssetRepository,
      ConfigRepository,
      DatabaseRepository,
      PartnerRepository,
      PersonRepository,
      SearchRepository,
      SystemMetadataRepository,
    ],
    mock: [LoggingRepository, MachineLearningRepository],
  });
  const { user } = await ctx.newUser();
  const { person: masha } = await ctx.newPerson({ ownerId: user.id, name: 'Маша' });
  const { person: other } = await ctx.newPerson({ ownerId: user.id, name: 'Другой человек' });
  const repository = ctx.get(SearchRepository);
  ctx.getMock(MachineLearningRepository).encodeText.mockResolvedValue(sceneEmbedding);
  const photo = async (rider: 'masha' | 'other' | null, depicted = false) => {
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: mashaFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: masha.personGroupId });
    const { assetFace: otherFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: other.personGroupId });
    await repository.upsert(asset.id, sceneEmbedding);
    const scene = {
      schemaVersion: 1,
      sourceChecksum: asset.checksum.toString('base64'),
      thumbhash: asset.thumbhash?.toString('base64') ?? null,
      isEdited: false,
      kind: 'photo',
      relationsSchemaVersion: 1,
      relationAnalysis: { edits: [] },
      searchText: depicted ? 'ребёнок, игрушечная лошадь' : 'ребёнок, лошадь',
      depictedText: depicted ? 'лошадь' : '',
      relations: rider
        ? [
            {
              predicate: 'riding',
              object: 'horse',
              subjectFaceIds: [rider === 'masha' ? mashaFace.id : otherFace.id],
              depicted,
              evidence: depicted ? 'ребёнок сидит на игрушечной лошади' : 'человек сидит верхом на лошади',
            },
          ]
        : [],
    };
    await ctx.newMetadata({ assetId: asset.id, key: 'org.immich.scene.v1', value: scene });
    return { asset, mashaFace, otherFace, scene };
  };
  return { sut, ctx, repository, user, masha, other, photo };
};
