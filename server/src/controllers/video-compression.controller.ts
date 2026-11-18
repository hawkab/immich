import { Body, Controller, Get, Next, Param, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { NextFunction, Response } from 'express';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import {
  VideoCompressionConfirmDto,
  VideoCompressionCreateDto,
  VideoCompressionRequestDto,
  VideoCompressionResponseDto,
} from 'src/dtos/video-compression.dto.js';
import { ApiTag, Permission, RouteKey } from 'src/enum.js';
import { Auth, Authenticated, FileResponse } from 'src/middleware/auth.guard.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { VideoCompressionService } from 'src/services/video-compression.service.js';
import { sendFile } from 'src/utils/file.js';
import { UUIDParamDto } from 'src/validation.js';

@ApiTags(ApiTag.Assets)
@Controller(RouteKey.Asset)
export class VideoCompressionController {
  constructor(
    private service: VideoCompressionService,
    private logger: LoggingRepository,
  ) {}

  @Get(':id/compression')
  @Authenticated({ permission: Permission.AssetEditCreate })
  @Endpoint({
    summary: 'Get video compression preview',
    description: 'Read the current editable compression draft without changing the original.',
    history: new HistoryBuilder().added('v3.4.1'),
  })
  getVideoCompression(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<VideoCompressionResponseDto> {
    return this.service.get(auth, id);
  }

  @Post(':id/compression')
  @Authenticated({ permission: Permission.AssetEditCreate })
  @Endpoint({
    summary: 'Prepare video compression preview',
    description: 'Encode a full preview without replacing the original.',
    history: new HistoryBuilder().added('v3.4.1'),
  })
  createVideoCompression(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: VideoCompressionCreateDto,
  ): Promise<VideoCompressionResponseDto> {
    return this.service.create(auth, id, dto);
  }

  @Get(':id/compression/preview')
  @FileResponse()
  @Authenticated({ permission: Permission.AssetDownload })
  @Endpoint({
    summary: 'Play compressed video preview',
    description: 'Stream the ready preview bound to this original and request.',
    history: new HistoryBuilder().added('v3.4.1'),
  })
  async playVideoCompression(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Query() dto: VideoCompressionRequestDto,
    @Res() res: Response,
    @Next() next: NextFunction,
  ) {
    await sendFile(res, next, () => this.service.preview(auth, id, dto), this.logger);
  }

  @Post(':id/compression/discard')
  @Authenticated({ permission: Permission.AssetEditCreate })
  @Endpoint({
    summary: 'Discard video compression preview',
    description: 'Cancel a draft and remove its temporary output while preserving the original.',
    history: new HistoryBuilder().added('v3.4.1'),
  })
  discardVideoCompression(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: VideoCompressionRequestDto,
  ): Promise<VideoCompressionResponseDto> {
    return this.service.discard(auth, id, dto);
  }

  @Post(':id/compression/confirm')
  @Authenticated({ permission: Permission.AssetEditCreate })
  @Endpoint({
    summary: 'Replace original with compressed video',
    description: 'Irreversibly replace the original with the explicitly confirmed preview.',
    history: new HistoryBuilder().added('v3.4.1'),
  })
  confirmVideoCompression(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: VideoCompressionConfirmDto,
  ): Promise<VideoCompressionResponseDto> {
    return this.service.confirm(auth, id, dto);
  }
}
