import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { LRUMap } from 'mnemonist';
import { readFile } from 'node:fs/promises';
import { AssetMapOptions, AssetResponseDto, MapAsset, mapAsset } from 'src/dtos/asset-response.dto.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { SystemConfig } from 'src/dtos/config.dto.js';
import { PersonResponseDto, mapPerson } from 'src/dtos/person.dto.js';
import {
  LargeAssetSearchDto,
  MetadataSearchDto,
  PlacesResponseDto,
  RandomSearchDto,
  SearchFilter,
  SearchPeopleDto,
  SearchPlacesDto,
  SearchResponseDto,
  SearchStatisticsResponseDto,
  SearchSuggestionRequestDto,
  SearchSuggestionType,
  SmartSearchDto,
  StatisticsSearchDto,
  isFullyAlbumConfined,
  isNewShapeRequest,
  mapPlaces,
} from 'src/dtos/search.dto.js';
import { VisualEvidenceDto, VisualEvidenceResponseDto } from 'src/dtos/visual-evidence.dto.js';
import { AssetFileType, AssetOrder, AssetType, AssetVisibility, Permission } from 'src/enum.js';
import { AssetSearchScope } from 'src/repositories/search.repository.js';
import { BaseService } from 'src/services/base.service.js';
import { requireElevatedPermission } from 'src/utils/access.js';
import { getMyPartnerIds } from 'src/utils/asset.util.js';
import { mediaProof, proofForPath } from 'src/utils/media-generation.js';
import { isSmartSearchEnabled } from 'src/utils/misc.js';
import { decodeSearchCursor, encodeSearchCursor } from 'src/utils/search-cursor.js';
import { applyLockedVisibilityPolicy, collectFilterIds } from 'src/utils/search-filter.js';
import { resolveNamedSearch } from 'src/utils/search-intent.js';
import { searchMatch, type RawSearchMatch } from 'src/utils/search-match.js';
import { speechQuery } from 'src/utils/transcription.js';
import { VisualEvidenceEngine } from 'src/utils/visual-evidence.js';

@Injectable()
export class SearchService extends BaseService {
  private visualEvidenceEngine = new VisualEvidenceEngine();

  async visualEvidence(auth: AuthDto, dto: VisualEvidenceDto): Promise<VisualEvidenceResponseDto> {
    await this.requireAccess({ auth, ids: [dto.assetId], permission: Permission.AssetRead });
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isSmartSearchEnabled(machineLearning)) throw new BadRequestException('Smart search is disabled');
    const asset = await this.assetRepository.getById(dto.assetId, { files: true, edits: true });
    if (!asset || asset.deletedAt) throw new BadRequestException('Asset is unavailable');
    const proof = mediaProof({ ...asset, edits: asset.edits ?? [] });
    if (proof.sourceChecksum !== dto.sourceChecksum || (dto.generation && proof.generation !== dto.generation))
      throw new ConflictException('The displayed media changed');
    let time: number | undefined;
    let path: string;
    if (asset.type === AssetType.Video) {
      time = dto.time ?? 0;
      if (!asset.duration || time >= asset.duration / 1000 || (asset.edits ?? []).length > 0)
        throw new BadRequestException('The video frame is unavailable');
      path = asset.originalPath;
    } else {
      const preview = (asset.files ?? []).find(
        (file) => file.type === AssetFileType.Preview && file.isEdited === (asset.edits ?? []).length > 0,
      );
      if (!preview || ((asset.edits ?? []).length > 0 && !proofForPath(preview.path, proof)))
        throw new ConflictException('The current preview is not ready');
      path = preview.path;
    }
    const target = await this.resolveEmbedding(auth, { ...dto, size: 1 }, machineLearning);
    const model = machineLearning.clip.modelName;
    const evidence = await this.visualEvidenceEngine.explain(
      JSON.stringify([proof.generation, path, time, model]),
      () => (time === undefined ? readFile(path) : this.mediaRepository.extractVideoFrame(path, time)),
      target,
      (image) => this.machineLearningRepository.encodeImageBuffer(image, machineLearning.clip),
      dto.localize,
    );
    await this.requireAccess({ auth, ids: [dto.assetId], permission: Permission.AssetRead });
    if (dto.queryAssetId) await this.requireAccess({ auth, ids: [dto.queryAssetId], permission: Permission.AssetRead });
    const current = await this.assetRepository.getById(dto.assetId, { edits: true });
    if (
      !current ||
      current.deletedAt ||
      mediaProof({ ...current, edits: current.edits ?? [] }).generation !== proof.generation
    )
      throw new ConflictException('The media changed during analysis');
    return {
      assetId: asset.id,
      sourceChecksum: proof.sourceChecksum,
      generation: proof.generation,
      model,
      time,
      ...evidence,
    };
  }

  private embeddingCache = new LRUMap<string, string>(100);

  async searchPerson(auth: AuthDto, dto: SearchPeopleDto): Promise<PersonResponseDto[]> {
    const people = await this.personRepository.getByName(auth.user.id, dto.name, { withHidden: dto.withHidden });
    return people.map((person) => mapPerson(person));
  }

  async searchPlaces(dto: SearchPlacesDto): Promise<PlacesResponseDto[]> {
    const places = await this.searchRepository.searchPlaces(dto.name);
    return places.map((place) => mapPlaces(place));
  }

  async getExploreData(auth: AuthDto) {
    const options = { maxFields: 12, minAssetsPerField: 5 };

    const cities = await this.assetRepository.getAssetIdByCity(auth.user.id, options);
    const cityAssets = await this.assetRepository.getByIdsWithAllRelationsButStacks(
      cities.items.map(({ data }) => data),
      auth.user.id,
    );
    const cityItems = cityAssets.map((asset) => ({ value: asset.exifInfo!.city!, data: mapAsset(asset, { auth }) }));

    const recents = await this.assetRepository.getRecentlyCreatedAssetIds(auth.user.id, options.maxFields);
    const recentAssets = await this.assetRepository.getByIdsWithAllRelationsButStacks(
      recents.items.map((item) => item.data),
      auth.user.id,
    );
    const recentItems = recentAssets.map((asset) => ({
      value: asset.createdAt.toISOString(),
      data: mapAsset(asset, { auth }),
    }));

    return [
      { fieldName: cities.fieldName, items: cityItems },
      { fieldName: recents.fieldName, items: recentItems },
    ];
  }

  async searchMetadata(auth: AuthDto, dto: MetadataSearchDto): Promise<SearchResponseDto> {
    if (isNewShapeRequest(dto)) {
      return this.searchMetadataV3(auth, dto);
    }

    if (dto.visibility === AssetVisibility.Locked) {
      requireElevatedPermission(auth);
    }

    let checksum: Buffer | undefined;
    if (dto.checksum) {
      const encoding = dto.checksum.length === 28 ? 'base64' : 'hex';
      checksum = Buffer.from(dto.checksum, encoding);
    }

    let userIds: string[] | undefined;

    if (dto.albumIds && dto.albumIds.length > 0) {
      await this.requireAccess({ auth, ids: dto.albumIds, permission: Permission.AlbumRead });
    } else if (auth.sharedLink) {
      throw new BadRequestException('Shared link access is only allowed in combination with an albumIds filter');
    } else {
      userIds = await this.getUserIdsToSearch(auth, dto.visibility);
    }

    const page = dto.page ?? 1;
    const size = dto.size;
    const { hasNextPage, items } = await this.searchRepository.searchMetadata(
      { page, size },
      {
        ...dto,
        checksum,
        visibility: dto.visibility ?? (auth.session?.hasElevatedPermission ? undefined : 'not-locked'),
        userIds,
        viewingUserId: auth.user.id,
        orderDirection: dto.order ?? AssetOrder.Desc,
      },
    );

    return this.mapResponse(items, { auth }, { nextPage: hasNextPage ? (page + 1).toString() : null }, dto);
  }

  async searchStatistics(auth: AuthDto, dto: StatisticsSearchDto): Promise<SearchStatisticsResponseDto> {
    if (isNewShapeRequest(dto)) {
      return this.searchStatisticsV3(auth, dto);
    }

    const userIds = await this.getUserIdsToSearch(auth, dto.visibility);
    if (dto.visibility === AssetVisibility.Locked) {
      requireElevatedPermission(auth);
    }

    return await this.searchRepository.searchStatistics({
      ...dto,
      visibility: dto.visibility ?? (auth.session?.hasElevatedPermission ? undefined : 'not-locked'),
      userIds,
      viewingUserId: auth.user.id,
    });
  }

  async searchRandom(auth: AuthDto, dto: RandomSearchDto): Promise<AssetResponseDto[]> {
    if (isNewShapeRequest(dto)) {
      return this.searchRandomV3(auth, dto);
    }

    if (dto.visibility === AssetVisibility.Locked) {
      requireElevatedPermission(auth);
    }

    const userIds = await this.getUserIdsToSearch(auth, dto.visibility);
    const items = await this.searchRepository.searchRandom(dto.size, {
      ...dto,
      visibility: dto.visibility ?? (auth.session?.hasElevatedPermission ? undefined : 'not-locked'),
      userIds,
      viewingUserId: auth.user.id,
    });
    return items.map((item) => mapAsset(item, { auth }));
  }

  async searchLargeAssets(auth: AuthDto, dto: LargeAssetSearchDto): Promise<AssetResponseDto[]> {
    if (dto.visibility === AssetVisibility.Locked) {
      requireElevatedPermission(auth);
    }

    const userIds = await this.getUserIdsToSearch(auth, dto.visibility);
    const items = await this.searchRepository.searchLargeAssets(dto.size, {
      ...dto,
      visibility: dto.visibility ?? (auth.session?.hasElevatedPermission ? undefined : 'not-locked'),
      userIds,
      viewingUserId: auth.user.id,
    });
    return items.map((item) => mapAsset(item, { auth }));
  }

  async searchSmart(auth: AuthDto, dto: SmartSearchDto & { matchedPeople?: string[] }): Promise<SearchResponseDto> {
    const speech = speechQuery(dto.query);
    dto = { ...dto, query: speech.query, ...((dto.transcriptOnly || speech.only) && { transcriptOnly: true }) };
    const planned = dto.transcriptOnly ? undefined : await this.resolveNamedQuery(auth, dto);
    if (planned) {
      dto = planned;
      if (!dto.query) {
        return this.searchMetadata(auth, dto);
      }
    }
    if (isNewShapeRequest(dto)) {
      return this.searchSmartV3(auth, dto);
    }

    if (dto.visibility === AssetVisibility.Locked) {
      requireElevatedPermission(auth);
    }

    const { machineLearning } = await this.getConfig({ withCache: false });
    if (dto.transcriptOnly && (!machineLearning.enabled || !machineLearning.transcription.enabled)) {
      throw new BadRequestException('Video transcription is not enabled');
    }
    if (!isSmartSearchEnabled(machineLearning) && !dto.transcriptOnly) {
      throw new BadRequestException('Smart search is not enabled');
    }

    const userIds = this.getUserIdsToSearch(auth, dto.visibility);
    const embedding =
      dto.transcriptOnly && !isSmartSearchEnabled(machineLearning)
        ? ''
        : await this.resolveEmbedding(auth, dto, machineLearning);
    const page = dto.page ?? 1;
    const size = dto.size;
    const { hasNextPage, items } = await this.searchRepository.searchSmart(
      { page, size },
      {
        ...dto,
        userIds: await userIds,
        viewingUserId: auth.user.id,
        embedding,
        ...(machineLearning.transcription.enabled &&
          dto.query && {
            transcriptQuery: dto.query,
            transcriptOnly: dto.transcriptOnly,
            transcriptModel: machineLearning.clip.modelName,
            transcriptMinSimilarity: machineLearning.transcription.searchMinSimilarity,
          }),
        ...this.textSearchOptions(dto, machineLearning.clip),
        visibility: dto.visibility ?? (auth.session?.hasElevatedPermission ? undefined : 'not-locked'),
      },
    );

    return this.mapResponse(items, { auth }, { nextPage: hasNextPage ? (page + 1).toString() : null }, dto);
  }

  async getAssetsByCity(auth: AuthDto): Promise<AssetResponseDto[]> {
    const userIds = await this.getUserIdsToSearch(auth);
    const assets = await this.searchRepository.getAssetsByCity(userIds);
    return assets.map((asset) => mapAsset(asset));
  }

  async getSearchSuggestions(auth: AuthDto, dto: SearchSuggestionRequestDto) {
    const userIds = await this.getUserIdsToSearch(auth);
    const suggestions = await this.getSuggestions(userIds, dto);
    if (dto.includeNull) {
      suggestions.push(null);
    }
    return suggestions;
  }

  private getSuggestions(userIds: string[], dto: SearchSuggestionRequestDto): Promise<Array<string | null>> {
    switch (dto.type) {
      case SearchSuggestionType.COUNTRY: {
        return this.searchRepository.getCountries(userIds);
      }
      case SearchSuggestionType.STATE: {
        return this.searchRepository.getStates(userIds, dto);
      }
      case SearchSuggestionType.CITY: {
        return this.searchRepository.getCities(userIds, dto);
      }
      case SearchSuggestionType.CAMERA_MAKE: {
        return this.searchRepository.getCameraMakes(userIds, dto);
      }
      case SearchSuggestionType.CAMERA_MODEL: {
        return this.searchRepository.getCameraModels(userIds, dto);
      }
      case SearchSuggestionType.CAMERA_LENS_MODEL: {
        return this.searchRepository.getCameraLensModels(userIds, dto);
      }
      default: {
        return Promise.resolve([]);
      }
    }
  }

  private async searchMetadataV3(auth: AuthDto, dto: MetadataSearchDto): Promise<SearchResponseDto> {
    const { filter, scope } = await this.resolveSearchScopeV3(auth, dto);

    const { offset } = decodeSearchCursor(dto.cursor);
    const size = dto.size;
    const { hasNextPage, items } = await this.searchRepository.searchMetadataV3(
      { take: size, skip: offset },
      {
        filter,
        explainAssetId: dto.explainAssetId,
        withExif: dto.withExif,
        withPeople: dto.withPeople,
        withStacked: dto.withStacked,
        order: dto.orderBy,
      },
      scope,
    );

    return this.mapResponse(
      items,
      { auth },
      { nextCursor: hasNextPage ? encodeSearchCursor(offset + size) : null },
      dto,
    );
  }

  private async searchStatisticsV3(auth: AuthDto, dto: StatisticsSearchDto): Promise<SearchStatisticsResponseDto> {
    const { filter, scope } = await this.resolveSearchScopeV3(auth, dto);
    return this.searchRepository.searchStatisticsV3({ filter }, scope);
  }

  private async searchRandomV3(auth: AuthDto, dto: RandomSearchDto): Promise<AssetResponseDto[]> {
    const { filter, scope } = await this.resolveSearchScopeV3(auth, dto);
    const items = await this.searchRepository.searchRandomV3(
      dto.size,
      {
        filter,
        withExif: dto.withExif,
        withPeople: dto.withPeople,
        withStacked: dto.withStacked,
      },
      scope,
    );
    return items.map((item) => mapAsset(item, { auth }));
  }

  private async searchSmartV3(
    auth: AuthDto,
    dto: SmartSearchDto & { matchedPeople?: string[] },
  ): Promise<SearchResponseDto> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    if (dto.transcriptOnly && (!machineLearning.enabled || !machineLearning.transcription.enabled)) {
      throw new BadRequestException('Video transcription is not enabled');
    }
    if (!isSmartSearchEnabled(machineLearning) && !dto.transcriptOnly) {
      throw new BadRequestException('Smart search is not enabled');
    }

    const [{ filter, scope }, embedding] = await Promise.all([
      this.resolveSearchScopeV3(auth, dto),
      dto.transcriptOnly && !isSmartSearchEnabled(machineLearning)
        ? Promise.resolve('')
        : this.resolveEmbedding(auth, dto, machineLearning),
    ]);

    // no cursor until a rank-aware pagination strategy for smart search is decided
    const { items } = await this.searchRepository.searchSmartV3(
      { take: dto.size },
      {
        filter,
        explainAssetId: dto.explainAssetId,
        withExif: dto.withExif,
        embedding,
        ...(machineLearning.transcription.enabled &&
          dto.query && {
            transcriptQuery: dto.query,
            transcriptOnly: dto.transcriptOnly,
            transcriptModel: machineLearning.clip.modelName,
            transcriptMinSimilarity: machineLearning.transcription.searchMinSimilarity,
          }),
        ...this.textSearchOptions(dto, machineLearning.clip),
      },
      scope,
    );

    return this.mapResponse(items, { auth }, {}, dto);
  }

  private async resolveSearchScopeV3(
    auth: AuthDto,
    dto: { filter?: SearchFilter },
  ): Promise<{ filter: SearchFilter; scope: AssetSearchScope }> {
    const filter = dto.filter ?? {};
    const effectiveFilter = applyLockedVisibilityPolicy(auth, filter);

    const fullyConfined = isFullyAlbumConfined(filter);
    // a shared link visitor does not have a universe, so there every branch must be confined
    if (auth.sharedLink && !fullyConfined) {
      throw new BadRequestException('Shared link access is only allowed in combination with an albumIds filter');
    }

    const albumIds = collectFilterIds(filter, 'albumIds');
    const [userIds] = await Promise.all([
      // a fully confined filter searches albums only, so the unused universe can skip the partner lookup
      fullyConfined ? [auth.user.id] : this.getUserIdsToSearch(auth),
      albumIds.length > 0 ? this.requireAccess({ auth, ids: albumIds, permission: Permission.AlbumRead }) : undefined,
    ]);

    return { filter: effectiveFilter, scope: { userIds, lockedOwnerId: auth.user.id, viewingUserId: auth.user.id } };
  }

  private textSearchOptions(dto: SmartSearchDto, clip: SystemConfig['machineLearning']['clip']) {
    const configuredThreshold = dto.query ? clip.minSimilarity : null;
    const minSimilarity = dto.minSimilarity === undefined ? configuredThreshold : dto.minSimilarity;
    const sceneQuery =
      (dto.useSceneDescriptions ?? clip.useSceneDescriptions) &&
      dto.query &&
      /\p{Script=Cyrillic}/u.test(dto.query) &&
      dto.query;
    return {
      ...(typeof minSimilarity === 'number' && { minSimilarity }),
      ...(sceneQuery && { sceneQuery, includeDepictions: dto.includeDepictions ?? clip.includeDepictions }),
    };
  }

  private async resolveNamedQuery(
    auth: AuthDto,
    dto: SmartSearchDto,
  ): Promise<(SmartSearchDto & { matchedPeople?: string[] }) | undefined> {
    if (
      !dto.query ||
      auth.sharedLink ||
      dto.personIds?.length ||
      (dto.filter && collectFilterIds(dto.filter, 'personIds').length > 0)
    ) {
      return;
    }
    const people = await this.personRepository.getNamedForSearch(auth.user.id);
    const intent = resolveNamedSearch(dto.query, people ?? []);
    if (!intent) {
      return;
    }
    const matchedPeople = people
      .filter((person) => intent.personIds.includes(person.personGroupId))
      .map((person) => person.name);
    if (isNewShapeRequest(dto)) {
      return {
        ...dto,
        matchedPeople,
        query: intent.query,
        filter: { ...dto.filter, personIds: { all: intent.personIds } },
      };
    }
    return { ...dto, matchedPeople, query: intent.query, personIds: intent.personIds };
  }

  private async resolveEmbedding(
    auth: AuthDto,
    dto: SmartSearchDto,
    machineLearning: SystemConfig['machineLearning'],
  ): Promise<string> {
    if (dto.query) {
      const key = machineLearning.clip.modelName + dto.query + dto.language;
      let embedding = this.embeddingCache.get(key);
      if (!embedding) {
        embedding = await this.machineLearningRepository.encodeText(dto.query, {
          modelName: machineLearning.clip.modelName,
          language: dto.language,
        });
        this.embeddingCache.set(key, embedding);
      }
      return embedding;
    }

    if (dto.queryAssetId) {
      await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [dto.queryAssetId] });
      const getEmbeddingResponse = await this.searchRepository.getEmbedding(dto.queryAssetId);
      const assetEmbedding = getEmbeddingResponse?.embedding;
      if (!assetEmbedding) {
        throw new BadRequestException(`Asset ${dto.queryAssetId} has no embedding`);
      }
      return assetEmbedding;
    }

    throw new BadRequestException('Either `query` or `queryAssetId` must be set');
  }

  private async getUserIdsToSearch(auth: AuthDto, visibility?: AssetVisibility): Promise<string[]> {
    // Locked assets are personal. Never include partner IDs, regardless of A's elevated session.
    if (visibility === AssetVisibility.Locked) {
      return [auth.user.id];
    }
    const partnerIds = await getMyPartnerIds({
      userId: auth.user.id,
      repository: this.partnerRepository,
      timelineEnabled: true,
    });
    return [auth.user.id, ...partnerIds];
  }

  private mapResponse(
    assets: (MapAsset & { searchProvenance?: RawSearchMatch })[],
    options: AssetMapOptions,
    page: { nextPage?: string | null; nextCursor?: string | null } = {},
    criteria?: SmartSearchDto | MetadataSearchDto,
  ): SearchResponseDto {
    return {
      albums: { total: 0, count: 0, items: [], facets: [] },
      assets: {
        total: assets.length,
        count: assets.length,
        items: assets.map((asset) => ({
          ...mapAsset(asset, options),
          ...(criteria &&
            !options.auth?.sharedLink && {
              searchMatch: searchMatch(asset.checksum, criteria, asset.searchProvenance),
            }),
        })),
        facets: [],
        nextPage: page.nextPage ?? null,
        nextCursor: page.nextCursor ?? null,
      },
    };
  }
}
