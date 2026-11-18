import { Injectable } from '@nestjs/common';
import { OnEvent } from 'src/decorators.js';
import { JobName, JobStatus } from 'src/enum.js';
import type { ArgOf } from 'src/repositories/event.repository.js';
import { BaseService } from 'src/services/base.service.js';

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const assetJobs = new Set<JobName>([
  JobName.AssetGenerateThumbnails,
  JobName.AssetEditThumbnailGeneration,
  JobName.AssetEncodeVideo,
  JobName.AssetDetectFaces,
  JobName.AssetDetectDuplicates,
  JobName.SmartSearch,
  JobName.Ocr,
]);

@Injectable()
export class AutoAlbumEventService extends BaseService {
  @OnEvent({ name: 'AssetCreate' })
  onAssetCreate({ asset }: ArgOf<'AssetCreate'>) {
    return this.publish(asset.id, 'upload');
  }

  @OnEvent({ name: 'AssetMetadataExtracted' })
  onAssetMetadataExtracted({ assetId }: ArgOf<'AssetMetadataExtracted'>) {
    return this.publish(assetId, 'metadata');
  }

  @OnEvent({ name: 'AssetSceneMetadataUpdated' })
  onSceneMetadataUpdated({ assetId }: ArgOf<'AssetSceneMetadataUpdated'>) {
    return this.publish(assetId, 'scene-metadata');
  }

  @OnEvent({ name: 'JobSuccess' })
  async onJobSuccess({ job, response }: ArgOf<'JobSuccess'>) {
    try {
      if (!this.configRepository.getEnv().memoryEventsDir || response !== JobStatus.Success) {
        return;
      }
      if (job.name === JobName.FacialRecognition) {
        const face = await this.personRepository.getAssetIdForFace(job.data.id);
        if (face) {
          await this.publish(face.assetId, job.name);
        }
        return;
      }
      if (assetJobs.has(job.name) && job.data && 'id' in job.data && typeof job.data.id === 'string') {
        await this.publish(job.data.id, job.name);
      }
    } catch (error) {
      this.logger.warn(`Unable to queue a memory event after ${job.name}: ${String(error)}`);
    }
  }

  private async publish(assetId: string, reason: string) {
    try {
      const directory = this.configRepository.getEnv().memoryEventsDir;
      if (!directory || !uuid.test(assetId)) {
        return;
      }
      const asset = await this.assetRepository.getById(assetId);
      if (!asset || asset.id !== assetId || !uuid.test(asset.ownerId)) {
        return;
      }
      const payload = Buffer.from(
        JSON.stringify({
          ownerId: asset.ownerId,
          assetId: asset.id,
          reason,
          timestamp: new Date().toISOString(),
        }),
      );
      await this.storageRepository.writeMemoryEvent(directory, `${asset.ownerId}.${asset.id}.json`, payload);
    } catch (error) {
      this.logger.warn(`Unable to queue memory event for asset ${assetId}: ${String(error)}`);
    }
  }
}
