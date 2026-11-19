import { Column, CreateDateColumn, ForeignKeyColumn, PrimaryColumn, Table, Unique, type Generated, type Timestamp } from '@immich/sql-tools';
import { UserTable } from 'src/schema/tables/user.table.js';

@Table('short_link')
@Unique({name:'short_link_user_target_uq',columns:['userId','type','targetId']})
export class ShortLinkTable {
  @PrimaryColumn({type:'text'}) code!:string;
  @ForeignKeyColumn(() => UserTable, {onDelete:'CASCADE',onUpdate:'CASCADE'}) userId!:string;
  @Column({type:'text'}) type!:'asset'|'album'|'person';
  @Column({type:'uuid'}) targetId!:string;
  @CreateDateColumn() createdAt!:Generated<Timestamp>;
}
