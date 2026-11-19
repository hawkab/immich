import { Injectable } from '@nestjs/common';
import { type Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DB } from 'src/schema/index.js';

@Injectable()
export class ShortLinkRepository {
  constructor(@InjectKysely() private db:Kysely<DB>) {}
  create(row:{code:string;userId:string;type:'asset'|'album'|'person';targetId:string}) {
    return this.db.insertInto('short_link').values(row).onConflict(oc=>oc.columns(['userId','type','targetId']).doUpdateSet({targetId:row.targetId})).returningAll().executeTakeFirstOrThrow();
  }
  get(code:string) { return this.db.selectFrom('short_link').selectAll().where('code','=',code).executeTakeFirst(); }
  getAll(userId:string) { return this.db.selectFrom('short_link').selectAll().where('userId','=',userId).orderBy('createdAt','desc').execute(); }
  remove(code:string,userId:string) { return this.db.deleteFrom('short_link').where('code','=',code).where('userId','=',userId).execute(); }
}
