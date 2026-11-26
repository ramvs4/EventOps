import {getPool} from './db.server';
import {withEventSetup} from './event.server';
import type {ParticipantData,Event,Team} from '../lib/participant-types';
import type {SessionUser} from '../lib/auth-types';
import type {PoolClient} from 'pg';
type Action={kind:string;eventId?:number|undefined;name?:string|undefined};
export function participantData(user:SessionUser,action?:Action):Promise<ParticipantData>{return withEventSetup(async()=>{
const db=await getPool().connect();try{await db.query('begin');await db.query('select pg_advisory_xact_lock(727275)');if(action)await mutate(db,user.id,action);
const events=(await db.query<Event>(`select id,name as title,category,starts_at::text as date,venue as location,image_url as image,description,capacity,published,registration_open as "registrationOpen",team_enabled as "teamEnabled" from events e where published or exists(select 1 from event_registrations r where r.event_id=e.id and r.user_id=$1) or exists(select 1 from event_team_members m where m.event_id=e.id and m.user_id=$1) order by starts_at,id`,[user.id])).rows;
const tickets=(await db.query<{eventId:number;reference:string}>('select event_id as "eventId",ticket_ref as reference from event_registrations where user_id=$1',[user.id])).rows;
const teams=(await db.query<Team>(`select t.id,t.name,t.event_id as "eventId",array_agg(u.name order by u.id) as members,bool_or(m.user_id=$1) as mine from event_teams t join events e on e.id=t.event_id join event_team_members m on m.team_id=t.id join users u on u.id=m.user_id group by t.id,e.published,e.team_enabled having (e.published and e.team_enabled) or bool_or(m.user_id=$1)`,[user.id])).rows;
const announcements=(await db.query<{title:string;date:string;body:string}>("select title,to_char(created_at,'MON DD, YYYY') as date,body from participant_announcements order by id desc")).rows;
await db.query('commit');return {events,tickets,registrations:tickets.map(t=>t.eventId),teams,announcements,user:{name:user.name,email:user.email}};}catch(e){await db.query('rollback');throw e}finally{db.release()}})}
async function mutate(db:PoolClient,user:number,a:Action){if(!a.eventId)throw Error('Select an event');const id=a.eventId;
if(a.kind==='cancel'){await db.query('delete from event_registrations where user_id=$1 and event_id=$2',[user,id]);return;}
const e=(await db.query<{published:boolean;registration_open:boolean;team_enabled:boolean;capacity:number;future:boolean}>('select published,registration_open,team_enabled,capacity,starts_at>now() as future from events where id=$1 for update',[id])).rows[0];
if(a.kind==='register'){if(!e?.published||!e.registration_open||!e.future)throw Error('Registration closed');const r=await db.query('insert into event_registrations(user_id,event_id) select $1,$2 where (select count(*) from event_registrations where event_id=$2)<$3 on conflict do nothing',[user,id,e.capacity]);if(!r.rowCount)throw Error('Already registered or event full');return;}
const name=a.name?.trim();if(!name)throw Error('Team name required');
if(a.kind!=='leave'){if(!e?.published||!e.team_enabled||!e.future)throw Error('Teams unavailable');if((await db.query('select 1 from event_team_members where event_id=$1 and user_id=$2',[id,user])).rowCount)throw Error('You already belong to a team for this event');}
if(a.kind==='create'){const t=await db.query<{id:number}>('insert into event_teams(event_id,name) values($1,$2) on conflict do nothing returning id',[id,name]);if(!t.rows[0])throw Error('Team name already exists');await db.query('insert into event_team_members values($1,$2,$3)',[t.rows[0].id,id,user]);return;}
const t=(await db.query<{id:number}>('select id from event_teams where event_id=$1 and lower(name)=lower($2)',[id,name])).rows[0];if(!t)throw Error('Team not found');
if(a.kind==='join'){const r=await db.query('insert into event_team_members select $1,$2,$3 where (select count(*) from event_team_members where team_id=$1)<4 on conflict do nothing',[t.id,id,user]);if(!r.rowCount)throw Error('Team full or already joined');}
if(a.kind==='leave'){await db.query('delete from event_team_members where team_id=$1 and user_id=$2',[t.id,user]);await db.query('delete from event_teams where id=$1 and not exists(select 1 from event_team_members where team_id=$1)',[t.id]);}}
