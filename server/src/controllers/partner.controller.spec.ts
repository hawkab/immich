import { UnauthorizedException } from '@nestjs/common';
import request from 'supertest';
import { PartnerController } from 'src/controllers/partner.controller.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PartnerService } from 'src/services/partner.service.js';
import { errorDto } from 'test/medium/responses.js';
import { newUuid } from 'test/small.factory.js';
import { ControllerContext, automock, controllerSetup, mockBaseService } from 'test/utils.js';

describe(PartnerController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(PartnerService);

  beforeAll(async () => {
    ctx = await controllerSetup(PartnerController, [
      { provide: PartnerService, useValue: service },
      { provide: LoggingRepository, useValue: automock(LoggingRepository, { strict: false }) },
    ]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  describe('GET /partners', () => {
    it(`should require a direction`, async () => {
      const { status, body } = await request(ctx.getHttpServer()).get(`/partners`).set('Authorization', `Bearer token`);
      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([
          { path: ['direction'], message: expect.stringContaining('Invalid option: expected one of') },
        ]),
      );
    });

    it(`should require direction to be an enum`, async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .get(`/partners`)
        .query({ direction: 'invalid' })
        .set('Authorization', `Bearer token`);
      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([
          { path: ['direction'], message: expect.stringContaining('Invalid option: expected one of') },
        ]),
      );
    });
  });

  describe('PUT /partners/:id/permissions', () => {
    it.each([{}, { canDelete: 'yes' }, { canDelete: null }])('rejects an invalid grant: %j', async (body) => {
      const response = await request(ctx.getHttpServer())
        .put(`/partners/${newUuid()}/permissions`)
        .set('Authorization', 'Bearer token')
        .send(body);
      expect(response.status).toBe(400);
      expect(service.updatePermissions).not.toHaveBeenCalled();
    });

    it('accepts an explicit boolean grant', async () => {
      const id = newUuid();
      service.updatePermissions.mockResolvedValue({} as never);
      const response = await request(ctx.getHttpServer())
        .put(`/partners/${id}/permissions`)
        .set('Authorization', 'Bearer token')
        .send({ canDelete: false });
      expect(response.status).toBe(200);
      expect(service.updatePermissions).toHaveBeenCalledWith(undefined, id, { canDelete: false });
    });
  });

  describe('POST /partners', () => {
    it(`should require sharedWithId to be a uuid`, async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .post(`/partners`)
        .send({ sharedWithId: 'invalid' })
        .set('Authorization', `Bearer token`);
      expect(status).toBe(400);
      expect(body).toEqual(errorDto.validationError([{ path: ['sharedWithId'], message: 'Invalid UUID' }]));
    });
  });

  describe('PUT /partners/:id', () => {
    it(`should require id to be a uuid`, async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .put(`/partners/invalid`)
        .send({ inTimeline: true })
        .set('Authorization', `Bearer token`);
      expect(status).toBe(400);
      expect(body).toEqual(errorDto.validationError([{ path: ['id'], message: 'Invalid UUID' }]));
    });
  });

  describe('PUT /partners/:id/permissions', () => {
    const id = '00000000-0000-4000-a000-000000000001';

    it('requires authentication', async () => {
      ctx.authenticate.mockRejectedValue(new UnauthorizedException());
      const { status } = await request(ctx.getHttpServer()).put(`/partners/${id}/permissions`).send({ canEdit: true });
      expect(status).toBe(401);
      expect(service.updatePermissions).not.toHaveBeenCalled();
    });

    it.each([{}, { canEdit: 'true' }, { canEdit: null }])('requires a boolean canEdit (%j)', async (dto) => {
      const { status } = await request(ctx.getHttpServer())
        .put(`/partners/${id}/permissions`)
        .set('Authorization', 'Bearer token')
        .send(dto);
      expect(status).toBe(400);
      expect(service.updatePermissions).not.toHaveBeenCalled();
    });

    it('rejects a malformed recipient ID', async () => {
      const { status } = await request(ctx.getHttpServer())
        .put('/partners/invalid/permissions')
        .set('Authorization', 'Bearer token')
        .send({ canEdit: true });
      expect(status).toBe(400);
      expect(service.updatePermissions).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /partners/:id', () => {
    it(`should require id to be a uuid`, async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .delete(`/partners/invalid`)
        .set('Authorization', `Bearer token`);
      expect(status).toBe(400);
      expect(body).toEqual(errorDto.validationError([{ path: ['id'], message: 'Invalid UUID' }]));
    });
  });
});
