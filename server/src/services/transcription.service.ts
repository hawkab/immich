import { Injectable } from '@nestjs/common';
import { OnEvent, OnJob } from 'src/decorators.js';
import { AssetType, ImmichWorker, JobName, JobStatus, QueueName } from 'src/enum.js';
import type { ArgOf } from 'src/repositories/event.repository.js';
import { BaseService } from 'src/services/base.service.js';
import type { JobOf } from 'src/types.js';
import {
  TRANSCRIPT_CHUNK_SECONDS,
  TRANSCRIPT_KEY,
  TranscriptionProviderError,
  isTranscript,
  transcriptionIdentity,
  type Transcript,
} from 'src/utils/transcription.js';

@Injectable()
export class TranscriptionService extends BaseService {
  private recoveryInterval?: ReturnType<typeof setInterval>;

  @OnEvent({ name: 'ConfigInit', workers: [ImmichWorker.Api] })
  async onConfigInit() {
    await this.schedule();
    this.recoveryInterval = setInterval(
      () => void this.schedule().catch((error) => this.logger.warn(`Transcription recovery: ${String(error)}`)),
      300_000,
    );
  }

  @OnEvent({ name: 'ConfigUpdate', workers: [ImmichWorker.Api], server: true })
  onConfigUpdate() {
    return this.schedule();
  }

  @OnEvent({ name: 'AppShutdown' })
  onShutdown() {
    clearInterval(this.recoveryInterval);
  }

  private async schedule() {
    const { machineLearning } = await this.getConfig({ withCache: false });
    if (machineLearning.transcription.enabled) {
      await this.jobRepository.queue({ name: JobName.TranscriptionQueueAll, data: {} });
    }
  }

  @OnEvent({ name: 'AssetMetadataExtracted', workers: [ImmichWorker.Microservices] })
  async onAssetMetadata({ assetId }: ArgOf<'AssetMetadataExtracted'>) {
    const { machineLearning } = await this.getConfig({ withCache: false });
    if (machineLearning.transcription.enabled) {
      await this.jobRepository.queue({ name: JobName.Transcription, data: { id: assetId } });
    }
  }

  @OnJob({ name: JobName.TranscriptionQueueAll, queue: QueueName.Transcription })
  async handleQueue({ force }: JobOf<JobName.TranscriptionQueueAll>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    if (!machineLearning.transcription.enabled) {
      return JobStatus.Skipped;
    }
    for await (const asset of this.assetJobRepository.streamForTranscription(
      transcriptionIdentity(machineLearning.transcription),
      force,
    )) {
      await this.jobRepository.queue({ name: JobName.Transcription, data: { id: asset.id, force } });
    }
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.Transcription, queue: QueueName.Transcription })
  async handleTranscription({ id, force }: JobOf<JobName.Transcription>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    const config = machineLearning.transcription;
    if (!config.enabled) {
      return JobStatus.Skipped;
    }
    const asset = await this.assetRepository.getById(id);
    if (!asset || asset.type !== AssetType.Video || asset.deletedAt || asset.isOffline) {
      return JobStatus.Skipped;
    }
    const sourceChecksum = asset.checksum.toString('base64');
    const configuration = transcriptionIdentity(config);
    const saved = await this.assetRepository.getMetadataByKey(id, TRANSCRIPT_KEY);
    let transcript: Transcript | undefined = isTranscript(saved?.value) ? saved.value : undefined;
    if (force || transcript?.sourceChecksum !== sourceChecksum || transcript?.configuration !== configuration) {
      transcript = undefined;
    }
    if (transcript && ['complete', 'no_audio'].includes(transcript.status)) {
      return JobStatus.Skipped;
    }
    const media = await this.mediaRepository.probe(asset.originalPath);
    const duration = media.format.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('Video duration is unavailable');
    }
    transcript ??= {
      schemaVersion: 1,
      sourceChecksum,
      configuration,
      model: config.model,
      language: config.language,
      status: 'processing',
      duration,
      nextStart: 0,
      segments: [],
      text: '',
    };
    if (media.audioStreams.length === 0) {
      transcript.status = 'no_audio';
      await this.assetRepository.upsertMetadata(id, [{ key: TRANSCRIPT_KEY, value: transcript }]);
      return JobStatus.Success;
    }
    await this.assetRepository.upsertMetadata(id, [{ key: TRANSCRIPT_KEY, value: transcript }]);
    while (transcript.nextStart < duration) {
      const snapshot = await this.getConfig({ withCache: false });
      const currentConfig = snapshot.machineLearning.transcription;
      if (!currentConfig.enabled || transcriptionIdentity(currentConfig) !== configuration) {
        return JobStatus.Skipped;
      }
      const currentAsset = await this.assetRepository.getById(id);
      if (!currentAsset || currentAsset.deletedAt || currentAsset.checksum.toString('base64') !== sourceChecksum) {
        return JobStatus.Skipped;
      }
      const start = transcript.nextStart;
      const end = Math.min(duration, start + TRANSCRIPT_CHUNK_SECONDS);
      const audio = await this.mediaRepository.extractSpeech(asset.originalPath, start, end - start);
      let result: { text: string };
      try {
        result = await this.machineLearningRepository.transcribe(
          audio,
          config,
          `${configuration}-${sourceChecksum}-${start}-${transcript.requestAttempt ?? 0}`,
        );
      } catch (error) {
        if (error instanceof TranscriptionProviderError && (error.status >= 500 || error.status === 429)) {
          transcript.requestAttempt = (transcript.requestAttempt ?? 0) + 1;
          transcript.lastError = error.message;
          await this.assetRepository.upsertMetadata(id, [{ key: TRANSCRIPT_KEY, value: transcript }]);
        }
        throw error;
      }
      transcript.requestAttempt = 0;
      delete transcript.lastError;
      transcript.segments.push({ start, end, text: result.text });
      transcript.nextStart = end;
      transcript.text = transcript.segments
        .map((segment) => segment.text)
        .filter(Boolean)
        .join(' ');
      transcript.status = end >= duration ? 'complete' : 'processing';
      await this.assetRepository.upsertMetadata(id, [{ key: TRANSCRIPT_KEY, value: transcript }]);
    }
    return JobStatus.Success;
  }
}
