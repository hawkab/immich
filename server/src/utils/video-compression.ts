import { dirname, join } from 'node:path';
import { ConfigFFmpegDto } from 'src/dtos/config.dto.js';
import { ToneMapping, TranscodeHardwareAcceleration, TranscodeTarget, VideoCodec } from 'src/enum.js';
import type { VideoInfo, VideoPacketInfo } from 'src/types.js';
import { BaseConfig } from 'src/utils/media.js';

export type CompressionDraft = {
  requestId: string;
  actorId: string;
  sourceChecksum: string;
  sourcePath: string;
  outputPath: string;
  quality: number;
  status: 'queued' | 'processing' | 'ready' | 'failed' | 'saving' | 'committed' | 'discarded';
  originalSize: number;
  compressedSize?: number;
  outputChecksum?: string;
  producerId?: string;
  outputInfo?: VideoInfo;
  outputPackets?: VideoPacketInfo;
  error?: string;
  cleanup: string[];
  finalized?: boolean;
};

export const compressionPath = (source: string, producerId: string) =>
  join(dirname(source), `compression-${producerId}.mp4`);

export const compressionCommand = (info: VideoInfo, quality: number, config: ConfigFFmpegDto) => {
  const video = info.videoStreams[0];
  const command = BaseConfig.create(
    {
      ...config,
      accel: TranscodeHardwareAcceleration.Disabled,
      targetVideoCodec: VideoCodec.H264,
      targetResolution: String(Math.min(video.width, video.height)),
      maxBitrate: '0',
      crf: Math.round(((100 - quality) * 51) / 100),
      tonemap: ToneMapping.Hable,
      preset: 'medium',
      twoPass: false,
    },
    { dri: [], mali: false },
  ).getCommand(TranscodeTarget.Video, video, info.audioStreams[0], info.format);
  command.inputOptions.push('-xerror');
  command.outputOptions = command.outputOptions.filter(
    (option, index, options) => option !== '-map' && options[index - 1] !== '-map',
  );
  command.outputOptions.push('-map', `0:${video.index}`, '-map', '0:a?', '-map_metadata', '0', '-map_chapters', '0');
  if (info.audioStreams.some((audio) => !['aac', 'mp3', 'alac'].includes(audio.codecName ?? ''))) {
    command.outputOptions.push('-c:a', 'aac');
  }
  return command;
};

export const compressionResponse = (value: CompressionDraft) => ({
  requestId: value.requestId,
  sourceChecksum: value.sourceChecksum,
  quality: value.quality,
  status: value.status,
  originalSize: value.originalSize,
  compressedSize: value.compressedSize,
  error: value.error,
});
