import {readFileSync,appendFileSync} from 'node:fs';
const sql=readFileSync('db/schema.d/40-participant.sql','utf8');
if(!readFileSync('db/schema.sql','utf8').includes('create table if not exists participant_events')) appendFileSync('db/schema.sql','\n'+sql);
console.log('Participant schema added. Run npm run db:setup.');
