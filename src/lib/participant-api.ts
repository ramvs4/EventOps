import {createServerFn} from '@tanstack/react-start';
import {z} from 'zod';
export const participantApi=createServerFn({method:'POST'}).validator(z.object({kind:z.enum(['load','register','cancel','create','join','leave']),eventId:z.number().int().positive().optional(),name:z.string().trim().min(1).max(40).optional()})).handler(async({data})=>{const a=await import('../server/auth.server');const p=await import('../server/participant.server');return a.guarded(['participant'],user=>p.participantData(user,data.kind==='load'?undefined:data));});
