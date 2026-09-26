import fs from 'fs';
import path from 'path';
import { CastMember, Episode, MediaItem } from '../types';
import { getDataDir, readLibrary } from './storage';

const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';
const DEFAULT_LANGUAGE = 'pt-BR';
const REQUEST_TIMEOUT_MS = 15_000;

interface TmdbSearchResult {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  vote_count?: number;
  media_type?: string;
}

interface TmdbSearchResponse {
  results?: TmdbSearchResult[];
}

interface TmdbCredit {
  id: number;
  name: string;
  character?: string;
  profile_path?: string | null;
}

interface TmdbDetail extends TmdbSearchResult {
  tagline?: string;
  genres?: Array<{ id: number; name: string }>;
  credits?: { cast?: TmdbCredit[] };
  seasons?: Array<{ season_number: number; episode_count: number }>;
}

interface TmdbSeasonResponse {
  season_number: number;
  episodes?: Array<{
    id: number;
    episode_number: number;
    name?: string;
    overview?: string;
    air_date?: string;
    still_path?: string | null;
    vote_average?: number;
  }>;
}

export function getApiKey(): string | undefined {
  const envKey = process.env.TMDB_API_KEY?.trim();
  if (envKey) return envKey;
  try {
    const lib = readLibrary();
    const settingKey = lib.settings.tmdbApiKey?.trim();
    if (settingKey) return settingKey;
  } catch {}
  return undefined;
}

export function getAccessToken(): string | undefined {
  const envToken = process.env.TMDB_ACCESS_TOKEN?.trim();
  if (envToken) return envToken;
  try {
    const lib = readLibrary();
    const settingToken = lib.settings.tmdbAccessToken?.trim();
    if (settingToken) return settingToken;
  } catch {}
  return undefined;
}

export function isTmdbConfigured(): boolean {
  return Boolean(getApiKey() || getAccessToken());
}

export function getLanguage(): string {
  const envLang = process.env.TMDB_LANGUAGE?.trim();
  if (envLang) return envLang;
  try {
    const lib = readLibrary();
    const settingLang = lib.settings.tmdbLanguage?.trim();
    if (settingLang) return settingLang;
  } catch {}
  return DEFAULT_LANGUAGE;
}

function normalizeSearchTitle(title: string): string {
  return title
    .replace(/(?:^|[\s._-])[Ss]\d{1,2}(?:[-_. ][Ss]\d{1,2})?(?:[Ee]\d{1,3})?(?:[-_. ]*[Ee]\d{1,3})?/g, ' ')
    .replace(/(?:temporada|season)\s*\d+/gi, ' ')
    .replace(/(?:complete\s*series|complete\s*season|complete)/gi, ' ')
    .replace(/[._]/g, ' ')
    .replace(/[\[\(].*?[\]\)]/g, ' ')
    .replace(/\b(?:2160p|1080p|720p|480p|4k|bluray|brrip|webrip|web[- ]?dl|webdl|hdtv|x26[45]|hevc|avc|aac|dts|ddp|ac3|remux|proper|repack|yify|yts|eztv|rarbg|tgx|dual|dublado|legendado|multi)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function imageUrl(imagePath: string | null | undefined, size: 'w500' | 'w780' | 'original'): string | undefined {
  return imagePath ? `${TMDB_IMAGE_BASE}/${size}${imagePath}` : undefined;
}

async function requestTmdb<T>(endpoint: string, params: Record<string, string | number> = {}): Promise<T> {
  const apiKey = getApiKey();
  const accessToken = getAccessToken();
  if (!apiKey && !accessToken) {
    throw new Error('TMDb não configurado');
  }

  const url = new URL(`${TMDB_API_BASE}${endpoint}`);
  url.searchParams.set('language', getLanguage());
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  if (apiKey) {
    url.searchParams.set('api_key', apiKey);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`TMDb respondeu HTTP ${response.status}`);
    }
    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function downloadImage(url: string, destination: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) return false;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 25 * 1024 * 1024) return false;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes);
    return true;
  } catch (error) {
    console.warn('[TMDb] Não foi possível baixar imagem:', error instanceof Error ? error.message : error);
    return false;
  }
}

async function cacheImage(mediaId: string, kind: string, remoteUrl: string | undefined): Promise<string | undefined> {
  if (!remoteUrl) return undefined;

  const destination = path.join(getDataDir(), 'metadata', mediaId, `${kind}.jpg`);
  if (fs.existsSync(destination) && fs.statSync(destination).size > 0) {
    return destination;
  }

  return (await downloadImage(remoteUrl, destination)) ? destination : remoteUrl;
}

function mapCast(cast: TmdbCredit[] | undefined): CastMember[] {
  return (cast || []).slice(0, 20).map((member) => ({
    id: member.id,
    name: member.name,
    character: member.character || undefined,
    profilePath: imageUrl(member.profile_path, 'w500'),
  }));
}

function getResultTitle(result: TmdbSearchResult): string {
  return result.title || result.name || result.original_title || result.original_name || '';
}

function getResultDate(result: TmdbSearchResult): string | undefined {
  return result.release_date || result.first_air_date || undefined;
}

function chooseSearchResult(results: TmdbSearchResult[], query: string): TmdbSearchResult | undefined {
  if (results.length === 0) return undefined;
  const normalizedQuery = normalizeSearchTitle(query).toLocaleLowerCase();
  return [...results].sort((a, b) => {
    const aTitle = getResultTitle(a).toLocaleLowerCase();
    const bTitle = getResultTitle(b).toLocaleLowerCase();
    const aExact = aTitle === normalizedQuery ? 1 : 0;
    const bExact = bTitle === normalizedQuery ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;
    return (b.vote_count || 0) - (a.vote_count || 0);
  })[0];
}

async function findMedia(query: string, kind: MediaItem['kind']): Promise<TmdbSearchResult | undefined> {
  const cleanQuery = normalizeSearchTitle(query);
  const queriesToTry = [cleanQuery, query.trim()].filter(Boolean);

  for (const q of [...new Set(queriesToTry)]) {
    // 1. Try primary endpoint for the given kind
    const primaryEndpoint = kind === 'movie' ? '/search/movie' : '/search/tv';
    try {
      const response = await requestTmdb<TmdbSearchResponse>(primaryEndpoint, { query: q, include_adult: 'false' });
      const match = chooseSearchResult(response.results || [], q);
      if (match) return match;
    } catch {}

    // 2. Try alternate endpoint
    const secondaryEndpoint = kind === 'movie' ? '/search/tv' : '/search/movie';
    try {
      const response = await requestTmdb<TmdbSearchResponse>(secondaryEndpoint, { query: q, include_adult: 'false' });
      const match = chooseSearchResult(response.results || [], q);
      if (match) return match;
    } catch {}

    // 3. Try multi-search
    try {
      const response = await requestTmdb<TmdbSearchResponse>('/search/multi', { query: q, include_adult: 'false' });
      const filtered = (response.results || []).filter((r) => r.media_type === 'movie' || r.media_type === 'tv' || !r.media_type);
      const match = chooseSearchResult(filtered, q);
      if (match) return match;
    } catch {}
  }

  return undefined;
}

function applyMediaDetail(media: MediaItem, detail: TmdbDetail): void {
  const date = getResultDate(detail);
  if (!media.customTitle) {
    media.title = getResultTitle(detail) || media.title;
  }
  media.originalTitle = detail.original_title || detail.original_name || media.originalTitle;
  media.year = date ? Number.parseInt(date.slice(0, 4), 10) || undefined : media.year;
  media.overview = detail.overview || media.overview;
  media.tagline = detail.tagline || undefined;
  media.genres = (detail.genres || []).map((genre) => genre.name).filter(Boolean);
  media.rating = typeof detail.vote_average === 'number' ? detail.vote_average : undefined;
  media.voteCount = typeof detail.vote_count === 'number' ? detail.vote_count : undefined;
  media.tmdbId = detail.id;
  media.metadataProvider = 'tmdb';
  media.cast = mapCast(detail.credits?.cast);
}

function applyEpisodeDetail(episode: Episode, tmdbEpisode: NonNullable<TmdbSeasonResponse['episodes']>[number]): void {
  if (tmdbEpisode.episode_number !== episode.episodeNumber) return;
  episode.tmdbId = tmdbEpisode.id;
  episode.title = tmdbEpisode.name || episode.title;
  episode.overview = tmdbEpisode.overview || undefined;
  episode.airDate = tmdbEpisode.air_date || undefined;
  episode.rating = typeof tmdbEpisode.vote_average === 'number' ? tmdbEpisode.vote_average : undefined;
  episode.stillPath = imageUrl(tmdbEpisode.still_path, 'w500');
}

async function enrichSeriesEpisodes(media: MediaItem, tmdbId: number): Promise<void> {
  await Promise.all(media.seasons.map(async (season) => {
    try {
      const seasonData = await requestTmdb<TmdbSeasonResponse>(`/tv/${tmdbId}/season/${season.seasonNumber}`);
      for (const episode of season.episodes) {
        const tmdbEpisode = seasonData.episodes?.find((item) => item.episode_number === episode.episodeNumber);
        if (tmdbEpisode) {
          applyEpisodeDetail(episode, tmdbEpisode);
          episode.stillPath = await cacheImage(media.id, `episode-${episode.id}`, episode.stillPath);
        }
      }
    } catch (error) {
      console.warn(`[TMDb] Não foi possível carregar a temporada ${season.seasonNumber}:`, error instanceof Error ? error.message : error);
    }
  }));
}

export async function searchTmdb(query: string, kind?: MediaItem['kind']): Promise<TmdbSearchResult[]> {
  if (!isTmdbConfigured()) return [];
  const cleanQuery = normalizeSearchTitle(query);
  const q = cleanQuery || query.trim();
  if (!q) return [];

  try {
    if (kind === 'movie') {
      const res = await requestTmdb<TmdbSearchResponse>('/search/movie', { query: q, include_adult: 'false' });
      return res.results || [];
    } else if (kind === 'series') {
      const res = await requestTmdb<TmdbSearchResponse>('/search/tv', { query: q, include_adult: 'false' });
      return res.results || [];
    } else {
      const res = await requestTmdb<TmdbSearchResponse>('/search/multi', { query: q, include_adult: 'false' });
      return (res.results || []).filter((r) => r.media_type === 'movie' || r.media_type === 'tv' || !r.media_type);
    }
  } catch (error) {
    console.warn('[TMDb] Falha ao pesquisar títulos:', error instanceof Error ? error.message : error);
    return [];
  }
}

export async function enrichMediaWithTmdb(
  media: MediaItem,
  customQuery?: string,
  explicitTmdbId?: number
): Promise<MediaItem> {
  if (!isTmdbConfigured()) {
    throw new Error('Chave da API do TMDb não configurada no servidor.');
  }

  const query = customQuery?.trim() || media.customTitle || media.title || path.basename(media.folderPath);
  let targetId = explicitTmdbId;

  if (!targetId) {
    const searchResult = await findMedia(query, media.kind);
    if (!searchResult) {
      throw new Error(`Nenhum título encontrado no TMDb para "${query}". Tente buscar digitando o nome exato na barra de busca.`);
    }
    targetId = searchResult.id;
  }

  const endpoint = media.kind === 'movie' ? `/movie/${targetId}` : `/tv/${targetId}`;
  let detail: TmdbDetail;
  try {
    detail = await requestTmdb<TmdbDetail>(endpoint, { append_to_response: 'credits' });
  } catch (err) {
    // If not found in primary endpoint, try other endpoint
    const fallbackEndpoint = media.kind === 'movie' ? `/tv/${targetId}` : `/movie/${targetId}`;
    detail = await requestTmdb<TmdbDetail>(fallbackEndpoint, { append_to_response: 'credits' });
  }

  applyMediaDetail(media, detail);

  const posterUrl = imageUrl(detail.poster_path, 'w500');
  const backdropUrl = imageUrl(detail.backdrop_path, 'w780');
  const [posterPath, backdropPath] = await Promise.all([
    cacheImage(media.id, 'poster', posterUrl),
    cacheImage(media.id, 'backdrop', backdropUrl),
  ]);

  if (posterPath) {
    media.posterPath = posterPath;
  } else if (posterUrl) {
    media.posterPath = posterUrl;
  }

  if (backdropPath) {
    media.backdropPath = backdropPath;
  } else if (backdropUrl) {
    media.backdropPath = backdropUrl;
  }

  if (media.kind === 'series') {
    await enrichSeriesEpisodes(media, detail.id);
    for (const season of media.seasons) {
      season.title = `Temporada ${season.seasonNumber}`;
    }
  } else {
    // Filmes NÃO têm temporadas
    media.totalSeasons = 0;
    for (const season of media.seasons) {
      season.seasonNumber = 0;
      season.title = '';
      if (season.episodes[0] && (!season.episodes[0].title || season.episodes[0].title.startsWith('Episódio') || season.episodes[0].title.startsWith('Vídeo'))) {
        season.episodes[0].title = media.title;
      }
    }
  }

  return media;
}
