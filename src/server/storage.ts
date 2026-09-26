import fs from 'fs';
import path from 'path';
import { LibraryData, MediaItem, Episode, Season, MediaKind } from '../types';
import { parseEpisodeInfo, scanMediaFolder } from './scanner';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const LIBRARY_FILE = path.join(DATA_DIR, 'library.json');
const THUMB_DIR = path.join(DATA_DIR, 'thumbnails');

// Ensure data and thumbnail directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(THUMB_DIR)) {
  fs.mkdirSync(THUMB_DIR, { recursive: true });
}

export function getThumbnailDir(): string {
  return THUMB_DIR;
}

export function getDataDir(): string {
  return DATA_DIR;
}

export function getLibraryFilePath(): string {
  return LIBRARY_FILE;
}

const DEFAULT_LIBRARY: LibraryData = {
  version: 1,
  updatedAt: new Date().toISOString(),
  settings: {
    preferredAudioLanguage: 'por',
    preferredSubtitleLanguage: 'por',
    autoPlayNext: true,
  },
  items: [],
};

let cachedLibrary: LibraryData | null = null;
let writeDebounceTimer: NodeJS.Timeout | null = null;

export function readLibrary(): LibraryData {
  if (cachedLibrary) {
    return cachedLibrary;
  }
  try {
    if (!fs.existsSync(LIBRARY_FILE)) {
      writeLibrary(DEFAULT_LIBRARY, true);
      return DEFAULT_LIBRARY;
    }
    const raw = fs.readFileSync(LIBRARY_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as LibraryData;
    if (!parsed.items || !Array.isArray(parsed.items)) {
      parsed.items = [];
    }
    if (deduplicateSeriesInLibrary(parsed)) {
      writeLibrary(parsed, true);
    }
    cachedLibrary = parsed;
    return parsed;
  } catch (error) {
    console.error('Error reading library.json:', error);
    return DEFAULT_LIBRARY;
  }
}

export function writeLibrary(data: LibraryData, immediate = false): void {
  data.updatedAt = new Date().toISOString();
  cachedLibrary = data;

  const flushToDisk = () => {
    try {
      const tempFile = `${LIBRARY_FILE}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tempFile, LIBRARY_FILE);
    } catch (error) {
      console.error('Error writing library.json:', error);
    }
  };

  if (immediate) {
    if (writeDebounceTimer) {
      clearTimeout(writeDebounceTimer);
      writeDebounceTimer = null;
    }
    flushToDisk();
    return;
  }

  if (writeDebounceTimer) {
    clearTimeout(writeDebounceTimer);
  }
  writeDebounceTimer = setTimeout(() => {
    writeDebounceTimer = null;
    flushToDisk();
  }, 1500);
}

export function findMediaItem(id: string): MediaItem | undefined {
  const lib = readLibrary();
  return lib.items.find((item) => item.id === id);
}

export function findEpisode(
  mediaId: string,
  episodeId: string
): { media: MediaItem; episode: Episode } | undefined {
  const media = findMediaItem(mediaId);
  if (!media) return undefined;
  for (const season of media.seasons) {
    const episode = season.episodes.find((ep) => ep.id === episodeId);
    if (episode) {
      return { media, episode };
    }
  }
  return undefined;
}

export function updateEpisodeProgress(
  mediaId: string,
  episodeId: string,
  progressSeconds: number,
  durationSeconds?: number,
  completed?: boolean,
  audioIndex?: number,
  subtitleIndex?: number
): boolean {
  const lib = readLibrary();
  const media = lib.items.find((i) => i.id === mediaId);
  if (!media) return false;

  let found = false;
  for (const season of media.seasons) {
    const ep = season.episodes.find((e) => e.id === episodeId);
    if (ep) {
      ep.progressSeconds = Math.max(0, Math.floor(progressSeconds));
      if (durationSeconds && durationSeconds > 0) {
        ep.durationSeconds = durationSeconds;
      }
      if (completed !== undefined) {
        ep.watched = completed;
      } else if (ep.durationSeconds > 0 && ep.progressSeconds >= ep.durationSeconds * 0.9) {
        ep.watched = true;
      }
      if (audioIndex !== undefined) {
        ep.selectedAudioIndex = audioIndex;
      }
      if (subtitleIndex !== undefined) {
        ep.selectedSubtitleIndex = subtitleIndex;
      }
      ep.lastWatchedAt = new Date().toISOString();
      media.lastWatchedEpisodeId = ep.id;
      media.lastWatchedAt = ep.lastWatchedAt;
      media.updatedAt = new Date().toISOString();
      found = true;
      break;
    }
  }

  if (found) {
    writeLibrary(lib);
  }
  return found;
}

export function toggleEpisodeWatched(mediaId: string, episodeId: string, watched?: boolean): boolean {
  const lib = readLibrary();
  const media = lib.items.find((i) => i.id === mediaId);
  if (!media) return false;

  for (const season of media.seasons) {
    const ep = season.episodes.find((e) => e.id === episodeId);
    if (ep) {
      ep.watched = watched !== undefined ? watched : !ep.watched;
      if (ep.watched && ep.durationSeconds > 0) {
        ep.progressSeconds = ep.durationSeconds;
      } else if (!ep.watched) {
        ep.progressSeconds = 0;
      }
      writeLibrary(lib);
      return true;
    }
  }
  return false;
}

export function relocateMediaFolder(mediaId: string, newFolderPath: string): { success: boolean; message: string } {
  const lib = readLibrary();
  const media = lib.items.find((i) => i.id === mediaId);
  if (!media) return { success: false, message: 'Mídia não encontrada' };

  if (!fs.existsSync(newFolderPath)) {
    return { success: false, message: `Pasta não existe: ${newFolderPath}` };
  }

  const oldFolder = media.folderPath;
  media.folderPath = newFolderPath;
  media.updatedAt = new Date().toISOString();

  // Update paths for all episodes if they were located inside the oldFolder
  for (const season of media.seasons) {
    for (const ep of season.episodes) {
      if (ep.filePath.startsWith(oldFolder)) {
        const subPath = ep.filePath.slice(oldFolder.length).replace(/^[/\\]+/, '');
        ep.filePath = path.join(newFolderPath, subPath);
      } else {
        // Match by filename inside the new folder
        const candidate = path.join(newFolderPath, ep.fileName);
        if (fs.existsSync(candidate)) {
          ep.filePath = candidate;
        }
      }
    }
  }

  writeLibrary(lib);
  return { success: true, message: 'Pasta relocalizada com sucesso' };
}

export function updateMediaBanner(mediaId: string, bannerUrl: string): boolean {
  const lib = readLibrary();
  const media = lib.items.find((i) => i.id === mediaId);
  if (!media) return false;

  media.backdropPath = bannerUrl && bannerUrl.trim() ? bannerUrl.trim() : undefined;
  media.updatedAt = new Date().toISOString();
  writeLibrary(lib, true);
  return true;
}

export function updateMediaPoster(mediaId: string, posterUrl: string): boolean {
  const lib = readLibrary();
  const media = lib.items.find((i) => i.id === mediaId);
  if (!media) return false;

  media.posterPath = posterUrl && posterUrl.trim() ? posterUrl.trim() : undefined;
  media.updatedAt = new Date().toISOString();
  writeLibrary(lib, true);
  return true;
}

export function updateTmdbSettings(apiKey?: string, accessToken?: string, language?: string): void {
  const lib = readLibrary();
  if (apiKey !== undefined) {
    lib.settings.tmdbApiKey = apiKey.trim() || undefined;
  }
  if (accessToken !== undefined) {
    lib.settings.tmdbAccessToken = accessToken.trim() || undefined;
  }
  if (language !== undefined) {
    lib.settings.tmdbLanguage = language.trim() || undefined;
  }
  writeLibrary(lib, true);
}

export interface ExtractedEpisodeInfo {
  isEpisode: boolean;
  showTitle: string;
  seasonNumber: number;
  episodeNumber: number;
  episodeTitle: string;
  rawEpisodeToken?: string;
}

export function cleanSeriesShowTitle(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/^\[[^\]]+\]\s*/, '') // Remove leading group [Fansub]
    .replace(/[\[\(].*?[\]\)]/g, ' ') // Remove brackets
    .replace(/\b(?:2160p|1080p|720p|480p|4k|bluray|brrip|webrip|web-dl|webdl|hdtv|x264|x265|hevc|avc|aac|dts|ddp|ac3|yify|yts|eztv|tgx|rarbg|galaxytv|dual|dublado|legendado|multi|ita|eng|por|brazilian|sub|dub|repack|proper|complete|season\s*\d+|temporada\s*\d+)\b/gi, ' ')
    .replace(/[\._]/g, ' ')
    .replace(/^[-\s.:]+|[-\s.:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanEpisodeTitlePart(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/[\[\(].*?[\]\)]/g, ' ')
    .replace(/\b(?:2160p|1080p|720p|480p|4k|bluray|brrip|webrip|web-dl|webdl|hdtv|x264|x265|hevc|avc|aac|dts|ddp|ac3|yify|yts|eztv|tgx|rarbg|galaxytv|dual|dublado|legendado|multi|ita|eng|por|brazilian|sub|dub|repack|proper)\b/gi, ' ')
    .replace(/[\._]/g, ' ')
    .replace(/^[-\s.:]+|[-\s.:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractShowAndEpisode(input: string): ExtractedEpisodeInfo {
  if (!input) {
    return {
      isEpisode: false,
      showTitle: '',
      seasonNumber: 1,
      episodeNumber: 1,
      episodeTitle: '',
    };
  }

  // Remove file extension
  const withoutExt = input.replace(/\.[a-zA-Z0-9]{2,4}$/i, '');
  // Normalize slashes to get base name if path
  const normalized = withoutExt.replace(/\\/g, '/');
  const pathParts = normalized.split('/').filter(Boolean);
  const baseName = pathParts[pathParts.length - 1] || withoutExt;

  // Check if directory in path indicates Season
  let pathSeason: number | undefined;
  for (let i = 0; i < pathParts.length - 1; i++) {
    const sMatch = pathParts[i].match(/(?:temporada|season|s)\s*(\d{1,2})/i);
    if (sMatch) {
      const parsedS = parseInt(sMatch[1], 10);
      if (parsedS > 0 && parsedS < 100) pathSeason = parsedS;
    }
  }

  // 1. S01E02 / s01e02 / S1E2 / S01 - E02 / S01.E02 / S01_E02 / S01E02-E03
  const sxxExxMatch = baseName.match(/(.*?)(?:^|[\s._\-\[])[Ss](\d{1,2})[\.\s_\-]*[Ee](\d{1,3})(.*)/);
  if (sxxExxMatch) {
    const rawShow = sxxExxMatch[1] || (pathParts.length > 1 ? pathParts[0] : '');
    const sNum = parseInt(sxxExxMatch[2], 10);
    const eNum = parseInt(sxxExxMatch[3], 10);
    const rawRest = sxxExxMatch[4];
    const cleanShow = cleanSeriesShowTitle(rawShow);
    const cleanEpTitle = cleanEpisodeTitlePart(rawRest) || `Episódio ${eNum}`;
    if (cleanShow) {
      return {
        isEpisode: true,
        showTitle: cleanShow,
        seasonNumber: sNum || pathSeason || 1,
        episodeNumber: eNum,
        episodeTitle: cleanEpTitle,
        rawEpisodeToken: `S${sNum < 10 ? '0' + sNum : sNum}E${eNum < 10 ? '0' + eNum : eNum}`,
      };
    }
  }

  // 2. 1x02 / 01x02
  const xMatch = baseName.match(/(.*?)(?:^|[\s._\-\[])(\d{1,2})[xX](\d{1,3})(.*)/);
  if (xMatch) {
    const rawShow = xMatch[1] || (pathParts.length > 1 ? pathParts[0] : '');
    const sNum = parseInt(xMatch[2], 10);
    const eNum = parseInt(xMatch[3], 10);
    const rawRest = xMatch[4];
    const cleanShow = cleanSeriesShowTitle(rawShow);
    const cleanEpTitle = cleanEpisodeTitlePart(rawRest) || `Episódio ${eNum}`;
    if (cleanShow) {
      return {
        isEpisode: true,
        showTitle: cleanShow,
        seasonNumber: sNum || pathSeason || 1,
        episodeNumber: eNum,
        episodeTitle: cleanEpTitle,
        rawEpisodeToken: `${sNum}x${eNum < 10 ? '0' + eNum : eNum}`,
      };
    }
  }

  // 3. Season X Episode Y / Temporada X Episodio Y
  const seasonEpMatch = baseName.match(/(.*?)(?:^|[\s._\-\[])(?:temporada|season)\s*(\d{1,2})[\s\S]*?(?:episodio|episódio|ep|episode)\s*(\d{1,3})(.*)/i);
  if (seasonEpMatch) {
    const rawShow = seasonEpMatch[1] || (pathParts.length > 1 ? pathParts[0] : '');
    const sNum = parseInt(seasonEpMatch[2], 10);
    const eNum = parseInt(seasonEpMatch[3], 10);
    const rawRest = seasonEpMatch[4];
    const cleanShow = cleanSeriesShowTitle(rawShow);
    const cleanEpTitle = cleanEpisodeTitlePart(rawRest) || `Episódio ${eNum}`;
    if (cleanShow) {
      return {
        isEpisode: true,
        showTitle: cleanShow,
        seasonNumber: sNum || pathSeason || 1,
        episodeNumber: eNum,
        episodeTitle: cleanEpTitle,
        rawEpisodeToken: `T${sNum}E${eNum}`,
      };
    }
  }

  // 4. E02 / EP02 / Episodio 02 / Episode 02
  const epOnlyMatch = baseName.match(/(.*?)(?:^|[\s._\-\[])(?:[Ee][Pp]?|episodio|episódio|episode)\s*[-_.]?\s*(\d{1,4})(.*)/i);
  if (epOnlyMatch) {
    const rawShow = epOnlyMatch[1] || (pathParts.length > 1 ? pathParts[0] : '');
    const eNum = parseInt(epOnlyMatch[2], 10);
    const rawRest = epOnlyMatch[3];
    const cleanShow = cleanSeriesShowTitle(rawShow);
    const cleanEpTitle = cleanEpisodeTitlePart(rawRest) || `Episódio ${eNum}`;
    if (cleanShow) {
      return {
        isEpisode: true,
        showTitle: cleanShow,
        seasonNumber: pathSeason || 1,
        episodeNumber: eNum,
        episodeTitle: cleanEpTitle,
        rawEpisodeToken: `E${eNum}`,
      };
    }
  }

  // 5. [Group] Show Name - 04 [1080p] or Show Name - 04
  const dashMatch = baseName.match(/^(?:\[[^\]]+\]\s*)?(.*?)\s*-\s*(\d{1,4})(?:[\s._\-\[].*)?$/);
  if (dashMatch) {
    const rawShow = dashMatch[1];
    const eNum = parseInt(dashMatch[2], 10);
    const cleanShow = cleanSeriesShowTitle(rawShow);
    if (cleanShow && eNum > 0 && eNum < 2500) {
      return {
        isEpisode: true,
        showTitle: cleanShow,
        seasonNumber: pathSeason || 1,
        episodeNumber: eNum,
        episodeTitle: `Episódio ${eNum}`,
        rawEpisodeToken: `-${eNum}`,
      };
    }
  }

  // 6. Leading number "01 - Pilot" or "01. Title"
  const leadingNumMatch = baseName.match(/^(\d{1,3})[\s\.\-_]+(.*)/);
  if (leadingNumMatch && pathParts.length > 1) {
    const eNum = parseInt(leadingNumMatch[1], 10);
    const rawShow = pathParts[0];
    const cleanShow = cleanSeriesShowTitle(rawShow);
    if (cleanShow && eNum > 0) {
      return {
        isEpisode: true,
        showTitle: cleanShow,
        seasonNumber: pathSeason || 1,
        episodeNumber: eNum,
        episodeTitle: cleanEpisodeTitlePart(leadingNumMatch[2]) || `Episódio ${eNum}`,
        rawEpisodeToken: `${eNum}`,
      };
    }
  }

  // Fallback: not a recognized episode pattern
  return {
    isEpisode: false,
    showTitle: cleanSeriesShowTitle(baseName) || baseName,
    seasonNumber: pathSeason || 1,
    episodeNumber: 1,
    episodeTitle: '',
  };
}

export function normalizeSearchTitle(title: string): string {
  if (!title) return '';
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\[\(].*?[\]\)]/g, ' ')
    .replace(/(?:[Ss]eason\s*\d*|[Tt]emporada\s*\d*|[Cc]omplete\s*[Ss]eries|[Cc]omplete|[Ee]pisode\s*\d*(?:\s*[-x]\s*\d+)?|[Ee]pisodio\s*\d*(?:\s*[-x]\s*\d+)?|[Ee]\d{1,4}(?:\s*[-xEe]\s*\d{1,4})?|[Ss]\d{1,2}(?:[-x][Ss]?\d{1,2})?|\d{1,2}[xX]\d{1,3})/gi, ' ')
    .replace(/\b\d+\s*(?:[ªº]|a\b|o\b)/gi, ' ')
    .replace(/\b(?:temp|vol|pt|part|parte)\s*\d*\b/gi, ' ')
    .replace(/\b(?:19|20)\d{2}\b/gi, ' ')
    .replace(/(?:2160p|1080p|720p|480p|4k|bluray|brrip|webrip|web-dl|webdl|hdtv|x264|x265|hevc|avc|aac|dts|ddp|ac3|yify|yts|eztv|tgx|rarbg|galaxytv|dual|dublado|legendado|multi)/gi, ' ')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isTorrentSample(fileNameOrPath: string, length?: number, maxLenInTorrent?: number): boolean {
  const norm = fileNameOrPath.toLowerCase().replace(/\\/g, '/');
  if (/(?:^|[\/._\-\[])(?:sample|trailer|featurette|extras?|bonus|promo|preview)(?:[\/._\-\]]|\.mp4|\.mkv|\.avi)/i.test(norm)) {
    return true;
  }
  if (length && maxLenInTorrent && length < 80 * 1024 * 1024 && maxLenInTorrent > 300 * 1024 * 1024) {
    return true;
  }
  return false;
}

export function updateMediaKind(mediaIdOrHash: string, newKind: MediaKind): MediaItem | undefined {
  const lib = readLibrary();
  const cleanKey = mediaIdOrHash.toLowerCase().trim();
  const media = lib.items.find(
    (i) =>
      i.id === mediaIdOrHash ||
      i.id.toLowerCase() === cleanKey ||
      i.id === `torrent_${cleanKey}` ||
      (i.infoHash && i.infoHash.toLowerCase() === cleanKey) ||
      i.folderPath === `torrent://${cleanKey}`
  );
  if (!media) return undefined;

  media.kind = newKind;
  if (newKind === 'movie') {
    media.totalSeasons = 0;
    const allEpisodes = media.seasons.flatMap((s) => s.episodes);
    const mainEp = allEpisodes[0] || {
      id: `ep_${media.id}_0`,
      seasonNumber: 0,
      episodeNumber: 1,
      title: media.title,
      fileName: 'video.mp4',
      filePath: media.folderPath,
      extension: '.mp4',
      sizeBytes: 0,
      durationSeconds: 0,
      audioTracks: [],
      subtitleTracks: [],
      watched: false,
      progressSeconds: 0,
    };
    mainEp.seasonNumber = 0;
    mainEp.episodeNumber = 1;
    if (!mainEp.title || mainEp.title.startsWith('Episódio') || mainEp.title.startsWith('Vídeo')) {
      mainEp.title = media.title;
    }
    media.seasons = [
      {
        seasonNumber: 0,
        title: '',
        episodes: [mainEp],
      },
    ];
    media.totalEpisodes = 1;
  } else {
    // Series
    if (media.seasons.length === 0 || (media.seasons.length === 1 && media.seasons[0].seasonNumber === 0)) {
      if (media.seasons.length === 1) {
        media.seasons[0].seasonNumber = 1;
        media.seasons[0].title = 'Temporada 1';
        media.seasons[0].episodes.forEach((e, idx) => {
          e.seasonNumber = 1;
          e.episodeNumber = idx + 1;
        });
      }
    }
    media.totalSeasons = media.seasons.length;
    media.totalEpisodes = media.seasons.reduce((acc, s) => acc + s.episodes.length, 0);
  }

  media.updatedAt = new Date().toISOString();
  writeLibrary(lib, true);
  return media;
}

/**
 * Automatically identifies and sanitizes a media item.
 * - Series: has seasons with proper seasonNumber, title 'Temporada X', and sequential episode numbers
 * - Movie: totalSeasons = 0, seasonNumber = 0, no season titles
 */
export function sanitizeMediaClassification(item: MediaItem): boolean {
  if (!item) return false;
  let changed = false;

  if (!Array.isArray(item.seasons)) {
    item.seasons = [];
    changed = true;
  }

  // Deduplicate and cleanup ghost/placeholder episodes
  const seenPaths = new Set<string>();
  const seenTorrentKeys = new Set<string>();
  let hasRealEpisodes = false;

  for (const s of item.seasons) {
    if (Array.isArray(s?.episodes)) {
      for (const ep of s.episodes) {
        if (ep.sizeBytes && ep.sizeBytes > 0 && ep.fileName !== 'video.mp4') {
          hasRealEpisodes = true;
        }
      }
    }
  }

  for (const s of item.seasons) {
    if (!Array.isArray(s?.episodes)) {
      s.episodes = [];
      changed = true;
      continue;
    }

    const cleanEps: Episode[] = [];
    for (const ep of s.episodes) {
      if (!ep) continue;

      // Drop placeholder torrent episode if real files already exist
      if (hasRealEpisodes && ep.fileName === 'video.mp4' && (!ep.sizeBytes || ep.sizeBytes === 0)) {
        changed = true;
        continue;
      }

      // Check unique keys
      const torrentKey = ep.infoHash ? `${ep.infoHash.toLowerCase()}_${ep.fileIndex ?? 0}` : null;
      const fileKey = ep.filePath || ep.fileName;

      if (torrentKey && seenTorrentKeys.has(torrentKey)) {
        changed = true;
        continue;
      }
      if (fileKey && seenPaths.has(fileKey)) {
        changed = true;
        continue;
      }

      if (torrentKey) seenTorrentKeys.add(torrentKey);
      if (fileKey) seenPaths.add(fileKey);
      cleanEps.push(ep);
    }

    if (cleanEps.length !== s.episodes.length) {
      s.episodes = cleanEps;
      changed = true;
    }
  }

  // Count all actual video files in the item
  let totalVideos = 0;
  for (const season of item.seasons) {
    if (Array.isArray(season?.episodes)) {
      totalVideos += season.episodes.length;
    }
  }

  // Check if item has explicit series characteristics (seasons > 0, episode patterns, or explicit kind)
  const hasSeriesSeason = item.seasons.some((s) => s.seasonNumber > 0 || (s.title && s.title.toLowerCase().includes('temporada')));
  const hasSeriesEpisode = item.seasons.some((s) =>
    s.episodes.some((e) => e.seasonNumber > 0 || extractShowAndEpisode(e.fileName || e.title).isEpisode)
  );
  const titleEpisodeInfo = extractShowAndEpisode(item.title);

  const hasSeriesCharacteristics = hasSeriesSeason || hasSeriesEpisode || titleEpisodeInfo.isEpisode;
  const isActuallySeries =
    totalVideos > 1 ||
    (totalVideos === 1 && hasSeriesCharacteristics) ||
    (totalVideos === 0 && item.kind === 'series');

  const expectedKind: MediaKind = isActuallySeries ? 'series' : 'movie';
  if (item.kind !== expectedKind) {
    item.kind = expectedKind;
    changed = true;
  }

  item.totalEpisodes = totalVideos;

  if (item.kind === 'movie') {
    // FILMES NÃO TÊM TEMPORADA: totalSeasons = 0, seasonNumber = 0
    if (item.totalSeasons !== 0) {
      item.totalSeasons = 0;
      changed = true;
    }

    if (item.seasons.length > 1) {
      // Flatten all episodes into season 0
      const allEps = item.seasons.flatMap((s) => s.episodes);
      item.seasons = [
        {
          seasonNumber: 0,
          title: '',
          episodes: allEps.slice(0, 1),
        },
      ];
      item.totalEpisodes = item.seasons[0].episodes.length;
      changed = true;
    }

    for (const season of item.seasons) {
      if (season.title) {
        season.title = '';
        changed = true;
      }
      if (season.seasonNumber !== 0) {
        season.seasonNumber = 0;
        changed = true;
      }
      for (const ep of season.episodes) {
        if (ep.seasonNumber !== 0) {
          ep.seasonNumber = 0;
          changed = true;
        }
        if (ep.episodeNumber !== 1) {
          ep.episodeNumber = 1;
          changed = true;
        }
        if (
          !ep.title ||
          ep.title.toLowerCase().startsWith('episódio') ||
          ep.title.toLowerCase().startsWith('episodio') ||
          ep.title.toLowerCase().startsWith('vídeo') ||
          ep.title.toLowerCase().startsWith('video')
        ) {
          if (item.title) {
            ep.title = item.title;
            changed = true;
          }
        }
      }
    }
  } else {
    // SÉRIES: têm temporadas e episódios
    const validSeasons = item.seasons.filter((s) => s && Array.isArray(s.episodes) && s.episodes.length > 0);
    if (validSeasons.length !== item.seasons.length) {
      item.seasons = validSeasons;
      changed = true;
    }

    // Ensure at least 1 valid season for series
    if (validSeasons.length === 0 && item.seasons.length > 0) {
      validSeasons.push({
        seasonNumber: 1,
        title: 'Temporada 1',
        episodes: item.seasons.flatMap((s) => s.episodes),
      });
      item.seasons = validSeasons;
      changed = true;
    }

    validSeasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
    validSeasons.forEach((s, idx) => {
      const properNum = s.seasonNumber > 0 ? s.seasonNumber : idx + 1;
      if (s.seasonNumber !== properNum) {
        s.seasonNumber = properNum;
        changed = true;
      }
      const properTitle = `Temporada ${properNum}`;
      if (s.title !== properTitle) {
        s.title = properTitle;
        changed = true;
      }

      s.episodes.forEach((ep, epIdx) => {
        if (ep.seasonNumber !== properNum) {
          ep.seasonNumber = properNum;
          changed = true;
        }
        if (!ep.episodeNumber || ep.episodeNumber <= 0) {
          ep.episodeNumber = epIdx + 1;
          changed = true;
        }
      });
      s.episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
    });

    const expectedSeasonsCount = validSeasons.length;
    if (item.totalSeasons !== expectedSeasonsCount) {
      item.totalSeasons = expectedSeasonsCount;
      changed = true;
    }
  }

  return changed;
}

function deduplicateSeriesInLibrary(lib: LibraryData): boolean {
  let changed = false;

  // Step 1: Pre-process all items to detect any TV series / episode patterns
  for (const item of lib.items) {
    // Check if title or any episode inside has a TV series pattern
    const titleInfo = extractShowAndEpisode(item.title);
    let anyEpIsSeries = false;

    for (const season of item.seasons || []) {
      for (const ep of season.episodes || []) {
        const epInfo = extractShowAndEpisode(ep.fileName || ep.filePath || ep.title);
        if (epInfo.isEpisode) {
          anyEpIsSeries = true;
          if (ep.seasonNumber === 0 && epInfo.seasonNumber > 0) {
            ep.seasonNumber = epInfo.seasonNumber;
            changed = true;
          }
          if (epInfo.episodeNumber > 0 && (!ep.episodeNumber || ep.episodeNumber === 1 || ep.episodeNumber !== epInfo.episodeNumber)) {
            ep.episodeNumber = epInfo.episodeNumber;
            changed = true;
          }
          if (epInfo.episodeTitle && (!ep.title || ep.title.startsWith('Episódio') || ep.title.startsWith('Vídeo'))) {
            ep.title = epInfo.episodeTitle;
            changed = true;
          }
        }
      }
    }

    if (titleInfo.isEpisode || anyEpIsSeries) {
      if (item.kind !== 'series') {
        item.kind = 'series';
        changed = true;
      }
      if (titleInfo.isEpisode && titleInfo.showTitle && !item.customTitle) {
        if (item.title !== titleInfo.showTitle) {
          item.title = titleInfo.showTitle;
          changed = true;
        }
      }
    }

    if (sanitizeMediaClassification(item)) {
      changed = true;
    }
  }

  // Step 2: Merge items that belong to the same TV series
  const mergedItems: MediaItem[] = [];

  for (const item of lib.items) {
    if (item.kind !== 'series') {
      mergedItems.push(item);
      continue;
    }

    const normKey = normalizeSearchTitle(item.title);
    if (!normKey) {
      mergedItems.push(item);
      continue;
    }

    const targetIdx = mergedItems.findIndex((m) => {
      if (m.kind !== 'series') return false;
      if (item.tmdbId && m.tmdbId && item.tmdbId === m.tmdbId) return true;
      const mNorm = normalizeSearchTitle(m.title);
      return mNorm === normKey;
    });

    if (targetIdx >= 0) {
      const target = mergedItems[targetIdx];
      changed = true;

      if (!target.backdropPath && item.backdropPath) target.backdropPath = item.backdropPath;
      if (!target.posterPath && item.posterPath) target.posterPath = item.posterPath;
      if (!target.overview && item.overview) target.overview = item.overview;
      if (!target.tmdbId && item.tmdbId) target.tmdbId = item.tmdbId;

      for (const itemSeason of item.seasons) {
        const sNum = itemSeason.seasonNumber > 0 ? itemSeason.seasonNumber : 1;
        let targetSeason = target.seasons.find((s) => s.seasonNumber === sNum);
        if (!targetSeason) {
          targetSeason = {
            seasonNumber: sNum,
            title: `Temporada ${sNum}`,
            episodes: [],
          };
          target.seasons.push(targetSeason);
        }

        for (const ep of itemSeason.episodes) {
          ep.seasonNumber = sNum;
          const existingEp = targetSeason.episodes.find(
            (e) =>
              (e.episodeNumber === ep.episodeNumber && e.episodeNumber > 0) ||
              (ep.infoHash && e.infoHash && e.infoHash.toLowerCase() === ep.infoHash.toLowerCase() && e.fileIndex === ep.fileIndex) ||
              e.id === ep.id
          );
          if (existingEp) {
            if (ep.isTorrent) {
              existingEp.isTorrent = true;
              if (ep.infoHash) existingEp.infoHash = ep.infoHash;
              if (ep.magnetUri) existingEp.magnetUri = ep.magnetUri;
              if (ep.fileIndex !== undefined) existingEp.fileIndex = ep.fileIndex;
              if (ep.filePath) existingEp.filePath = ep.filePath;
            }
            if (ep.watched) existingEp.watched = true;
            if (ep.progressSeconds > existingEp.progressSeconds) {
              existingEp.progressSeconds = ep.progressSeconds;
              existingEp.durationSeconds = ep.durationSeconds || existingEp.durationSeconds;
            }
          } else {
            targetSeason.episodes.push(ep);
          }
        }
      }

      sanitizeMediaClassification(target);
    } else {
      mergedItems.push(item);
    }
  }

  if (mergedItems.length !== lib.items.length) {
    changed = true;
  }

  if (changed) {
    lib.items = mergedItems;
  }
  return changed;
}

const TORRENT_VIDEO_EXTS = new Set(['.mp4', '.mkv', '.avi', '.webm', '.mov', '.m4v', '.wmv', '.flv', '.ts']);

export function saveTorrentMediaItem(params: {
  infoHash: string;
  magnetUri: string;
  name?: string;
  files?: Array<{ name: string; path?: string; length: number; index: number }>;
  totalBytes?: number;
  selectedFileIndex?: number;
}): MediaItem {
  const lib = readLibrary();
  deduplicateSeriesInLibrary(lib);

  const cleanHash = params.infoHash.toLowerCase();
  const mediaId = `torrent_${cleanHash}`;
  const now = new Date().toISOString();

  const rawFiles = params.files || [];
  const maxFileLen = rawFiles.reduce((acc, f) => Math.max(acc, f.length || 0), 0);
  const videoFiles = rawFiles.filter((f) => {
    const ext = path.extname(f.name || f.path || '').toLowerCase();
    if (!TORRENT_VIDEO_EXTS.has(ext)) return false;
    if (rawFiles.length > 1 && isTorrentSample(f.name || f.path || '', f.length, maxFileLen)) {
      return false;
    }
    return true;
  });

  const displayFiles = videoFiles.length > 0 ? videoFiles : rawFiles.filter((f) => TORRENT_VIDEO_EXTS.has(path.extname(f.name || f.path || '').toLowerCase()));

  const rawTorrentName = params.name || `Torrent ${cleanHash.slice(0, 8)}`;
  const parsedTorrentTitle = extractShowAndEpisode(rawTorrentName);

  // Check if any file inside has an episode pattern
  const fileParsedList = displayFiles.map((f, idx) => {
    const parsedFile = extractShowAndEpisode(f.path || f.name);
    return {
      file: f,
      index: f.index ?? idx,
      parsed: parsedFile,
    };
  });

  const anyFileIsEpisode = fileParsedList.some((item) => item.parsed.isEpisode);
  const isSeriesTorrent =
    parsedTorrentTitle.isEpisode ||
    anyFileIsEpisode ||
    displayFiles.length > 1;

  // Determine canonical series / movie title
  const cleanTitle =
    (isSeriesTorrent && parsedTorrentTitle.showTitle) ||
    (fileParsedList[0]?.parsed.isEpisode && fileParsedList[0].parsed.showTitle) ||
    cleanSeriesShowTitle(rawTorrentName) ||
    rawTorrentName;

  const normalizedTitleKey = normalizeSearchTitle(cleanTitle);

  // Look for an existing media item to merge with
  let existingIndex = lib.items.findIndex((item) => {
    if (item.id === mediaId) return true;
    if (item.infoHash && item.infoHash.toLowerCase() === cleanHash) return true;
    const itemNorm = normalizeSearchTitle(item.title);
    if (normalizedTitleKey && itemNorm && itemNorm === normalizedTitleKey) return true;
    return false;
  });

  const existing = existingIndex >= 0 ? lib.items[existingIndex] : undefined;

  if (isSeriesTorrent) {
    // ==========================================
    // SERIES HANDLING (Single or Multiple Episodes)
    // ==========================================
    const episodesToAdd: Episode[] = [];

    if (displayFiles.length === 0) {
      // Placeholder episode before torrent metadata finishes downloading
      const sNum = parsedTorrentTitle.seasonNumber || 1;
      const eNum = parsedTorrentTitle.episodeNumber || 1;
      const epId = `ep_torrent_${cleanHash}_0`;

      episodesToAdd.push({
        id: epId,
        seasonNumber: sNum,
        episodeNumber: eNum,
        title: parsedTorrentTitle.episodeTitle || cleanTitle || `Episódio ${eNum}`,
        fileName: rawTorrentName || 'video.mp4',
        filePath: `torrent://${cleanHash}/0`,
        extension: '.mp4',
        sizeBytes: params.totalBytes || 0,
        durationSeconds: 0,
        audioTracks: [],
        subtitleTracks: [],
        watched: false,
        progressSeconds: 0,
        isTorrent: true,
        fileIndex: 0,
        magnetUri: params.magnetUri,
        infoHash: cleanHash,
      });
    } else {
      fileParsedList.forEach((it, idx) => {
        const sNum = it.parsed.isEpisode ? it.parsed.seasonNumber : (parsedTorrentTitle.seasonNumber || 1);
        const eNum = it.parsed.isEpisode ? it.parsed.episodeNumber : (parsedTorrentTitle.episodeNumber && displayFiles.length === 1 ? parsedTorrentTitle.episodeNumber : idx + 1);
        const epTitle = (it.parsed.isEpisode && it.parsed.episodeTitle) || (parsedTorrentTitle.episodeTitle && displayFiles.length === 1 ? parsedTorrentTitle.episodeTitle : `Episódio ${eNum}`);
        const epId = `ep_torrent_${cleanHash}_${it.index}`;

        episodesToAdd.push({
          id: epId,
          seasonNumber: sNum,
          episodeNumber: eNum,
          title: epTitle,
          fileName: it.file.name,
          filePath: `torrent://${cleanHash}/${it.index}`,
          extension: path.extname(it.file.name).toLowerCase() || '.mp4',
          sizeBytes: it.file.length || 0,
          durationSeconds: 0,
          audioTracks: [],
          subtitleTracks: [],
          watched: false,
          progressSeconds: 0,
          isTorrent: true,
          fileIndex: it.index,
          magnetUri: params.magnetUri,
          infoHash: cleanHash,
        });
      });
    }

    let targetItem: MediaItem;

    if (existing) {
      targetItem = existing;
      targetItem.kind = 'series';
      targetItem.title = targetItem.customTitle || cleanTitle || targetItem.title;
      targetItem.updatedAt = now;

      // Merge episodes into existing seasons
      for (const newEp of episodesToAdd) {
        let seasonObj = targetItem.seasons.find((s) => s.seasonNumber === newEp.seasonNumber);
        if (!seasonObj) {
          seasonObj = {
            seasonNumber: newEp.seasonNumber,
            title: `Temporada ${newEp.seasonNumber}`,
            episodes: [],
          };
          targetItem.seasons.push(seasonObj);
        }

        const existingEpIdx = seasonObj.episodes.findIndex(
          (e) =>
            (e.episodeNumber === newEp.episodeNumber && e.episodeNumber > 0) ||
            (e.infoHash?.toLowerCase() === cleanHash && e.fileIndex === newEp.fileIndex) ||
            e.id === newEp.id
        );

        if (existingEpIdx >= 0) {
          const oldEp = seasonObj.episodes[existingEpIdx];
          seasonObj.episodes[existingEpIdx] = {
            ...oldEp,
            ...newEp,
            durationSeconds: oldEp.durationSeconds || newEp.durationSeconds,
            progressSeconds: oldEp.progressSeconds || newEp.progressSeconds,
            watched: oldEp.watched || newEp.watched,
            selectedAudioIndex: oldEp.selectedAudioIndex,
            selectedSubtitleIndex: oldEp.selectedSubtitleIndex,
            subtitleTracks: [...(newEp.subtitleTracks || []), ...(oldEp.subtitleTracks || []).filter((t) => t.isImported)],
          };
        } else {
          seasonObj.episodes.push(newEp);
        }
      }
    } else {
      // Group new episodes into seasons
      const seasonMap = new Map<number, Episode[]>();
      for (const ep of episodesToAdd) {
        if (!seasonMap.has(ep.seasonNumber)) {
          seasonMap.set(ep.seasonNumber, []);
        }
        seasonMap.get(ep.seasonNumber)!.push(ep);
      }

      const seasons: Season[] = Array.from(seasonMap.entries()).map(([sNum, eps]) => ({
        seasonNumber: sNum,
        title: `Temporada ${sNum}`,
        episodes: eps,
      }));

      targetItem = {
        id: mediaId,
        title: cleanTitle,
        kind: 'series',
        folderPath: `torrent://${cleanHash}`,
        isTorrent: true,
        magnetUri: params.magnetUri,
        infoHash: cleanHash,
        totalEpisodes: episodesToAdd.length,
        totalSeasons: seasons.length,
        seasons,
        createdAt: now,
        updatedAt: now,
      };

      lib.items.unshift(targetItem);
    }

    sanitizeMediaClassification(targetItem);
    writeLibrary(lib, true);
    return targetItem;
  }

  // ==========================================
  // MOVIE HANDLING (Single Video File without Season/Episode pattern)
  // ==========================================
  const f = displayFiles[0] || { name: rawTorrentName, length: params.totalBytes || 0, index: 0 };
  const epId = `ep_torrent_${cleanHash}_${f.index ?? 0}`;

  let prevProgress = 0;
  let prevDuration = 0;
  let prevWatched = false;
  if (existing) {
    for (const s of existing.seasons) {
      for (const e of s.episodes) {
        if (e.progressSeconds > prevProgress) prevProgress = e.progressSeconds;
        if (e.durationSeconds > prevDuration) prevDuration = e.durationSeconds;
        if (e.watched) prevWatched = true;
      }
    }
  }

  const singleEp: Episode = {
    id: epId,
    seasonNumber: 0,
    episodeNumber: 1,
    title: existing?.customTitle || cleanTitle,
    fileName: f.name,
    filePath: `torrent://${cleanHash}/${f.index ?? 0}`,
    extension: path.extname(f.name).toLowerCase() || '.mp4',
    sizeBytes: f.length || params.totalBytes || 0,
    durationSeconds: prevDuration,
    audioTracks: [],
    subtitleTracks: [],
    watched: prevWatched,
    progressSeconds: prevProgress,
    isTorrent: true,
    fileIndex: f.index ?? 0,
    magnetUri: params.magnetUri,
    infoHash: cleanHash,
  };

  const movieSeasons: Season[] = [
    {
      seasonNumber: 0,
      title: '',
      episodes: [singleEp],
    },
  ];

  let itemToReturn: MediaItem;

  if (existing) {
    existing.title = existing.customTitle || existing.title || cleanTitle;
    existing.folderPath = existing.folderPath || `torrent://${cleanHash}`;
    existing.magnetUri = params.magnetUri || existing.magnetUri;
    existing.infoHash = cleanHash;
    existing.isTorrent = true;
    existing.kind = 'movie';
    existing.seasons = movieSeasons;
    existing.totalEpisodes = 1;
    existing.totalSeasons = 0;
    existing.updatedAt = now;
    sanitizeMediaClassification(existing);
    itemToReturn = existing;
  } else {
    itemToReturn = {
      id: mediaId,
      title: cleanTitle,
      kind: 'movie',
      folderPath: `torrent://${cleanHash}`,
      isTorrent: true,
      magnetUri: params.magnetUri,
      infoHash: cleanHash,
      totalEpisodes: 1,
      totalSeasons: 0,
      seasons: movieSeasons,
      createdAt: now,
      updatedAt: now,
    };
    sanitizeMediaClassification(itemToReturn);
    lib.items.unshift(itemToReturn);
  }

  writeLibrary(lib, true);
  return itemToReturn;
}

export function updateTorrentProgressInLibrary(
  infoHash: string,
  selectedFileIndex: number,
  progressSeconds: number,
  durationSeconds?: number
): boolean {
  const lib = readLibrary();
  const cleanHash = infoHash.toLowerCase();

  let found = false;
  const now = new Date().toISOString();

  for (const media of lib.items) {
    for (const season of media.seasons) {
      for (const ep of season.episodes) {
        if (
          (ep.infoHash && ep.infoHash.toLowerCase() === cleanHash && ep.fileIndex === selectedFileIndex) ||
          (media.infoHash && media.infoHash.toLowerCase() === cleanHash && ep.fileIndex === selectedFileIndex) ||
          ep.id === `ep_torrent_${cleanHash}_${selectedFileIndex}`
        ) {
          ep.progressSeconds = Math.max(0, Math.floor(progressSeconds));
          if (durationSeconds && durationSeconds > 0) {
            ep.durationSeconds = Math.floor(durationSeconds);
          }
          if (ep.durationSeconds > 0 && ep.progressSeconds >= ep.durationSeconds * 0.9) {
            ep.watched = true;
          }
          ep.lastWatchedAt = now;
          media.lastWatchedEpisodeId = ep.id;
          media.lastWatchedAt = now;
          media.updatedAt = now;
          found = true;
          break;
        }
      }
      if (found) break;
    }
    if (found) break;
  }

  if (found) {
    writeLibrary(lib);
  }
  return found;
}

export function removeTorrentFromLibrary(infoHash: string): boolean {
  const lib = readLibrary();
  const cleanHash = infoHash.toLowerCase();

  let changed = false;
  const updatedItems: MediaItem[] = [];

  for (const item of lib.items) {
    if (item.id === `torrent_${cleanHash}` && (!item.seasons || item.seasons.length === 0)) {
      changed = true;
      continue;
    }

    if (item.kind === 'series') {
      let itemModified = false;
      for (const season of item.seasons) {
        const initialCount = season.episodes.length;
        season.episodes = season.episodes.filter((ep) => ep.infoHash?.toLowerCase() !== cleanHash);
        if (season.episodes.length !== initialCount) {
          itemModified = true;
        }
      }
      item.seasons = item.seasons.filter((s) => s.episodes.length > 0);
      item.totalEpisodes = item.seasons.reduce((acc, s) => acc + s.episodes.length, 0);
      item.totalSeasons = item.seasons.length;

      if (itemModified) changed = true;

      if (item.isTorrent && item.totalEpisodes === 0) {
        changed = true;
        continue;
      }
    } else if (item.infoHash?.toLowerCase() === cleanHash || item.id === `torrent_${cleanHash}`) {
      changed = true;
      continue;
    }

    updatedItems.push(item);
  }

  if (changed) {
    lib.items = updatedItems;
    writeLibrary(lib, true);
    return true;
  }
  return false;
}

const IPTV_STATUS_FILE = path.join(DATA_DIR, 'iptv_status.json');
let iptvStatusCache: Record<string, { status: 'online' | 'offline'; lastChecked: string }> | null = null;

export function readIptvStatusMap(): Record<string, { status: 'online' | 'offline'; lastChecked: string }> {
  if (iptvStatusCache) return iptvStatusCache;
  try {
    if (fs.existsSync(IPTV_STATUS_FILE)) {
      const content = fs.readFileSync(IPTV_STATUS_FILE, 'utf-8');
      iptvStatusCache = JSON.parse(content);
      return iptvStatusCache || {};
    }
  } catch (err) {
    console.error('Erro ao ler iptv_status.json:', err);
  }
  iptvStatusCache = {};
  return iptvStatusCache;
}

export function saveIptvStatusMap(data: Record<string, { status: 'online' | 'offline'; lastChecked: string }>) {
  iptvStatusCache = data;
  try {
    fs.writeFileSync(IPTV_STATUS_FILE, JSON.stringify(data), 'utf-8');
  } catch (err) {
    console.error('Erro ao gravar iptv_status.json:', err);
  }
}

export async function rescanAllLibraryFolders(): Promise<{ updatedCount: number; library: LibraryData }> {
  const lib = readLibrary();
  let updatedCount = 0;

  // Process items in parallel
  await Promise.all(
    lib.items.map(async (item, i) => {
      // If torrent or virtual folder
      if (item.isTorrent || item.folderPath.startsWith('torrent://')) {
        if (sanitizeMediaClassification(item)) {
          updatedCount++;
        }
        return;
      }

      if (!fs.existsSync(item.folderPath)) {
        if (sanitizeMediaClassification(item)) {
          updatedCount++;
        }
        return;
      }

      try {
        const updatedItem = await scanMediaFolder(item.folderPath, item.customTitle);

        // Preserve watch progress, watched status, selected tracks, imported subtitles
        for (const newSeason of updatedItem.seasons) {
          const oldSeason = item.seasons?.find((s) => s.seasonNumber === newSeason.seasonNumber);
          if (oldSeason) {
            for (const newEp of newSeason.episodes) {
              const oldEp = oldSeason.episodes?.find(
                (e) => e.fileName === newEp.fileName || (e.episodeNumber === newEp.episodeNumber && e.seasonNumber === newEp.seasonNumber)
              );
              if (oldEp) {
                newEp.watched = oldEp.watched;
                newEp.progressSeconds = oldEp.progressSeconds;
                newEp.lastWatchedAt = oldEp.lastWatchedAt;
                newEp.selectedAudioIndex = oldEp.selectedAudioIndex;
                newEp.selectedSubtitleIndex = oldEp.selectedSubtitleIndex;
                newEp.subtitleTracks = [
                  ...newEp.subtitleTracks,
                  ...(oldEp.subtitleTracks || []).filter((track) => track.isImported),
                ];
              }
            }
          }
        }

        updatedItem.lastWatchedEpisodeId = item.lastWatchedEpisodeId;
        updatedItem.lastWatchedAt = item.lastWatchedAt;
        updatedItem.customTitle = item.customTitle;
        updatedItem.tmdbId = updatedItem.tmdbId || item.tmdbId;
        updatedItem.metadataProvider = updatedItem.metadataProvider || item.metadataProvider;
        updatedItem.originalTitle = updatedItem.originalTitle || item.originalTitle;
        updatedItem.year = updatedItem.year || item.year;
        updatedItem.overview = updatedItem.overview || item.overview;
        updatedItem.tagline = updatedItem.tagline || item.tagline;
        updatedItem.genres = updatedItem.genres?.length ? updatedItem.genres : item.genres;
        updatedItem.rating = updatedItem.rating ?? item.rating;
        updatedItem.voteCount = updatedItem.voteCount ?? item.voteCount;
        updatedItem.cast = updatedItem.cast?.length ? updatedItem.cast : item.cast;

        if (item.backdropPath && !updatedItem.backdropPath) {
          updatedItem.backdropPath = item.backdropPath;
        }
        if (item.posterPath && !updatedItem.posterPath) {
          updatedItem.posterPath = item.posterPath;
        }

        lib.items[i] = updatedItem;
        updatedCount++;
      } catch (err) {
        console.warn(`[Auto-rescan] Falha ao re-escanear pasta "${item.folderPath}":`, err);
        if (sanitizeMediaClassification(item)) {
          updatedCount++;
        }
      }
    })
  );

  deduplicateSeriesInLibrary(lib);
  writeLibrary(lib, true);
  return { updatedCount, library: lib };
}



