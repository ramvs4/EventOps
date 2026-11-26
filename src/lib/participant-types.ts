export type Event={id:number;title:string;category:string;date:string;location:string;image:string;description:string;capacity:number;published:boolean;registrationOpen:boolean;teamEnabled:boolean};
export type Team={id:number;name:string;eventId:number;members:string[];mine:boolean};
export type ParticipantData={events:Event[];registrations:number[];tickets:{eventId:number;reference:string}[];teams:Team[];user:{name:string;email:string};announcements:{title:string;date:string;body:string}[]};
