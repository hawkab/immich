import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import type { ShortLinkCreateDto, ShortLinkResponseDto } from 'src/dtos/short-link.dto.js';
import { Permission } from 'src/enum.js';
import { BaseService } from 'src/services/base.service.js';
import { isGranted } from 'src/utils/access.js';

@Injectable()
export class ShortLinkService extends BaseService {
  private async target(auth: AuthDto, type: ShortLinkCreateDto['type'], id: string) {
    if (auth.sharedLink) throw new ForbiddenException();
    const permission =
      type === 'asset' ? Permission.AssetRead : type === 'album' ? Permission.AlbumRead : Permission.PersonRead;
    if (auth.apiKey && !isGranted({ requested: [permission], current: auth.apiKey.permissions }))
      throw new ForbiddenException();
    await this.requireAccess({ auth, permission, ids: [id] });
    return `/${type === 'asset' ? 'photos' : type === 'album' ? 'albums' : 'people'}/${id}`;
  }
  async create(auth: AuthDto, dto: ShortLinkCreateDto): Promise<ShortLinkResponseDto> {
    const path = await this.target(auth, dto.type, dto.id);
    const row = await this.shortLinkRepository.create({
      code: this.cryptoRepository.randomBytes(12).toString('base64url'),
      userId: auth.user.id,
      type: dto.type,
      targetId: dto.id,
    });
    return { code: row.code, path };
  }
  async get(auth: AuthDto, code: string): Promise<ShortLinkResponseDto> {
    const row = await this.shortLinkRepository.get(code);
    if (!row) throw new NotFoundException();
    return { code: row.code, path: await this.target(auth, row.type, row.targetId) };
  }
  async getAll(auth: AuthDto): Promise<ShortLinkResponseDto[]> {
    const rows = await this.shortLinkRepository.getAll(auth.user.id);
    return rows.map((row) => ({
      code: row.code,
      path: `/${row.type === 'asset' ? 'photos' : row.type === 'album' ? 'albums' : 'people'}/${row.targetId}`,
    }));
  }
  async remove(auth: AuthDto, code: string) {
    await this.shortLinkRepository.remove(code, auth.user.id);
  }
}
