import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ShortLinkService } from 'src/services/short-link.service.js';
import { Permission } from 'src/enum.js';
import { newTestService } from 'test/utils.js';
import { factory } from 'test/small.factory.js';

it('creates a stable typed alias after native object access checks',async()=>{
 const {sut,mocks}=newTestService(ShortLinkService);const auth=factory.auth();const id=crypto.randomUUID();
 mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([id]));
 mocks.crypto.randomBytes.mockReturnValue(Buffer.alloc(12,1));
 mocks.shortLink.create.mockResolvedValue({code:'AQEBAQEBAQEBAQEB',type:'asset',targetId:id,userId:auth.user.id,createdAt:new Date()});
 expect(await sut.create(auth,{type:'asset',id})).toEqual({code:'AQEBAQEBAQEBAQEB',path:`/photos/${id}`});
 expect(mocks.shortLink.create).toHaveBeenCalledWith(expect.objectContaining({type:'asset',targetId:id,userId:auth.user.id}));
});
it('does not turn a short link into a public asset grant',async()=>{
 const {sut,mocks}=newTestService(ShortLinkService);const auth=factory.auth();const id=crypto.randomUUID();
 mocks.shortLink.get.mockResolvedValue({code:'abcdefghijklmnop',type:'asset',targetId:id,userId:crypto.randomUUID(),createdAt:new Date()});
 mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
 mocks.access.asset.checkPartnerAccess.mockResolvedValue(new Set());
 mocks.access.asset.checkAlbumAccess.mockResolvedValue(new Set());
 await expect(sut.get(auth,'abcdefghijklmnop')).rejects.toThrow();
});
it('returns no target when the alias has been revoked',async()=>{
 const {sut,mocks}=newTestService(ShortLinkService);mocks.shortLink.get.mockResolvedValue(undefined);
 await expect(sut.get(factory.auth(),'abcdefghijklmnop')).rejects.toBeInstanceOf(NotFoundException);
});
it('requires the resource scope as well as the shortlink scope for API keys',async()=>{
 const {sut,mocks}=newTestService(ShortLinkService);const auth=factory.auth();const id=crypto.randomUUID();
 auth.apiKey={permissions:[Permission.ShortLinkRead]} as never;
 mocks.shortLink.get.mockResolvedValue({code:'abcdefghijklmnop',type:'asset',targetId:id,userId:auth.user.id,createdAt:new Date()});
 await expect(sut.get(auth,'abcdefghijklmnop')).rejects.toBeInstanceOf(ForbiddenException);
});
