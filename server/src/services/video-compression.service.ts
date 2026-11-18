import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent, OnJob } from 'src/decorators.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import {
  VideoCompressionConfirmDto,
  VideoCompressionCreateDto,
  VideoCompressionRequestDto,
} from 'src/dtos/video-compression.dto.js';
import {
  AssetStatus,
  AssetType,
  AssetVisibility,
  CacheControl,
  ImmichWorker,
  JobName,
  JobStatus,
  Permission,
  QueueName,
} from 'src/enum.js';
import { BaseService } from 'src/services/base.service.js';
import type { JobOf } from 'src/types.js';
import { isGranted } from 'src/utils/access.js';
import { ImmichFileResponse } from 'src/utils/file.js';
import { compressionCommand, compressionPath, compressionResponse } from 'src/utils/video-compression.js';

@Injectable()
export class VideoCompressionService extends BaseService {
  private requireScope(auth: AuthDto, permission: Permission) {
    if (auth.apiKey && !isGranted({ requested: [permission], current: auth.apiKey.permissions })) {
      throw new ForbiddenException('API key is missing the required permission');
    }
  }
  private async owned(auth: AuthDto, id: string) {
    this.requireScope(auth, Permission.AssetUpdate);
    await this.requireAccess({ auth, permission: Permission.AssetUpdate, ids: [id] });
    const asset = await this.assetRepository.getById(id);
    if (!asset || auth.sharedLink || asset.ownerId !== auth.user.id) {
      throw new NotFoundException('Video not found');
    }
    if (
      asset.type !== AssetType.Video ||
      asset.libraryId ||
      asset.deletedAt ||
      asset.isOffline ||
      asset.status !== AssetStatus.Active ||
      asset.visibility === AssetVisibility.Locked
    ) {
      throw new BadRequestException('Compression requires an available video uploaded by you');
    }
    return asset;
  }

  async get(auth: AuthDto, id: string) {
    await this.owned(auth, id);
    const draft = await this.videoCompressionRepository.get(id);
    return { draft: draft ? compressionResponse(draft) : null };
  }

  async create(auth: AuthDto, id: string, dto: VideoCompressionCreateDto) {
    const asset = await this.owned(auth, id);
    if (asset.checksum.toString('base64') !== dto.sourceChecksum) {
      throw new ConflictException('The original changed. Reload this video before compressing it');
    }
    const stat = await this.storageRepository.stat(asset.originalPath);
    const draft = {
      ...dto,
      sourcePath: asset.originalPath,
      outputPath: compressionPath(asset.originalPath, dto.requestId),
      originalSize: stat.size,
      status: 'queued' as const,
      cleanup: [],
    };
    if (!(await this.videoCompressionRepository.create(id, auth.user.id, draft))) {
      throw new ConflictException('Another compression is running or the original changed');
    }
    await this.jobRepository.queue({ name: JobName.VideoCompress, data: { id } });
    return this.get(auth, id);
  }

  async preview(auth: AuthDto, id: string, dto: VideoCompressionRequestDto) {
    this.requireScope(auth, Permission.AssetDownload);
    await this.requireAccess({ auth, permission: Permission.AssetDownload, ids: [id] });
    const asset = await this.owned(auth, id);
    const draft = await this.videoCompressionRepository.get(id);
    if (
      !draft ||
      draft.requestId !== dto.requestId ||
      draft.sourceChecksum !== dto.sourceChecksum ||
      draft.status !== 'ready' ||
      asset.checksum.toString('base64') !== draft.sourceChecksum
    ) {
      throw new ConflictException('This preview is not ready or belongs to an older original');
    }
    return new ImmichFileResponse({
      path: draft.outputPath,
      contentType: 'video/mp4',
      cacheControl: CacheControl.None,
    });
  }

  async discard(auth: AuthDto, id: string, dto: VideoCompressionRequestDto) {
    await this.owned(auth, id);
    const draft = await this.videoCompressionRepository.get(id);
    if (
      !draft ||
      draft.requestId !== dto.requestId ||
      draft.sourceChecksum !== dto.sourceChecksum ||
      ['saving', 'committed'].includes(draft.status)
    ) {
      throw new ConflictException('This preview has already changed');
    }
    await this.videoCompressionRepository.update(
      id,
      dto.requestId,
      { status: 'discarded', cleanup: [...draft.cleanup, draft.outputPath] },
      ['queued', 'processing', 'ready', 'failed'],
    );
    await this.jobRepository.queue({ name: JobName.VideoCompress, data: { id } });
    return this.get(auth, id);
  }

  async confirm(auth: AuthDto, id: string, dto: VideoCompressionConfirmDto) {
    this.requireScope(auth, Permission.AssetDelete);
    await this.requireAccess({ auth, permission: Permission.AssetDelete, ids: [id] });
    await this.owned(auth, id);
    const draft = await this.videoCompressionRepository.get(id);
    if (
      !draft ||
      draft.requestId !== dto.requestId ||
      draft.sourceChecksum !== dto.sourceChecksum ||
      !['ready', 'saving', 'committed'].includes(draft.status)
    ) {
      throw new ConflictException('Create and review a preview before replacing the original');
    }
    if (draft.status === 'ready') {
      const [checksum, stat, sourceChecksum] = await Promise.all([
        this.cryptoRepository.hashFile(draft.outputPath),
        this.storageRepository.stat(draft.outputPath),
        this.cryptoRepository.hashFile(draft.sourcePath),
      ]);
      if (
        sourceChecksum.toString('base64') !== draft.sourceChecksum ||
        checksum.toString('base64') !== draft.outputChecksum ||
        stat.size !== draft.compressedSize
      ) {
        throw new ConflictException('The preview changed. Create another preview');
      }
      await this.storageRepository.syncFile(draft.outputPath);
    }
    if (!(await this.videoCompressionRepository.commit(id, auth.user.id, dto.requestId, dto.sourceChecksum))) {
      throw new ConflictException('The original or preview changed. Nothing was replaced');
    }
    await this.jobRepository.queue({ name: JobName.VideoCompress, data: { id } });
    return this.get(auth, id);
  }

  @OnEvent({ name: 'AppBootstrap', workers: [ImmichWorker.Api] })
  async recover() {
    for (const { assetId } of await this.videoCompressionRepository.pending()) {
      await this.jobRepository.queue({ name: JobName.VideoCompress, data: { id: assetId } });
    }
  }

  @OnJob({ name: JobName.VideoCompress, queue: QueueName.VideoConversion })
  async run({ id }: JobOf<JobName.VideoCompress>): Promise<JobStatus> {
    const draft = await this.videoCompressionRepository.get(id);
    if (!draft) {
      return JobStatus.Skipped;
    }
    const asset = await this.assetRepository.getById(id);
    if (!asset) {
      return JobStatus.Skipped;
    }
    if (['saving', 'committed'].includes(draft.status)) {
      await this.finalize(id);
      return JobStatus.Success;
    }
    if (!['queued', 'processing'].includes(draft.status)) {
      await this.cleanup(id);
      return JobStatus.Skipped;
    }
    const producerId = this.cryptoRepository.randomUUID();
    const outputPath = compressionPath(draft.sourcePath, producerId);
    const cleanup = [
      ...draft.cleanup,
      ...(draft.status === 'processing' && outputPath !== draft.outputPath ? [draft.outputPath] : []),
    ];
    try {
      const started = await this.videoCompressionRepository.update(
        id,
        draft.requestId,
        { status: 'processing', producerId, outputPath, cleanup },
        ['queued', 'processing'],
      );
      if (!started) return JobStatus.Skipped;
      Object.assign(draft, { producerId, outputPath, cleanup });
      if (
        asset.checksum.toString('base64') !== draft.sourceChecksum ||
        asset.originalPath !== draft.sourcePath ||
        asset.deletedAt ||
        asset.isOffline ||
        asset.libraryId
      ) {
        throw new Error('The original changed or is unavailable. Create a new preview');
      }

      const info = await this.mediaRepository.probe(asset.originalPath);
      if (info.videoStreams.length === 0 || !Number.isFinite(info.format.duration) || info.format.duration <= 0) {
        throw new Error('The original has no readable video stream');
      }
      const { ffmpeg } = await this.getConfig({ withCache: false });
      const command = compressionCommand(info, draft.quality, ffmpeg);
      command.outputOptions.push('-metadata', `creation_time=${asset.fileCreatedAt.toISOString()}`);
      await this.mediaRepository.transcode(asset.originalPath, draft.outputPath, command);
      await this.storageRepository.utimes(draft.outputPath, new Date(), asset.fileModifiedAt);
      const [outputInfo, stat, checksum] = await Promise.all([
        this.mediaRepository.probe(draft.outputPath),
        this.storageRepository.stat(draft.outputPath),
        this.cryptoRepository.hashFile(draft.outputPath),
      ]);
      if (
        stat.size === 0 ||
        outputInfo.videoStreams.length === 0 ||
        outputInfo.audioStreams.length !== info.audioStreams.length ||
        Math.abs(outputInfo.format.duration - info.format.duration) >
          Math.max(1 / (info.videoStreams[0].frameRate || 1), 0.1)
      ) {
        throw new Error('The compressed video is incomplete. The original was preserved');
      }
      const video = outputInfo.videoStreams[0];
      const outputPackets = video.timeBase
        ? await this.mediaRepository.probePackets(draft.outputPath, video.index)
        : undefined;
      const saved = await this.videoCompressionRepository.update(
        id,
        draft.requestId,
        {
          status: 'ready',
          compressedSize: stat.size,
          outputChecksum: checksum.toString('base64'),
          outputInfo,
          outputPackets: outputPackets ?? undefined,
        },
        ['processing'],
        producerId,
      );
      if (!saved) {
        await this.storageRepository.unlink(draft.outputPath);
      }
    } catch (error) {
      this.logger.warn(`Video compression failed for ${id}: ${String(error)}`);
      await this.videoCompressionRepository.update(
        id,
        draft.requestId,
        {
          status: 'failed',
          error: 'Unable to prepare this preview. The original was preserved. You can try again.',
          cleanup: [...draft.cleanup, draft.outputPath],
        },
        ['queued', 'processing'],
        producerId,
      );
    }
    await this.cleanup(id);
    return JobStatus.Success;
  }

  private async finalize(id: string) {
    const draft = await this.videoCompressionRepository.get(id);
    if (!draft || !['saving', 'committed'].includes(draft.status) || !draft.outputInfo) {
      return;
    }
    if (!draft.finalized) {
      const current = await this.assetRepository.getById(id, { exifInfo: true });
      if (!current || current.checksum.toString('base64') !== draft.outputChecksum) {
        throw new Error('The saved video changed before finalization; original cleanup is deferred');
      }
      const { format, videoStreams, audioStreams } = draft.outputInfo;
      const { width, height, rotation, frameRate: _, ...video } = videoStreams[0];
      const packets = draft.outputPackets;
      await this.assetRepository.upsertExif({
        exif: {
          ...current.exifInfo,
          assetId: id,
          fileSizeInByte: draft.compressedSize,
          exifImageWidth: width,
          exifImageHeight: height,
          orientation: rotation === 0 ? '1' : undefined,
        },
        video: {
          ...video,
          assetId: id,
          codecName: video.codecName ?? 'h264',
          timeBase: video.timeBase ?? 1,
          formatName: format.formatName ?? 'mp4',
          formatLongName: format.formatLongName ?? 'MP4',
        },
        audio: audioStreams[0]
          ? { ...audioStreams[0], codecName: audioStreams[0].codecName ?? 'aac', assetId: id }
          : undefined,
        keyframes: packets
          ? {
              assetId: id,
              totalDuration: packets.totalDuration,
              packetCount: packets.packetCount,
              outputFrames: packets.outputFrames,
              pts: packets.keyframePts,
              accDuration: packets.keyframeAccDuration,
              ownDuration: packets.keyframeOwnDuration,
            }
          : undefined,
        lockedPropertiesBehavior: 'skip',
      });
      await this.jobRepository.queue({ name: JobName.Transcription, data: { id } });
      await this.videoCompressionRepository.update(id, draft.requestId, { finalized: true }, ['saving', 'committed']);
    }
    await this.cleanup(id);
    await this.videoCompressionRepository.update(id, draft.requestId, { status: 'committed' }, ['saving']);
  }

  private async cleanup(id: string) {
    const draft = await this.videoCompressionRepository.get(id);
    if (!draft) {
      return;
    }
    for (const path of new Set(draft.cleanup)) {
      if (!(await this.videoCompressionRepository.isOriginal(path))) {
        await this.storageRepository.unlink(path);
      }
    }
    await this.videoCompressionRepository.update(
      id,
      draft.requestId,
      { cleanup: [] },
      [draft.status],
      draft.producerId,
    );
  }
}
