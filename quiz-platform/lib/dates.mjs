import {DateTime,IANAZone} from 'luxon';
export function range(input={}){
  const timezone=input.timezone||'America/New_York';if(!IANAZone.isValidZone(timezone))throw Error('Invalid timezone');
  const today=DateTime.now().setZone(timezone).startOf('day');
  const from=input.from||today.minus({days:30}).toISODate();const to=input.to||today.minus({days:1}).toISODate();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))throw Error('Use YYYY-MM-DD dates');
  const start=DateTime.fromISO(from,{zone:timezone}).startOf('day'),end=DateTime.fromISO(to,{zone:timezone}).plus({days:1}).startOf('day');
  if(!start.isValid||!end.isValid||end<=start||end.diff(start,'days').days>3653)throw Error('Invalid date range (maximum ten years)');
  const days=Math.round(end.diff(start,'days').days);
  return {from,to,timezone,days,start:start.toUTC().toISO(),end:end.toUTC().toISO(),previous:{from:start.minus({days}).toISODate(),to:start.minus({days:1}).toISODate()}};
}
