import { UnauthorizedException } from '@nestjs/common';
import request from 'supertest';
import { ShortLinkController } from 'src/controllers/short-link.controller.js';
import { Permission } from 'src/enum.js';
import { ShortLinkService } from 'src/services/short-link.service.js';
import { controllerSetup, mockBaseService, type ControllerContext } from 'test/utils.js';

const service = mockBaseService(ShortLinkService);
let ctx: ControllerContext;
beforeAll(async () => {
  ctx = await controllerSetup(ShortLinkController, [{ provide: ShortLinkService, useValue: service }]);
  return () => ctx.close();
});
beforeEach(() => {
  ctx.reset();
  service.resetAllMocks();
});
it('requires the shortlink permission on resolution', async () => {
  service.get.mockResolvedValue({ code: 'abcdefghijklmnop', path: '/photos/42' });
  await request(ctx.getHttpServer()).get('/short-links/abcdefghijklmnop').expect(200);
  expect(ctx.authenticate).toHaveBeenCalledWith(
    expect.objectContaining({ metadata: expect.objectContaining({ permission: Permission.ShortLinkRead }) }),
  );
});
it('validates an opaque code before invoking the service', async () => {
  await request(ctx.getHttpServer()).get('/short-links/invalid').expect(400);
  expect(service.get).not.toHaveBeenCalled();
});
it('propagates rejection by native authentication', async () => {
  ctx.authenticate.mockRejectedValue(new UnauthorizedException());
  await request(ctx.getHttpServer()).get('/short-links/abcdefghijklmnop').expect(401);
});
