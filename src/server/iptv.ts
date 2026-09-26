import fs from 'fs';
import path from 'path';
import { getDataDir } from './storage';

export interface IptvChannel {
  id: string;
  name: string;
  logo?: string;
  group: string;
  country?: string;
  language?: string;
  url: string;
  tvgId?: string;
  resolution?: string;
  httpUserAgent?: string;
  httpReferrer?: string;
}

export interface IptvPlaylistSummary {
  url: string;
  totalChannels: number;
  categories: string[];
  countries: string[];
  channels: IptvChannel[];
  lastUpdated: string;
}

const DEFAULT_PLAYLIST_URL = 'https://iptv-org.github.io/iptv/index.m3u';

// In-memory cache for parsed playlists
let playlistCache: { [url: string]: { data: IptvPlaylistSummary; timestamp: number } } = {};

function getCacheFilePath(): string {
  return path.join(getDataDir(), 'iptv_cache.json');
}

// Load cache from disk if available
export function loadIptvCacheFromDisk() {
  try {
    const file = getCacheFilePath();
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, 'utf-8');
      playlistCache = JSON.parse(content);
    }
  } catch (err) {
    console.error('Erro ao ler cache IPTV do disco:', err);
  }
}

export function saveIptvCacheToDisk() {
  try {
    const file = getCacheFilePath();
    fs.writeFileSync(file, JSON.stringify(playlistCache), 'utf-8');
  } catch (err) {
    console.error('Erro ao salvar cache IPTV:', err);
  }
}

// Parse M3U playlist text into structured channel objects
export function parseM3U(content: string, playlistUrl: string): IptvPlaylistSummary {
  const lines = content.split(/\r?\n/);
  const channels: IptvChannel[] = [];
  const categoriesSet = new Set<string>();
  const countriesSet = new Set<string>();

  let currentInfo: Partial<IptvChannel> | null = null;
  let currentExtraHeaders: { userAgent?: string; referrer?: string } = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      currentInfo = {};
      currentExtraHeaders = {};

      // Parse tvg-name / name
      const tvgIdMatch = line.match(/tvg-id="([^"]*)"/i);
      const tvgNameMatch = line.match(/tvg-name="([^"]*)"/i);
      const tvgLogoMatch = line.match(/tvg-logo="([^"]*)"/i);
      const groupTitleMatch = line.match(/group-title="([^"]*)"/i);
      const tvgCountryMatch = line.match(/tvg-country="([^"]*)"/i);
      const tvgLangMatch = line.match(/tvg-language="([^"]*)"/i);
      const userAgentMatch = line.match(/http-user-agent="([^"]*)"/i);
      const referrerMatch = line.match(/http-referrer="([^"]*)"/i);

      // Channel title after last comma
      const commaIndex = line.lastIndexOf(',');
      let rawTitle = commaIndex !== -1 ? line.substring(commaIndex + 1).trim() : '';
      if (!rawTitle && tvgNameMatch) {
        rawTitle = tvgNameMatch[1];
      }

      // Extract resolution like (1080p), (720p), (480p), [HD], [FHD]
      let resolution = '';
      const resMatch = rawTitle.match(/\b(4k|2160p|1080p|720p|576p|480p|360p|240p|fhd|hd|sd)\b/i);
      if (resMatch) {
        resolution = resMatch[1].toUpperCase();
      }

      // Extract country code from tvg-id if tvg-country is not present (e.g. CNN.us@SD -> US)
      let country = tvgCountryMatch ? tvgCountryMatch[1].toUpperCase() : '';
      if (!country && tvgIdMatch) {
        const idCountryMatch = tvgIdMatch[1].match(/\.([a-z]{2})(@|$)/i);
        if (idCountryMatch) {
          country = idCountryMatch[1].toUpperCase();
        }
      }

      let group = groupTitleMatch ? groupTitleMatch[1].trim() : 'Geral';
      if (!group || group.toLowerCase() === 'undefined') {
        group = 'Geral';
      }

      // Split multiple groups if semicolon separated, keep main or clean
      if (group.includes(';')) {
        const primaryGroup = group.split(';')[0].trim();
        group = primaryGroup || group;
      }

      if (group) categoriesSet.add(group);
      if (country) countriesSet.add(country);

      currentInfo = {
        name: rawTitle || tvgNameMatch?.[1] || 'Canal Desconhecido',
        logo: tvgLogoMatch ? tvgLogoMatch[1] : undefined,
        group,
        country: country || undefined,
        language: tvgLangMatch ? tvgLangMatch[1] : undefined,
        tvgId: tvgIdMatch ? tvgIdMatch[1] : undefined,
        resolution: resolution || undefined,
        httpUserAgent: userAgentMatch ? userAgentMatch[1] : undefined,
        httpReferrer: referrerMatch ? referrerMatch[1] : undefined,
      };
    } else if (line.startsWith('#EXTVLCOPT:http-user-agent=')) {
      currentExtraHeaders.userAgent = line.substring(line.indexOf('=') + 1).trim();
    } else if (line.startsWith('#EXTVLCOPT:http-referrer=')) {
      currentExtraHeaders.referrer = line.substring(line.indexOf('=') + 1).trim();
    } else if (line.startsWith('#')) {
      // Other comments/directives
      continue;
    } else if (line.startsWith('http://') || line.startsWith('https://') || line.startsWith('rtmp://') || line.startsWith('mms://')) {
      // This is the channel stream URL
      if (currentInfo) {
        const channelId = `ch_${channels.length + 1}_${Math.random().toString(36).substring(2, 7)}`;
        channels.push({
          id: channelId,
          name: currentInfo.name || `Canal ${channels.length + 1}`,
          logo: currentInfo.logo,
          group: currentInfo.group || 'Geral',
          country: currentInfo.country,
          language: currentInfo.language,
          url: line,
          tvgId: currentInfo.tvgId,
          resolution: currentInfo.resolution,
          httpUserAgent: currentInfo.httpUserAgent || currentExtraHeaders.userAgent,
          httpReferrer: currentInfo.httpReferrer || currentExtraHeaders.referrer,
        });
        currentInfo = null;
        currentExtraHeaders = {};
      }
    }
  }

  const sortedCategories = Array.from(categoriesSet).sort((a, b) => a.localeCompare(b));
  const sortedCountries = Array.from(countriesSet).sort((a, b) => a.localeCompare(b));

  return {
    url: playlistUrl,
    totalChannels: channels.length,
    categories: sortedCategories,
    countries: sortedCountries,
    channels,
    lastUpdated: new Date().toISOString(),
  };
}

export async function fetchIptvPlaylist(
  playlistUrl = DEFAULT_PLAYLIST_URL,
  forceRefresh = false
): Promise<IptvPlaylistSummary> {
  const cached = playlistCache[playlistUrl];
  const ONE_HOUR = 60 * 60 * 1000;

  if (!forceRefresh && cached && Date.now() - cached.timestamp < ONE_HOUR) {
    return cached.data;
  }

  console.log(`[IPTV] Baixando playlist de: ${playlistUrl}`);
  const response = await fetch(playlistUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: '*/*',
    },
  });

  if (!response.ok) {
    throw new Error(`Falha ao obter playlist IPTV: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  const parsed = parseM3U(text, playlistUrl);

  playlistCache[playlistUrl] = {
    data: parsed,
    timestamp: Date.now(),
  };

  saveIptvCacheToDisk();
  return parsed;
}

// Preset popular playlists from iptv-org
export const IPTV_PRESETS = [
  {
    name: 'IPTV Geral (Global - Completa)',
    url: 'https://iptv-org.github.io/iptv/index.m3u',
    description: 'Mais de 10.000 canais gratuitos do mundo todo',
  },
  {
    name: 'Brasil 🇧🇷',
    url: 'https://iptv-org.github.io/iptv/countries/br.m3u',
    description: 'Canais abertos e comunitários do Brasil',
  },
  {
    name: 'Portugal 🇵🇹',
    url: 'https://iptv-org.github.io/iptv/countries/pt.m3u',
    description: 'Canais de Portugal',
  },
  {
    name: 'Filmes e Séries 🎬',
    url: 'https://iptv-org.github.io/iptv/categories/movies.m3u',
    description: 'Canais temáticos de cinema e séries',
  },
  {
    name: 'Notícias 📰',
    url: 'https://iptv-org.github.io/iptv/categories/news.m3u',
    description: 'Canais globais de jornalismo e notícias',
  },
  {
    name: 'Esportes ⚽',
    url: 'https://iptv-org.github.io/iptv/categories/sports.m3u',
    description: 'Canais de transmissão esportiva',
  },
  {
    name: 'Música 🎵',
    url: 'https://iptv-org.github.io/iptv/categories/music.m3u',
    description: 'Videoclipes e shows 24/7',
  },
  {
    name: 'Infantil / Animação 🧸',
    url: 'https://iptv-org.github.io/iptv/categories/kids.m3u',
    description: 'Desenhos e entretenimento para crianças',
  },
  {
    name: 'Documentários & Cultura 🌍',
    url: 'https://iptv-org.github.io/iptv/categories/documentary.m3u',
    description: 'História, ciência, natureza e viagens',
  },
];
