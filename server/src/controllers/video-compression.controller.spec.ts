import request from 'supertest';
import { VideoCompressionController } from 'src/controllers/video-compression.controller.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { VideoCompressionService } from 'src/services/video-compression.service.js';
import { factory } from 'test/small.factory.js';
import { controllerSetup, mockBaseService, type ControllerContext } from 'test/utils.js';

describe(VideoCompressionController.name, () => {
  const service = mockBaseService(VideoCompressionService);
  let ctx: ControllerContext;
  const dto = { requestId: factory.uuid(), sourceChecksum: Buffer.alloc(20).toString('base64'), quality: 55 };
  beforeAll(async () => {
    ctx = await controllerSetup(VideoCompressionController, [
      { provide: VideoCompressionService, useValue: service },
      { provide: LoggingRepository, useValue: LoggingRepository.create() },
    ]);
    return () => ctx.close();
  });
  beforeEach(() => {
    ctx.reset();
    service.resetAllMocks();
  });

  it.each([-1, 101, 0.5, '55', null])('rejects an invalid quality %s', async (quality) => {
    const result = await request(ctx.getHttpServer())
      .post(`/assets/${factory.uuid()}/compression`)
      .send({ ...dto, quality });
    expect(result.status).toBe(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('requires an explicit irreversible confirmation', async () => {
    const result = await request(ctx.getHttpServer()).post(`/assets/${factory.uuid()}/compression/confirm`).send(dto);
    expect(result.status).toBe(400);
    expect(service.confirm).not.toHaveBeenCalled();
  });

  it('binds preview playback to a validated request and checksum', async () => {
    const result = await request(ctx.getHttpServer()).get(
      `/assets/${factory.uuid()}/compression/preview?requestId=wrong&sourceChecksum=wrong`,
    );
    expect(result.status).toBe(400);
    expect(service.preview).not.toHaveBeenCalled();
  });
});
