import { IptvChannel, IptvPlaylistSummary } from '../types';

const DB_NAME = 'cinelocal_iptv_cache_db';
const DB_VERSION = 1;
const STORE_NAME = 'playlists';

// In-memory fast cache
const memoryCache = new Map<string, { data: IptvPlaylistSummary; timestamp: number }>();

function openIptvCacheDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB não suportado no ambiente'));
    }

    const req = window.indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'url' });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Retrieve playlist from local cache (Memory -> IndexedDB -> SessionStorage)
 */
export async function getCachedPlaylist(url: string): Promise<IptvPlaylistSummary | null> {
  // 1. Memory check (instant 0ms)
  const mem = memoryCache.get(url);
  if (mem && mem.data && Array.isArray(mem.data.channels) && mem.data.channels.length > 0) {
    return mem.data;
  }

  // 2. IndexedDB check (persistent across reloads and tab closures, no 5MB limit)
  try {
    const db = await openIptvCacheDb();
    const record = await new Promise<any>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(url);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    if (record && record.data && Array.isArray(record.data.channels) && record.data.channels.length > 0) {
      memoryCache.set(url, { data: record.data, timestamp: record.timestamp || Date.now() });
      return record.data;
    }
  } catch (err) {
    console.warn('[IPTV Cache] Falha ao ler IndexedDB, tentando storage alternativo:', err);
  }

  // 3. SessionStorage fallback
  try {
    const raw = sessionStorage.getItem(`cinelocal_iptv_${url}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.channels) && parsed.channels.length > 0) {
        memoryCache.set(url, { data: parsed, timestamp: Date.now() });
        return parsed;
      }
    }
  } catch {}

  return null;
}

/**
 * Save playlist to persistent local cache
 */
export async function saveCachedPlaylist(url: string, data: IptvPlaylistSummary): Promise<void> {
  if (!data || !Array.isArray(data.channels) || data.channels.length === 0) return;

  const now = Date.now();

  // 1. Memory
  memoryCache.set(url, { data, timestamp: now });

  // 2. IndexedDB
  try {
    const db = await openIptvCacheDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put({
        url,
        data,
        timestamp: now,
        channelCount: data.channels.length,
      });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[IPTV Cache] Falha ao persistir no IndexedDB:', err);
  }

  // 3. SessionStorage best effort
  try {
    sessionStorage.setItem(`cinelocal_iptv_${url}`, JSON.stringify(data));
  } catch {}
}

/**
 * Curated offline fallback playlist for Brazil open TV, guaranteeing channels are always available
 * even when internet is disconnected or remote iptv-org GitHub servers fail.
 */
export function getCuratedFallbackBrazilPlaylist(playlistUrl: string): IptvPlaylistSummary {
  const curatedChannels: IptvChannel[] = [
    {
      id: 'fb_cultura',
      name: 'TV Cultura (1080p)',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cd/TV_Cultura_logo_2013.svg/512px-TV_Cultura_logo_2013.svg.png',
      group: 'Cultura',
      country: 'BR',
      url: 'https://cdn.jmvstream.com/w/LVW-8410/LVW8410_uiZOVm6vz1/playlist.m3u8',
      resolution: '1080P',
      language: 'por',
    },
    {
      id: 'fb_tvbrasil',
      name: 'TV Brasil (720p)',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/TV_Brasil_logo_2023.svg/512px-TV_Brasil_logo_2023.svg.png',
      group: 'Público',
      country: 'BR',
      url: 'https://ebc-tvbrasil-linear.stream.live.ebc.com.br/hls/index.m3u8',
      resolution: '720P',
      language: 'por',
    },
    {
      id: 'fb_vejamais',
      name: 'VEJA+ TV (1080p)',
      logo: 'https://i.imgur.com/n0pxHo4.png',
      group: 'Notícias',
      country: 'BR',
      url: 'https://gpa-vja.otteravision.com/gpa/vja/vja.m3u8',
      resolution: '1080P',
      language: 'por',
    },
    {
      id: 'fb_tvebahia',
      name: 'TVE Bahia (1080p)',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/TVE_Bahia_logo.svg/960px-TVE_Bahia_logo.svg.png',
      group: 'Cultura',
      country: 'BR',
      url: 'https://streaming.procergs.com.br:8443/tve/stve/playlist.m3u8',
      resolution: '1080P',
      language: 'por',
    },
    {
      id: 'fb_tvcamara',
      name: 'TV Câmara (720p)',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/53/Logo_TV_C%C3%A2mara.svg/512px-Logo_TV_C%C3%A2mara.svg.png',
      group: 'Legislação',
      country: 'BR',
      url: 'https://camara-live.crosshost.com.br/live/live.m3u8',
      resolution: '720P',
      language: 'por',
    },
    {
      id: 'fb_tvsenado',
      name: 'TV Senado (720p)',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Logo_TV_Senado.svg/512px-Logo_TV_Senado.svg.png',
      group: 'Legislação',
      country: 'BR',
      url: 'https://tvsenadolive.senado.leg.br/live/smil:aovivo.smil/playlist.m3u8',
      resolution: '720P',
      language: 'por',
    },
    {
      id: 'fb_tvjustica',
      name: 'TV Justiça (720p)',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Logo_TV_Justi%C3%A7a.svg/512px-Logo_TV_Justi%C3%A7a.svg.png',
      group: 'Legislação',
      country: 'BR',
      url: 'https://streamer1.streamhost.org/salive/GMI3anjoh/playlist.m3u8',
      resolution: '720P',
      language: 'por',
    },
    {
      id: 'fb_redeminas',
      name: 'Rede Minas (720p)',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Rede_Minas_logo.svg/512px-Rede_Minas_logo.svg.png',
      group: 'Cultura',
      country: 'BR',
      url: 'https://cdn.jmvstream.com/w/LVW-9730/LVW9730_LmUwslM8jt/playlist.m3u8',
      resolution: '720P',
      language: 'por',
    },
    {
      id: 'fb_recordnews',
      name: 'Record News (720p)',
      logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/Record_News_logo_2020.svg/512px-Record_News_logo_2020.svg.png',
      group: 'Notícias',
      country: 'BR',
      url: 'https://stream01.msolutionbrasil.com.br/hls/tvitape/live.m3u8',
      resolution: '720P',
      language: 'por',
    },
    {
      id: 'fb_tvuniao',
      name: 'TV União (720p)',
      logo: 'https://i.imgur.com/crszh3d.png',
      group: 'Entretenimento',
      country: 'BR',
      url: 'https://sistemavrt.vrtchannel.tv.br:3473/stream/play.m3u8',
      resolution: '720P',
      language: 'por',
    },
  ];

  const categories = Array.from(new Set(curatedChannels.map((c) => c.group))).sort();

  return {
    url: playlistUrl,
    totalChannels: curatedChannels.length,
    categories,
    countries: ['BR'],
    channels: curatedChannels,
    lastUpdated: new Date().toISOString(),
  };
}
