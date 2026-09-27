import { MediaItem, Season, Episode, MediaKind, SubtitleTrackInfo, LibraryData } from '../types';
import { clientFileRegistry } from './clientFileRegistry';
import { saveDirectoryHandle, saveClientLibrary } from './clientStorage';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.webm', '.mov', '.m4v', '.ts', '.flv', '.wmv']);
const SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt', '.ass', '.ssa']);
const POSTER_NAMES = new Set([
  'poster.jpg', 'poster.jpeg', 'poster.png', 'poster.webp',
  'folder.jpg', 'folder.jpeg', 'folder.png', 'folder.webp',
  'cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp',
  'capa.jpg', 'capa.jpeg', 'capa.png', 'capa.webp',
]);
const BACKDROP_NAMES = new Set([
  'backdrop.jpg', 'backdrop.jpeg', 'backdrop.png', 'backdrop.webp',
  'fanart.jpg', 'fanart.jpeg', 'fanart.png', 'fanart.webp',
  'banner.jpg', 'banner.jpeg', 'banner.png', 'banner.webp',
]);

interface DiscoveredFile {
  name: string;
  relativePath: string;
  handle: FileSystemFileHandle;
  size: number;
}

function cleanEpisodeTitle(rawName: string, matchedToken: string): string {
  let cleaned = rawName;
  if (matchedToken) {
    const idx = cleaned.indexOf(matchedToken);
    if (idx >= 0) {
      cleaned = cleaned.substring(idx + matchedToken.length);
    }
  }

  cleaned = cleaned
    .replace(/[\[\(].*?[\]\)]/g, ' ')
    .replace(/\b(?:2160p|1080p|720p|480p|4k|bluray|brrip|webrip|web-dl|webdl|hdtv|x264|x265|hevc|avc|aac|dts|ddp|ac3|yify|yts|eztv|tgx|rarbg|galaxytv|dual|dublado|legendado|multi|ita|eng|por)\b/gi, ' ')
    .replace(/[\._]/g, ' ')
    .replace(/^[-\s.:]+|[-\s.:]+$/g, '')
    .trim();

  return cleaned;
}

export function parseEpisodeInfo(
  fileNameOrPath: string,
  fallbackIndex: number,
  pathSeasonHint?: number
): { seasonNumber: number; episodeNumber: number; cleanTitle: string } {
  const parts = fileNameOrPath.replace(/\\/g, '/').split('/').filter(Boolean);
  const fileName = parts[parts.length - 1] || fileNameOrPath;
  const nameWithoutExt = fileName.replace(/\.[^/.]+$/, '');

  let pathSeason = pathSeasonHint;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const sMatch = part.match(/(?:temporada|season|s)\s*(\d{1,2})/i);
    if (sMatch) {
      const parsedS = parseInt(sMatch[1], 10);
      if (parsedS > 0 && parsedS < 100) {
        pathSeason = parsedS;
      }
    }
  }

  // 1. S01E02
  const sxxExxMatch = nameWithoutExt.match(/[Ss](\d{1,2})[\.\s_-]*[Ee](\d{1,3})/);
  if (sxxExxMatch) {
    const season = parseInt(sxxExxMatch[1], 10);
    const episode = parseInt(sxxExxMatch[2], 10);
    return {
      seasonNumber: season || pathSeason || 1,
      episodeNumber: episode,
      cleanTitle: cleanEpisodeTitle(nameWithoutExt, sxxExxMatch[0]) || `Episódio ${episode}`,
    };
  }

  // 2. 1x02
  const xMatch = nameWithoutExt.match(/(?:^|[\s._\-\[])(\d{1,2})[xX](\d{1,3})/);
  if (xMatch) {
    const season = parseInt(xMatch[1], 10);
    const episode = parseInt(xMatch[2], 10);
    return {
      seasonNumber: season || pathSeason || 1,
      episodeNumber: episode,
      cleanTitle: cleanEpisodeTitle(nameWithoutExt, xMatch[0]) || `Episódio ${episode}`,
    };
  }

  // 3. Temporada X Episodio Y
  const seasonEpMatch = nameWithoutExt.match(/(?:temporada|season)\s*(\d{1,2})[\s\S]*?(?:episodio|episódio|ep|episode)\s*(\d{1,3})/i);
  if (seasonEpMatch) {
    return {
      seasonNumber: parseInt(seasonEpMatch[1], 10) || pathSeason || 1,
      episodeNumber: parseInt(seasonEpMatch[2], 10),
      cleanTitle: cleanEpisodeTitle(nameWithoutExt, seasonEpMatch[0]) || `Episódio ${seasonEpMatch[2]}`,
    };
  }

  // 4. E02 / EP02
  const epOnlyMatch = nameWithoutExt.match(/(?:^|[\s._\-\[])(?:[Ee][Pp]?|episodio|episódio)\s*[-_.]?\s*(\d{1,3})/i);
  if (epOnlyMatch) {
    const epNum = parseInt(epOnlyMatch[1], 10);
    return {
      seasonNumber: pathSeason || 1,
      episodeNumber: epNum,
      cleanTitle: cleanEpisodeTitle(nameWithoutExt, epOnlyMatch[0]) || `Episódio ${epNum}`,
    };
  }

  // 5. Anime " - 01"
  const animeMatch = nameWithoutExt.match(/(?:^|[\s._\-\]])-\s*(\d{1,3})(?:[\s._\-\[]|$)/);
  if (animeMatch) {
    const epNum = parseInt(animeMatch[1], 10);
    return {
      seasonNumber: pathSeason || 1,
      episodeNumber: epNum,
      cleanTitle: cleanEpisodeTitle(nameWithoutExt, animeMatch[0]) || `Episódio ${epNum}`,
    };
  }

  // 6. Leading number
  const leadingNumMatch = nameWithoutExt.match(/^(\d{1,3})[\s\.\-_]*(.*)/);
  if (leadingNumMatch) {
    const epNum = parseInt(leadingNumMatch[1], 10);
    return {
      seasonNumber: pathSeason || 1,
      episodeNumber: epNum,
      cleanTitle: cleanEpisodeTitle(leadingNumMatch[2], '') || `Episódio ${epNum}`,
    };
  }

  return {
    seasonNumber: pathSeason || 1,
    episodeNumber: fallbackIndex,
    cleanTitle: cleanEpisodeTitle(nameWithoutExt, '') || `Vídeo ${fallbackIndex}`,
  };
}

async function collectAllFiles(
  dirHandle: FileSystemDirectoryHandle,
  currentPath = '',
  maxDepth = 5
): Promise<{
  videos: DiscoveredFile[];
  subtitles: DiscoveredFile[];
  posters: FileSystemFileHandle[];
  backdrops: FileSystemFileHandle[];
  libraryJsonHandle: FileSystemFileHandle | null;
}> {
  const videos: DiscoveredFile[] = [];
  const subtitles: DiscoveredFile[] = [];
  const posters: FileSystemFileHandle[] = [];
  const backdrops: FileSystemFileHandle[] = [];
  let libraryJsonHandle: FileSystemFileHandle | null = null;

  async function traverse(dir: FileSystemDirectoryHandle, pathPrefix: string, depth: number) {
    if (depth > maxDepth) return;

    for await (const [name, handle] of (dir as any).entries()) {
      const relPath = pathPrefix ? `${pathPrefix}/${name}` : name;

      if (handle.kind === 'directory') {
        await traverse(handle, relPath, depth + 1);
      } else if (handle.kind === 'file') {
        const lowerName = name.toLowerCase();
        const ext = lowerName.slice(lowerName.lastIndexOf('.'));

        if (lowerName === 'library.json' && depth === 0) {
          libraryJsonHandle = handle;
        } else if (POSTER_NAMES.has(lowerName)) {
          posters.push(handle);
        } else if (BACKDROP_NAMES.has(lowerName)) {
          backdrops.push(handle);
        } else if (VIDEO_EXTENSIONS.has(ext)) {
          try {
            const file = await handle.getFile();
            videos.push({
              name,
              relativePath: relPath,
              handle,
              size: file.size,
            });
          } catch {}
        } else if (SUBTITLE_EXTENSIONS.has(ext)) {
          try {
            const file = await handle.getFile();
            subtitles.push({
              name,
              relativePath: relPath,
              handle,
              size: file.size,
            });
          } catch {}
        }
      }
    }
  }

  await traverse(dirHandle, currentPath, 0);
  return { videos, subtitles, posters, backdrops, libraryJsonHandle };
}

function cleanMediaTitle(folderName: string): { title: string; year?: number } {
  let cleaned = folderName;
  let year: number | undefined;

  const yearMatch = cleaned.match(/[\(\[\s._-]((?:19|20)\d{2})[\)\]\s._-]?/);
  if (yearMatch) {
    year = parseInt(yearMatch[1], 10);
    cleaned = cleaned.substring(0, yearMatch.index);
  }

  cleaned = cleaned
    .replace(/[\[\(].*?[\]\)]/g, ' ')
    .replace(/\b(?:2160p|1080p|720p|480p|4k|bluray|brrip|webrip|web-dl|webdl|hdtv|x264|x265|hevc|avc|aac|dts|ddp|ac3|yify|yts|eztv|tgx|rarbg|galaxytv|dual|dublado|legendado|multi|ita|eng|por)\b/gi, ' ')
    .replace(/[\._]/g, ' ')
    .replace(/^[-\s.:]+|[-\s.:]+$/g, '')
    .trim();

  return { title: cleaned || folderName, year };
}

export async function scanDirectoryHandle(
  dirHandle: FileSystemDirectoryHandle,
  existingLibrary?: LibraryData | null,
  onProgress?: (msg: string) => void
): Promise<{ mediaItem: MediaItem; updatedLibrary: LibraryData }> {
  onProgress?.(`Escaneando pasta "${dirHandle.name}"...`);

  const { videos, subtitles, posters, backdrops, libraryJsonHandle } =
    await collectAllFiles(dirHandle);

  if (videos.length === 0) {
    throw new Error(`Nenhum arquivo de vídeo suportado encontrado na pasta "${dirHandle.name}".`);
  }

  // Check if library.json already exists in the directory handle
  let storedLibraryData: LibraryData | null = null;
  if (libraryJsonHandle) {
    try {
      const file = await libraryJsonHandle.getFile();
      const text = await file.text();
      storedLibraryData = JSON.parse(text) as LibraryData;
    } catch (e) {
      console.warn('[CineLocal] Falha ao ler library.json existente:', e);
    }
  }

  // Create an ID based on folder name
  const mediaId = `local-${encodeURIComponent(dirHandle.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-'))}`;
  const existingItem =
    storedLibraryData?.items.find((i) => i.id === mediaId) ||
    existingLibrary?.items.find((i) => i.id === mediaId);

  // Register Directory Handle
  clientFileRegistry.registerDirectoryHandle(mediaId, dirHandle);
  await saveDirectoryHandle(mediaId, dirHandle);

  // Poster & Backdrop image creation
  let posterPath = existingItem?.posterPath;
  let backdropPath = existingItem?.backdropPath;

  if (posters.length > 0) {
    try {
      const pFile = await posters[0].getFile();
      posterPath = URL.createObjectURL(pFile);
    } catch {}
  }
  if (backdrops.length > 0) {
    try {
      const bFile = await backdrops[0].getFile();
      backdropPath = URL.createObjectURL(bFile);
    } catch {}
  }

  const { title: parsedTitle, year } = cleanMediaTitle(dirHandle.name);
  const mediaTitle = existingItem?.title || parsedTitle;

  // Determine kind: series if multiple videos or has season/episode patterns, movie if single video
  const isSingle = videos.length === 1;
  const hasSeasonPattern = videos.some((v) => /[Ss]\d{1,2}[Ee]\d{1,3}|\d{1,2}x\d{1,3}/i.test(v.name));
  const kind: MediaKind = isSingle && !hasSeasonPattern ? 'movie' : 'series';

  // Build seasons & episodes
  const seasonMap = new Map<number, Episode[]>();

  // Sort videos naturally
  videos.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  for (let i = 0; i < videos.length; i++) {
    const v = videos[i];
    const episodeId = `${mediaId}-s-e${i + 1}-${encodeURIComponent(v.name)}`;
    const parsed = parseEpisodeInfo(v.relativePath, i + 1);

    const existingEp = existingItem?.seasons
      .flatMap((s) => s.episodes)
      .find((e) => e.fileName === v.name || e.id === episodeId);

    // Register FileHandle in memory
    clientFileRegistry.registerEpisodeHandle(episodeId, v.handle);

    // Find matching external subtitles
    const vBase = v.name.replace(/\.[^/.]+$/, '').toLowerCase();
    const matchedSubs: SubtitleTrackInfo[] = [];

    for (let sIdx = 0; sIdx < subtitles.length; sIdx++) {
      const sub = subtitles[sIdx];
      const sBase = sub.name.replace(/\.[^/.]+$/, '').toLowerCase();

      if (sBase.startsWith(vBase) || subtitles.length === 1) {
        const subId = `${episodeId}-sub-${sIdx}`;
        clientFileRegistry.registerSubtitleHandle(subId, sub.handle);

        const ext = sub.name.slice(sub.name.lastIndexOf('.')).toLowerCase().replace('.', '');
        const langSuffix = sBase.replace(vBase, '').replace(/^[\.\-_]/, '');
        matchedSubs.push({
          index: 100 + sIdx,
          streamIndex: -1,
          codec: ext,
          language: langSuffix || 'pt',
          title: langSuffix ? `Legenda (${langSuffix})` : `Legenda Local (${sub.name})`,
          isExternal: true,
          filePath: subId, // used as lookup in clientFileRegistry
        });
      }
    }

    const ext = v.name.slice(v.name.lastIndexOf('.')).toLowerCase();
    const epObj: Episode = {
      id: episodeId,
      seasonNumber: kind === 'movie' ? 1 : parsed.seasonNumber,
      episodeNumber: kind === 'movie' ? 1 : parsed.episodeNumber,
      title: kind === 'movie' ? mediaTitle : (existingEp?.title || parsed.cleanTitle),
      fileName: v.name,
      filePath: v.relativePath,
      relativeFilePath: v.relativePath,
      extension: ext,
      sizeBytes: v.size,
      durationSeconds: existingEp?.durationSeconds || 0,
      watched: existingEp?.watched || false,
      progressSeconds: existingEp?.progressSeconds || 0,
      lastWatchedAt: existingEp?.lastWatchedAt,
      selectedAudioIndex: existingEp?.selectedAudioIndex ?? 0,
      selectedSubtitleIndex: existingEp?.selectedSubtitleIndex ?? (matchedSubs.length > 0 ? 100 : -1),
      audioTracks: existingEp?.audioTracks || [{ index: 0, streamIndex: 0, codec: 'aac', title: 'Áudio Padrão' }],
      subtitleTracks: matchedSubs,
    };

    const sNum = epObj.seasonNumber;
    if (!seasonMap.has(sNum)) {
      seasonMap.set(sNum, []);
    }
    seasonMap.get(sNum)!.push(epObj);
  }

  const seasons: Season[] = Array.from(seasonMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([seasonNumber, episodes]) => {
      episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
      return {
        seasonNumber,
        title: seasonNumber === 0 ? 'Especiais' : `Temporada ${seasonNumber}`,
        episodes,
      };
    });

  const now = new Date().toISOString();
  const mediaItem: MediaItem = {
    id: mediaId,
    title: mediaTitle,
    kind,
    folderPath: `local://${dirHandle.name}`,
    relativeFolderPath: dirHandle.name,
    posterPath,
    backdropPath,
    year: existingItem?.year || year,
    overview: existingItem?.overview || (kind === 'movie' ? `Filme local: ${mediaTitle}` : `Série local com ${videos.length} episódio(s).`),
    totalEpisodes: videos.length,
    totalSeasons: seasons.length,
    seasons,
    lastWatchedEpisodeId: existingItem?.lastWatchedEpisodeId,
    lastWatchedAt: existingItem?.lastWatchedAt,
    createdAt: existingItem?.createdAt || now,
    updatedAt: now,
  };

  // Merge into updatedLibrary
  const baseLibrary: LibraryData = existingLibrary || storedLibraryData || {
    version: 1,
    updatedAt: now,
    settings: {
      preferredAudioLanguage: 'pt',
      preferredSubtitleLanguage: 'pt-br',
      autoPlayNext: true,
    },
    items: [],
  };

  const itemIndex = baseLibrary.items.findIndex((i) => i.id === mediaId);
  const updatedItems = itemIndex >= 0
    ? baseLibrary.items.map((i, idx) => (idx === itemIndex ? mediaItem : i))
    : [mediaItem, ...baseLibrary.items];

  const updatedLibrary: LibraryData = {
    ...baseLibrary,
    updatedAt: now,
    items: updatedItems,
  };

  // Cache to memory and IndexedDB
  clientFileRegistry.setInMemoryLibrary(updatedLibrary);
  await saveClientLibrary(updatedLibrary);

  // Attempt to write library.json into the folder handle for 100% portable file-based storage
  try {
    const fileHandle = await dirHandle.getFileHandle('library.json', { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(updatedLibrary, null, 2));
    await writable.close();
  } catch (err) {
    console.warn('[CineLocal] Gravação do library.json na pasta ignorada (permissão ou somente leitura):', err);
  }

  return { mediaItem, updatedLibrary };
}
