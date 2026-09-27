import { IptvChannel, IptvPlaylistSummary, IptvPreset } from '../types';

export const CLIENT_IPTV_PRESETS: IptvPreset[] = [
  {
    name: 'Brasil 🇧🇷',
    url: 'https://iptv-org.github.io/iptv/countries/br.m3u',
    description: 'Canais abertos e comunitários do Brasil (CORS liberado)',
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
    name: 'Música 🎵',
    url: 'https://iptv-org.github.io/iptv/categories/music.m3u',
    description: 'Canais 24h de clipes e shows',
  },
  {
    name: 'Portugal 🇵🇹',
    url: 'https://iptv-org.github.io/iptv/countries/pt.m3u',
    description: 'Canais de Portugal',
  },
  {
    name: 'IPTV Geral (Global)',
    url: 'https://iptv-org.github.io/iptv/index.m3u',
    description: 'Milhares de canais gratuitos do mundo todo',
  },
];

const LOCAL_STORAGE_FAVORITES_KEY = 'cinelocal_iptv_favorites';
const CACHE_PREFIX = 'cinelocal_iptv_cache_';

export function getClientFavorites(): string[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_FAVORITES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveClientFavorites(favorites: string[]) {
  try {
    localStorage.setItem(LOCAL_STORAGE_FAVORITES_KEY, JSON.stringify(favorites));
  } catch (err) {
    console.warn('Erro ao salvar favoritos no localStorage:', err);
  }
}

// Parse M3U playlist text directly in the browser
export function parseClientM3U(content: string, playlistUrl: string): IptvPlaylistSummary {
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

      const tvgIdMatch = line.match(/tvg-id="([^"]*)"/i);
      const tvgNameMatch = line.match(/tvg-name="([^"]*)"/i);
      const tvgLogoMatch = line.match(/tvg-logo="([^"]*)"/i);
      const groupTitleMatch = line.match(/group-title="([^"]*)"/i);
      const tvgCountryMatch = line.match(/tvg-country="([^"]*)"/i);
      const tvgLangMatch = line.match(/tvg-language="([^"]*)"/i);
      const userAgentMatch = line.match(/http-user-agent="([^"]*)"/i);
      const referrerMatch = line.match(/http-referrer="([^"]*)"/i);

      const commaIndex = line.lastIndexOf(',');
      let rawTitle = commaIndex !== -1 ? line.substring(commaIndex + 1).trim() : '';
      if (!rawTitle && tvgNameMatch) {
        rawTitle = tvgNameMatch[1];
      }

      let resolution = '';
      const resMatch = rawTitle.match(/\b(4k|2160p|1080p|720p|576p|480p|360p|240p|fhd|hd|sd)\b/i);
      if (resMatch) {
        resolution = resMatch[1].toUpperCase();
      }

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
      continue;
    } else if (line.startsWith('http://') || line.startsWith('https://') || line.startsWith('rtmp://') || line.startsWith('mms://')) {
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

  return {
    url: playlistUrl,
    totalChannels: channels.length,
    categories: Array.from(categoriesSet).sort((a, b) => a.localeCompare(b)),
    countries: Array.from(countriesSet).sort((a, b) => a.localeCompare(b)),
    channels,
    lastUpdated: new Date().toISOString(),
  };
}

export async function fetchPlaylistWithFallback(
  url: string,
  forceRefresh = false
): Promise<IptvPlaylistSummary> {
  const cacheKey = CACHE_PREFIX + url;

  // Check client-side session cache
  if (!forceRefresh) {
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && Array.isArray(parsed.channels) && parsed.channels.length > 0) {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
  }

  // 1. Try local server endpoint first if running with Node Express
  try {
    const res = await fetch(`/api/iptv/playlist?url=${encodeURIComponent(url)}${forceRefresh ? '&refresh=true' : ''}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const data: IptvPlaylistSummary = await res.json();
      if (data && Array.isArray(data.channels) && data.channels.length > 0) {
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify(data));
        } catch {}
        return data;
      }
    }
  } catch {
    // Backend not running (GitHub Pages static host)
  }

  // 2. Direct browser fetch (works great on iptv-org and all CORS-enabled M3U hosts)
  let playlistText = '';
  try {
    const directRes = await fetch(url, {
      headers: { Accept: '*/*' },
      signal: AbortSignal.timeout(10000),
    });
    if (directRes.ok) {
      playlistText = await directRes.text();
    }
  } catch (directErr) {
    console.warn('[IPTV] Fetch direto falhou (CORS ou rede), tentando proxies:', directErr);
  }

  // 3. Fallback via public CORS proxies if direct fetch was blocked by CORS
  if (!playlistText) {
    const proxies = [
      (targetUrl: string) => `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`,
      (targetUrl: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
    ];

    for (const makeProxy of proxies) {
      try {
        const proxyUrl = makeProxy(url);
        const proxyRes = await fetch(proxyUrl, {
          signal: AbortSignal.timeout(8000),
        });
        if (proxyRes.ok) {
          playlistText = await proxyRes.text();
          if (playlistText && playlistText.includes('#EXTM3U')) {
            break;
          }
        }
      } catch (proxyErr) {
        console.warn('[IPTV] Proxy falhou:', proxyErr);
      }
    }
  }

  if (!playlistText || !playlistText.trim()) {
    throw new Error('Não foi possível carregar a lista de canais IPTV. Verifique a URL ou conexão de internet.');
  }

  const parsed = parseClientM3U(playlistText, url);
  try {
    sessionStorage.setItem(cacheKey, JSON.stringify(parsed));
  } catch {}
  return parsed;
}
