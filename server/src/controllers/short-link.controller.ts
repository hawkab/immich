import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { ShortLinkCodeDto, ShortLinkCreateDto, ShortLinkResponseDto } from 'src/dtos/short-link.dto.js';
import { ApiTag, Permission } from 'src/enum.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';
import { ShortLinkService } from 'src/services/short-link.service.js';

@ApiTags(ApiTag.Assets)
@Controller('short-links')
export class ShortLinkController {
  constructor(private service: ShortLinkService) {}
  @Post()
  @Authenticated({ permission: Permission.ShortLinkCreate })
  @Endpoint({
    summary: 'Create a private short link',
    description: 'Create a stable alias without granting access to its target.',
    history: new HistoryBuilder().added('v3.4.1'),
  })
  createShortLink(@Auth() auth: AuthDto, @Body() dto: ShortLinkCreateDto): Promise<ShortLinkResponseDto> {
    return this.service.create(auth, dto);
  }
  @Get()
  @Authenticated({ permission: Permission.ShortLinkRead })
  @Endpoint({
    summary: 'List your private short links',
    description: 'List aliases created by the authenticated user.',
    history: new HistoryBuilder().added('v3.4.1'),
  })
  getShortLinks(@Auth() auth: AuthDto): Promise<ShortLinkResponseDto[]> {
    return this.service.getAll(auth);
  }
  @Get(':code')
  @Authenticated({ permission: Permission.ShortLinkRead })
  @Endpoint({
    summary: 'Resolve a private short link',
    description: 'Resolve an alias only after checking current access to its target.',
    history: new HistoryBuilder().added('v3.4.1'),
  })
  getShortLink(@Auth() auth: AuthDto, @Param() { code }: ShortLinkCodeDto): Promise<ShortLinkResponseDto> {
    return this.service.get(auth, code);
  }
  @Delete(':code')
  @Authenticated({ permission: Permission.ShortLinkDelete })
  @Endpoint({
    summary: 'Revoke your private short link',
    description: 'Delete an alias owned by the authenticated user without changing its target.',
    history: new HistoryBuilder().added('v3.4.1'),
  })
  deleteShortLink(@Auth() auth: AuthDto, @Param() { code }: ShortLinkCodeDto): Promise<void> {
    return this.service.remove(auth, code);
  }
}
