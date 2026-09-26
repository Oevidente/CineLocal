import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { MediaItem, Season, Episode, MediaKind, SubtitleTrackInfo } from '../types';
import { probeMedia, extractEmbeddedCover } from './ffmpeg';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.webm', '.mov', '.m4v', '.ts', '.flv', '.wmv']);
const SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt', '.ass', '.ssa']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const POSTER_NAMES = [
  'poster.jpg', 'poster.jpeg', 'poster.png', 'poster.webp',
  'folder.jpg', 'folder.jpeg', 'folder.png', 'folder.webp',
  'cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp',
  'capa.jpg', 'capa.jpeg', 'capa.png', 'capa.webp',
  'cartaz.jpg', 'cartaz.jpeg', 'cartaz.png', 'cartaz.webp',
];
const BACKDROP_NAMES = [
  'backdrop.jpg', 'backdrop.jpeg', 'backdrop.png', 'backdrop.webp',
  'fanart.jpg', 'fanart.jpeg', 'fanart.png', 'fanart.webp',
  'banner.jpg', 'banner.jpeg', 'banner.png', 'banner.webp',
  'fundo.jpg', 'fundo.jpeg', 'fundo.png', 'fundo.webp',
];

interface ParsedEpisodeInfo {
  seasonNumber: number;
  episodeNumber: number;
  cleanTitle: string;
}

export function parseEpisodeInfo(fileNameOrPath: string, fallbackIndex: number): ParsedEpisodeInfo {
  // Normalize slashes
  const normalizedPath = fileNameOrPath.replace(/\\/g, '/');
  const pathParts = normalizedPath.split('/').filter(Boolean);
  const fileName = pathParts[pathParts.length - 1] || fileNameOrPath;
  const nameWithoutExt = fileName.replace(/\.[^/.]+$/, '');

  // 0. Check if any directory in path indicates a Season (e.g. "Season 2", "Temporada 03", "S04")
  let pathSeason: number | undefined;
  for (let i = 0; i < pathParts.length - 1; i++) {
    const part = pathParts[i];
    const sMatch = part.match(/(?:temporada|season|s)\s*(\d{1,2})/i);
    if (sMatch) {
      const parsedS = parseInt(sMatch[1], 10);
      if (parsedS > 0 && parsedS < 100) {
        pathSeason = parsedS;
      }
    }
  }

  // 1. Match S01E02 or s1e2 or S01.E02 or S01_E02 or S01 - E02
  const sxxExxMatch = nameWithoutExt.match(/[Ss](\d{1,2})[\.\s_-]*[Ee](\d{1,3})/);
  if (sxxExxMatch) {
    const season = parseInt(sxxExxMatch[1], 10);
    const episode = parseInt(sxxExxMatch[2], 10);
    const title = cleanEpisodeTitle(nameWithoutExt, sxxExxMatch[0]);
    return {
      seasonNumber: season || pathSeason || 1,
      episodeNumber: episode,
      cleanTitle: title || `Episódio ${episode}`,
    };
  }

  // 2. Match 1x02 or 01x02
  const xMatch = nameWithoutExt.match(/(?:^|[\s._\-\[])(\d{1,2})[xX](\d{1,3})/);
  if (xMatch) {
    const season = parseInt(xMatch[1], 10);
    const episode = parseInt(xMatch[2], 10);
    const title = cleanEpisodeTitle(nameWithoutExt, xMatch[0]);
    return {
      seasonNumber: season || pathSeason || 1,
      episodeNumber: episode,
      cleanTitle: title || `Episódio ${episode}`,
    };
  }

  // 3. Match "Temporada X ... Episodio Y" or "Season X ... Episode Y"
  const seasonEpisodeMatch = nameWithoutExt.match(/(?:temporada|season)\s*(\d{1,2})[\s\S]*?(?:episodio|episódio|ep|episode)\s*(\d{1,3})/i);
  if (seasonEpisodeMatch) {
    const season = parseInt(seasonEpisodeMatch[1], 10);
    const episode = parseInt(seasonEpisodeMatch[2], 10);
    const title = cleanEpisodeTitle(nameWithoutExt, seasonEpisodeMatch[0]);
    return {
      seasonNumber: season || pathSeason || 1,
      episodeNumber: episode,
      cleanTitle: title || `Episódio ${episode}`,
    };
  }

  // 4. Match E02 or EP02 or Episodio 02
  const epOnlyMatch = nameWithoutExt.match(/(?:^|[\s._\-\[])(?:[Ee][Pp]?|episodio|episódio)\s*[-_.]?\s*(\d{1,3})/i);
  if (epOnlyMatch) {
    const episode = parseInt(epOnlyMatch[1], 10);
    const title = cleanEpisodeTitle(nameWithoutExt, epOnlyMatch[0]);
    return {
      seasonNumber: pathSeason || 1,
      episodeNumber: episode,
      cleanTitle: title || `Episódio ${episode}`,
    };
  }

  // 5. Match anime release patterns like "[Subs] Anime Title - 04 [1080p]" or "Title - 04"
  const animeMatch = nameWithoutExt.match(/(?:^|[\s._\-\]])-\s*(\d{1,3})(?:[\s._\-\[]|$)/);
  if (animeMatch) {
    const episode = parseInt(animeMatch[1], 10);
    const title = cleanEpisodeTitle(nameWithoutExt, animeMatch[0]);
    return {
      seasonNumber: pathSeason || 1,
      episodeNumber: episode,
      cleanTitle: title || `Episódio ${episode}`,
    };
  }

  // 6. Match leading number like "01 - Pilot" or "1. Pilot" or "01.mkv"
  const leadingNumMatch = nameWithoutExt.match(/^(\d{1,3})[\s\.\-_]*(.*)/);
  if (leadingNumMatch) {
    const episode = parseInt(leadingNumMatch[1], 10);
    const title = cleanEpisodeTitle(leadingNumMatch[2], '');
    return {
      seasonNumber: pathSeason || 1,
      episodeNumber: episode,
      cleanTitle: title || `Episódio ${episode}`,
    };
  }

  return {
    seasonNumber: pathSeason || 1,
    episodeNumber: fallbackIndex,
    cleanTitle: cleanEpisodeTitle(nameWithoutExt, '') || `Vídeo ${fallbackIndex}`,
  };
}

function cleanEpisodeTitle(rawName: string, matchedToken: string): string {
  let cleaned = rawName;
  if (matchedToken) {
    // Keep part after token if it exists
    const idx = cleaned.indexOf(matchedToken);
    if (idx >= 0) {
      cleaned = cleaned.substring(idx + matchedToken.length);
    }
  }

  // Clean release tags, groups, resolutions, audio codecs
  cleaned = cleaned
    .replace(/[\[\(].*?[\]\)]/g, ' ')
    .replace(/\b(?:2160p|1080p|720p|480p|4k|bluray|brrip|webrip|web-dl|webdl|hdtv|x264|x265|hevc|avc|aac|dts|ddp|ac3|yify|yts|eztv|tgx|rarbg|galaxytv|dual|dublado|legendado|multi|ita|eng|por)\b/gi, ' ')
    .replace(/[\._]/g, ' ')
    .replace(/^[-\s.:]+|[-\s.:]+$/g, '')
    .trim();

  return cleaned;
}

// Find files recursively
function getAllFiles(dirPath: string, maxDepth = 4, currentDepth = 0): string[] {
  let results: string[] = [];
  if (currentDepth > maxDepth || !fs.existsSync(dirPath)) return results;

  try {
    const list = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const item of list) {
      const fullPath = path.join(dirPath, item.name);
      if (item.isDirectory()) {
        results = results.concat(getAllFiles(fullPath, maxDepth, currentDepth + 1));
      } else {
        results.push(fullPath);
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${dirPath}:`, err);
  }

  return results;
}

// Find external subtitles matching an episode file
function findExternalSubtitles(videoPath: string, allFiles: string[]): SubtitleTrackInfo[] {
  const dir = path.dirname(videoPath);
  const baseName = path.basename(videoPath, path.extname(videoPath));
  const subTracks: SubtitleTrackInfo[] = [];

  for (const file of allFiles) {
    if (path.dirname(file) !== dir) continue;
    const ext = path.extname(file).toLowerCase();
    if (!SUBTITLE_EXTENSIONS.has(ext)) continue;

    const subBase = path.basename(file, ext);
    if (subBase.startsWith(baseName) || allFiles.length < 5) {
      // Extract language tag if present (e.g. .pt-BR, .en, .por)
      const langSuffix = subBase.replace(baseName, '').replace(/^[\.\-_]/, '');
      const lang = langSuffix || 'pt';
      const label = langSuffix ? `Legenda Externa (${langSuffix})` : 'Legenda Externa';

      subTracks.push({
        index: 100 + subTracks.length,
        streamIndex: -1,
        codec: ext.replace('.', ''),
        language: lang,
        title: label,
        isExternal: true,
        filePath: file,
      });
    }
  }

  return subTracks;
}

// Regex to identify auxiliary / promotional / sample video files
export const AUXILIARY_VIDEO_REGEX = /(^|[\._\-\s])(vinheta|intro|abertura|sample|trailer|teaser|preview|featurette|extra|bonus)([\._\-\s]|$)/i;

export function detectMediaKind(videoFiles: string[], folderPath: string): MediaKind {
  if (videoFiles.length > 1) {
    return 'series';
  }
  if (videoFiles.length === 1) {
    const vFile = videoFiles[0];
    const fileName = path.basename(vFile);
    const relPath = path.relative(folderPath, vFile).replace(/\\/g, '/');

    // Check if filename or relative path has episode / season tags
    const hasSxxExx = /[Ss]\d{1,2}[\.\s_-]*[Ee]\d{1,3}/i.test(fileName);
    const hasNxNN = /(?:^|[\s._\-\[])\d{1,2}[xX]\d{1,3}/i.test(fileName);
    const hasSeasonWord = /(?:temporada|season)\s*\d+/i.test(relPath);
    const hasEpisodeWord = /(?:episodio|episódio|ep|episode)\s*[-_.]?\s*\d+/i.test(fileName);
    const hasAnimeDash = /(?:^|[\s._\-\]])-\s*\d{1,3}(?:[\s._\-\[]|$)/.test(fileName);

    if (hasSxxExx || hasNxNN || hasSeasonWord || hasEpisodeWord || hasAnimeDash) {
      return 'series';
    }
  }
  return 'movie';
}

export async function scanMediaFolder(folderPath: string, customTitle?: string): Promise<MediaItem> {
  const resolvedPath = path.resolve(folderPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Pasta não encontrada: ${resolvedPath}`);
  }

  const allFiles = getAllFiles(resolvedPath);
  const allVideoFiles = allFiles.filter((f) => VIDEO_EXTENSIONS.has(path.extname(f).toLowerCase()));

  if (allVideoFiles.length === 0) {
    throw new Error(`Nenhum arquivo de vídeo suportado (.mp4, .mkv, .avi, .webm) encontrado em ${resolvedPath}`);
  }

  // Filter out standalone sample/vinheta/intro files if there are primary media files
  let videoFiles = allVideoFiles.filter((f) => !AUXILIARY_VIDEO_REGEX.test(path.basename(f)));
  if (videoFiles.length === 0) {
    // If all were deemed auxiliary, retain them so the folder isn't rejected
    videoFiles = allVideoFiles;
  }

  // Deduplicate videoFiles by realpath/absolute path
  const seenPaths = new Set<string>();
  videoFiles = videoFiles.filter((f) => {
    const normalized = path.resolve(f);
    if (seenPaths.has(normalized)) return false;
    seenPaths.add(normalized);
    return true;
  });

  // Check for poster and backdrop in directory
  let posterPath: string | undefined;
  let backdropPath: string | undefined;

  for (const file of allFiles) {
    const lowerName = path.basename(file).toLowerCase();
    if (!posterPath && POSTER_NAMES.includes(lowerName)) {
      posterPath = file;
    }
    if (!backdropPath && BACKDROP_NAMES.includes(lowerName)) {
      backdropPath = file;
    }
  }

  // If no standard poster name found, check for image matching video base name (e.g. "Filme.mp4" and "Filme.jpg")
  if (!posterPath) {
    for (const vFile of videoFiles) {
      const vBase = path.basename(vFile, path.extname(vFile)).toLowerCase();
      const matchedImage = allFiles.find((f) => {
        const ext = path.extname(f).toLowerCase();
        if (!IMAGE_EXTENSIONS.has(ext)) return false;
        const imgBase = path.basename(f, ext).toLowerCase();
        return (
          imgBase === vBase ||
          imgBase === `${vBase}-poster` ||
          imgBase === `${vBase}-cover` ||
          imgBase === `${vBase}-capa` ||
          imgBase === `${vBase}.poster` ||
          imgBase === `${vBase}.cover`
        );
      });
      if (matchedImage) {
        posterPath = matchedImage;
        break;
      }
    }
  }

  // If still no poster, attempt to extract embedded cover art from the first video file via FFmpeg
  if (!posterPath && videoFiles[0]) {
    try {
      const embedded = await extractEmbeddedCover(videoFiles[0]);
      if (embedded) {
        posterPath = embedded;
      }
    } catch {
      // Ignored if extraction fails
    }
  }

  const folderName = path.basename(resolvedPath);
  const title = customTitle?.trim() || folderName.replace(/[\._]/g, ' ').trim();
  const kind: MediaKind = detectMediaKind(videoFiles, resolvedPath);

  // Process each video file and probe its details
  // Sort video files naturally
  videoFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  const rawEpisodes: { ep: Episode; seasonNum: number; rawEpNum: number }[] = [];
  let epCounter = 1;

  for (const vFile of videoFiles) {
    const fileName = path.basename(vFile);
    const stats = fs.statSync(vFile);
    const relPath = path.relative(resolvedPath, vFile);
    const parsed = parseEpisodeInfo(relPath || fileName, epCounter++);

    // ffprobe inspection
    const probe = await probeMedia(vFile);

    // External subtitles
    const externalSubs = findExternalSubtitles(vFile, allFiles);
    const allSubs = [...probe.subtitleTracks, ...externalSubs];

    const epHash = crypto.createHash('md5').update(vFile).digest('hex').slice(0, 12);
    const epId = `ep_s${parsed.seasonNumber}e${parsed.episodeNumber}_${epHash}`;

    const episode: Episode = {
      id: epId,
      seasonNumber: parsed.seasonNumber,
      episodeNumber: parsed.episodeNumber,
      title: parsed.cleanTitle,
      fileName,
      filePath: vFile,
      extension: path.extname(vFile).toLowerCase(),
      sizeBytes: stats.size,
      durationSeconds: probe.durationSeconds || 0,
      videoCodec: probe.videoCodec,
      pixFmt: probe.pixFmt,
      resolution: probe.resolution,
      audioTracks: probe.audioTracks,
      subtitleTracks: allSubs,
      watched: false,
      progressSeconds: 0,
    };

    rawEpisodes.push({ ep: episode, seasonNum: parsed.seasonNumber, rawEpNum: parsed.episodeNumber });
  }

  // If movie (1 video file), films DO NOT have seasons
  if (kind === 'movie') {
    const singleEp = rawEpisodes[0]?.ep;
    if (singleEp) {
      singleEp.seasonNumber = 0;
      singleEp.episodeNumber = 1;
      singleEp.title = title;
    }
    const movieSeasons: Season[] = singleEp ? [{
      seasonNumber: 0,
      title: '',
      episodes: [singleEp],
    }] : [];

    const mediaHash = crypto.createHash('md5').update(resolvedPath).digest('hex').slice(0, 16);
    const mediaId = `media_${mediaHash}`;
    const now = new Date().toISOString();

    return {
      id: mediaId,
      title,
      customTitle: customTitle?.trim() || undefined,
      kind: 'movie',
      folderPath: resolvedPath,
      posterPath,
      backdropPath,
      totalEpisodes: movieSeasons.length,
      totalSeasons: 0,
      seasons: movieSeasons,
      createdAt: now,
      updatedAt: now,
    };
  }

  // SÉRIE: Group into seasons and resolve any episode collisions/duplicates
  const seasonMap = new Map<number, typeof rawEpisodes>();
  for (const item of rawEpisodes) {
    if (!seasonMap.has(item.seasonNum)) {
      seasonMap.set(item.seasonNum, []);
    }
    seasonMap.get(item.seasonNum)!.push(item);
  }

  const sortedSeasonKeys = Array.from(seasonMap.keys()).sort((a, b) => a - b);
  const seasons: Season[] = sortedSeasonKeys.map((sNum) => {
    const items = seasonMap.get(sNum)!;
    items.sort((a, b) => {
      if (a.rawEpNum !== b.rawEpNum) return a.rawEpNum - b.rawEpNum;
      return a.ep.fileName.localeCompare(b.ep.fileName, undefined, { numeric: true });
    });

    // Detect if there are duplicate episode numbers in the same season
    const seenEpNumbers = new Set<number>();
    let hasCollisions = false;
    for (const it of items) {
      if (seenEpNumbers.has(it.rawEpNum)) {
        hasCollisions = true;
        break;
      }
      seenEpNumbers.add(it.rawEpNum);
    }

    const resolvedEpisodes: Episode[] = [];
    const usedNumbers = new Set<number>();

    items.forEach((it, index) => {
      let finalEpNum = it.rawEpNum;
      if (hasCollisions || usedNumbers.has(finalEpNum) || finalEpNum <= 0) {
        // Assign consecutive sequential number
        finalEpNum = index + 1;
      }
      usedNumbers.add(finalEpNum);

      it.ep.seasonNumber = sNum;
      it.ep.episodeNumber = finalEpNum;
      resolvedEpisodes.push(it.ep);
    });

    return {
      seasonNumber: sNum,
      title: `Temporada ${sNum}`,
      episodes: resolvedEpisodes,
    };
  });

  const totalEpisodesCount = seasons.reduce((acc, s) => acc + s.episodes.length, 0);
  const mediaHash = crypto.createHash('md5').update(resolvedPath).digest('hex').slice(0, 16);
  const mediaId = `media_${mediaHash}`;
  const now = new Date().toISOString();

  return {
    id: mediaId,
    title,
    customTitle: customTitle?.trim() || undefined,
    kind: 'series',
    folderPath: resolvedPath,
    posterPath,
    backdropPath,
    totalEpisodes: totalEpisodesCount,
    totalSeasons: seasons.length,
    seasons,
    createdAt: now,
    updatedAt: now,
  };
}
