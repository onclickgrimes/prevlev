/** Shared observation math and identities. No DOM, network or storage. */
export interface ChannelInput {channelId?: string;channelUrl?: string;channel?: string;}
const normalizedName = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();

export function observedLifetimeVph(video: {views?:number;publishedAt?:string}, now=Date.now()): number|undefined {
  if (video.views===undefined || !Number.isFinite(video.views) || video.views<0 || !video.publishedAt) return undefined;
  const published=knownPublication(video.publishedAt,now);
  if(published===undefined || published>=now)return undefined;
  const result=video.views/((now-published)/3600000);
  return Number.isFinite(result)?result:undefined;
}

/** Accept unambiguous ISO dates only, rejecting Date.parse's invalid-day rollover. */
export function isoBoundary(value: string, endOfDay: boolean): number {
  if (typeof value !== "string")
    throw new Error(
      "Informe uma data ISO válida: AAAA-MM-DD ou timestamp com fuso horário.",
    );
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const timestamp =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!dateOnly && !timestamp)
    throw new Error(
      "Informe uma data ISO válida: AAAA-MM-DD ou timestamp com fuso horário.",
    );
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1])
    throw new Error("A data de publicação contém um dia ou mês inválido.");
  if (timestamp) {
    const zone = timestamp[8];
    if (
      Number(timestamp[4]) > 23 ||
      Number(timestamp[5]) > 59 ||
      Number(timestamp[6] ?? 0) > 59 ||
      (zone !== "Z" &&
        (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))
    )
      throw new Error("O horário ou fuso da data de publicação é inválido.");
  }
  const parsed = Date.parse(
    dateOnly
      ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`
      : value,
  );
  if (!Number.isFinite(parsed))
    throw new Error("A data de publicação é inválida.");
  return parsed;
}

export function knownPublication(value: string, now: number): number | undefined {
  if (!Number.isFinite(now)) return undefined;
  try {
    const timestamp = isoBoundary(value, false);
    return timestamp <= now ? timestamp : undefined;
  } catch {
    return undefined;
  }
}

export interface ChannelIdentity {
  id?: string;
  handle?: string;
  name?: string;
  ambiguous?: boolean;
}

export function channelIdentity(video: ChannelInput): ChannelIdentity {
  const explicitId = video.channelId?.trim();
  let id =
    explicitId && /^[A-Za-z0-9_-]{1,128}$/.test(explicitId)
      ? explicitId
      : undefined;
  let handle: string | undefined;
  if (video.channelUrl) {
    try {
      const url = new URL(video.channelUrl);
      if (
        url.protocol === "https:" &&
        ["www.youtube.com", "youtube.com", "m.youtube.com"].includes(
          url.hostname,
        ) &&
        !url.username &&
        !url.password &&
        !url.port
      ) {
        const path = decodeURIComponent(url.pathname).replace(/\/$/, "");
        const linkedId = /^\/channel\/([A-Za-z0-9_-]{1,128})$/.exec(path)?.[1];
        if (id && linkedId && id !== linkedId) return { ambiguous: true };
        id ??= linkedId;
        handle = /^\/@([\p{L}\p{N}_.\-·]{1,100})$/u
          .exec(path)?.[1]
          .normalize("NFC")
          .toLocaleLowerCase();
      }
    } catch {
      /* Invalid URLs cannot establish a channel alias. */
    }
  }
  const name = video.channel
    ? normalizedName(video.channel).trim().replace(/\s+/g, " ") || undefined
    : undefined;
  return { id, handle, name };
}

export function comparableChannel(
  target: ChannelIdentity,
  peer: ChannelIdentity,
): boolean {
  if (target.ambiguous || peer.ambiguous) return false;
  if (!target.id && !target.handle && !target.name) return true;
  // A definitive shared ID also handles channel URL aliases and handle renames.
  if (target.id && peer.id) return target.id === peer.id;
  if (target.handle && peer.handle) return target.handle === peer.handle;
  // Names can collide, so use them only when neither side has a stronger identity.
  if (target.id || target.handle || peer.id || peer.handle) return false;
  return !!target.name && target.name === peer.name;
}

/** Alias only when the same observation explicitly links an ID and handle. */
export function groupChannelIdentities<T extends ChannelInput>(videos:readonly T[]):Map<T,{key:string;label:string}> {
  const identities=videos.map(channelIdentity), aliases=new Map<string,Set<string>>();
  for(const identity of identities)if(!identity.ambiguous&&identity.id&&identity.handle){const ids=aliases.get(identity.handle)??new Set<string>();ids.add(identity.id);aliases.set(identity.handle,ids);}
  const grouped=new Map<T,{key:string;label:string}>();
  videos.forEach((video,index)=>{
    const identity=identities[index];if(identity.ambiguous)return;
    const linkedIds=identity.handle?aliases.get(identity.handle):undefined;
    const id=identity.id??(linkedIds?.size===1?[...linkedIds][0]:undefined);
    const key=id?`id:${id}`:identity.handle?`handle:${identity.handle}`:identity.name?`name:${identity.name}`:undefined;
    if(key)grouped.set(video,{key,label:video.channel?.trim()||(id??(identity.handle?`@${identity.handle}`:identity.name!))});
  });
  return grouped;
}
