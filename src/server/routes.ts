import { Router, Request, Response } from 'express';
import { Readable } from 'stream';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, execFile, exec } from 'child_process';
import {
  readLibrary,
  writeLibrary,
  findMediaItem,
  findEpisode,
  updateEpisodeProgress,
  toggleEpisodeWatched,
  relocateMediaFolder,
  updateMediaBanner,
  updateMediaPoster,
  updateMediaKind,
  updateTmdbSettings,
  getDataDir,
  updateTorrentProgressInLibrary,
  saveTorrentMediaItem,
  readIptvStatusMap,
  saveIptvStatusMap,
  rescanAllLibraryFolders,
} from './storage';
import { scanMediaFolder } from './scanner';
import { enrichMediaWithTmdb, isTmdbConfigured, searchTmdb, getApiKey, getLanguage } from './tmdb';
import {
  downloadOnlineSubtitle,
  isOpenSubtitlesConfigured,
  isOpenSubtitlesAccountConfigured,
  getOpenSubtitlesUsername,
  searchOnlineSubtitles,
} from './opensubtitles';
import {
  getBinaries,
  generateThumbnail,
  extractEmbeddedCover,
  isBrowserNativeDirectPlayable,
  isBitmapSubtitleCodec,
  streamSubtitlesToVtt,
  shiftWebVttTimestamps,
  downloadAndInstallFFmpeg,
  getHardwareAccelerationStatus,
  setHardwareAccelerationConfig,
  getVideoEncodingPlan,
} from './ffmpeg';
import { getOrCreateHlsSession, findActiveSession } from './hls';
import {
  getOrCreateTorrentEngine,
  getTorrentStatus,
  getTorrentFile,
  selectTorrentFile,
  stopTorrent,
  readTorrentHistory,
  saveTorrentHistoryItem,
  removeTorrentHistoryItem,
  parseInfoHash,
} from './torrent';
import { BrowseItem, SystemStatus, TorrentStatus } from '../types';
import {
  fetchIptvPlaylist,
  parseM3U,
  IPTV_PRESETS,
  IptvChannel,
  loadIptvCacheFromDisk,
} from './iptv';

// Load any cached IPTV playlists on server boot
loadIptvCacheFromDisk();

export const apiRouter = Router();

// Disable caching for all API responses so state updates reflect immediately
apiRouter.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

const IMPORTED_SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt', '.ass', '.ssa']);
const MAX_IMPORTED_SUBTITLE_BYTES = 10 * 1024 * 1024;

function sanitizeSubtitleFileName(fileName: string, extension: string): string {
  const baseName = path.basename(fileName, path.extname(fileName))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return `${baseName || 'legenda'}${extension}`;
}

function isPathInsideDirectory(filePath: string, directory: string): boolean {
  const relative = path.relative(path.resolve(directory), path.resolve(filePath));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

// 1. Get entire library
apiRouter.get('/library', (req: Request, res: Response) => {
  const lib = readLibrary();
  res.json(lib);
});

// 2. Add and scan a folder
apiRouter.post('/library/add', async (req: Request, res: Response) => {
  try {
    const { folderPath, title } = req.body;
    if (!folderPath) {
      res.status(400).json({ error: 'Caminho da pasta é obrigatório' });
      return;
    }

    const mediaItem = await scanMediaFolder(folderPath, title);
    await enrichMediaWithTmdb(mediaItem);
    const lib = readLibrary();

    // Replace if already exists with same folder or ID
    const existingIndex = lib.items.findIndex(
      (item) => item.id === mediaItem.id || item.folderPath === mediaItem.folderPath
    );

    if (existingIndex >= 0) {
      // Preserve watch history and progress from previous scan
      const existing = lib.items[existingIndex];
      for (const newSeason of mediaItem.seasons) {
        const oldSeason = existing.seasons.find((s) => s.seasonNumber === newSeason.seasonNumber);
        if (oldSeason) {
          for (const newEp of newSeason.episodes) {
            const oldEp = oldSeason.episodes.find(
              (e) => e.fileName === newEp.fileName || e.episodeNumber === newEp.episodeNumber
            );
            if (oldEp) {
              newEp.watched = oldEp.watched;
              newEp.progressSeconds = oldEp.progressSeconds;
              newEp.lastWatchedAt = oldEp.lastWatchedAt;
              newEp.selectedAudioIndex = oldEp.selectedAudioIndex;
              newEp.selectedSubtitleIndex = oldEp.selectedSubtitleIndex;
              newEp.subtitleTracks = [
                ...newEp.subtitleTracks,
                ...oldEp.subtitleTracks.filter((track) => track.isImported),
              ];
            }
          }
        }
      }
      mediaItem.lastWatchedEpisodeId = existing.lastWatchedEpisodeId;
      mediaItem.lastWatchedAt = existing.lastWatchedAt;
      if (existing.backdropPath && !mediaItem.backdropPath) {
        mediaItem.backdropPath = existing.backdropPath;
      }
      if (existing.posterPath && !mediaItem.posterPath) {
        mediaItem.posterPath = existing.posterPath;
      }
      lib.items[existingIndex] = mediaItem;
    } else {
      lib.items.push(mediaItem);
    }

    writeLibrary(lib);
    res.json({ success: true, item: mediaItem });
  } catch (error: any) {
    console.error('Error adding folder:', error);
    res.status(400).json({ error: error.message || 'Erro ao escanear pasta' });
  }
});

// 3. Rescan existing media item
apiRouter.post('/library/rescan/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const media = findMediaItem(id);
    if (!media) {
      res.status(404).json({ error: 'Mídia não encontrada' });
      return;
    }

    const updatedItem = await scanMediaFolder(media.folderPath, media.customTitle);
    await enrichMediaWithTmdb(updatedItem);
    const lib = readLibrary();
    const idx = lib.items.findIndex((i) => i.id === id);

    // Preserve progress
    for (const newSeason of updatedItem.seasons) {
      const oldSeason = media.seasons.find((s) => s.seasonNumber === newSeason.seasonNumber);
      if (oldSeason) {
        for (const newEp of newSeason.episodes) {
          const oldEp = oldSeason.episodes.find((e) => e.fileName === newEp.fileName);
          if (oldEp) {
            newEp.watched = oldEp.watched;
            newEp.progressSeconds = oldEp.progressSeconds;
            newEp.lastWatchedAt = oldEp.lastWatchedAt;
            newEp.subtitleTracks = [
              ...newEp.subtitleTracks,
              ...oldEp.subtitleTracks.filter((track) => track.isImported),
            ];
          }
        }
      }
    }
    updatedItem.lastWatchedEpisodeId = media.lastWatchedEpisodeId;
    updatedItem.lastWatchedAt = media.lastWatchedAt;
    updatedItem.customTitle = media.customTitle;
    updatedItem.tmdbId = updatedItem.tmdbId || media.tmdbId;
    updatedItem.metadataProvider = updatedItem.metadataProvider || media.metadataProvider;
    updatedItem.originalTitle = updatedItem.originalTitle || media.originalTitle;
    updatedItem.year = updatedItem.year || media.year;
    updatedItem.overview = updatedItem.overview || media.overview;
    updatedItem.tagline = updatedItem.tagline || media.tagline;
    updatedItem.genres = updatedItem.genres?.length ? updatedItem.genres : media.genres;
    updatedItem.rating = updatedItem.rating ?? media.rating;
    updatedItem.voteCount = updatedItem.voteCount ?? media.voteCount;
    updatedItem.cast = updatedItem.cast?.length ? updatedItem.cast : media.cast;
    if (media.backdropPath && !updatedItem.backdropPath) {
      updatedItem.backdropPath = media.backdropPath;
    }
    if (media.posterPath && !updatedItem.posterPath) {
      updatedItem.posterPath = media.posterPath;
    }

    lib.items[idx] = updatedItem;
    writeLibrary(lib);

    res.json({ success: true, item: updatedItem });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 3.0.1 Re-scan all registered media folders to determine series vs movie
apiRouter.all(['/library/rescan-all', '/library/rescan-folders'], async (_req: Request, res: Response) => {
  try {
    const result = await rescanAllLibraryFolders();
    res.json({ success: true, count: result.updatedCount, library: result.library });
  } catch (error: any) {
    console.error('Erro no re-scan de todas as pastas:', error);
    res.status(500).json({ error: error?.message || 'Erro ao re-escanear pastas' });
  }
});

// 3.1 Refresh metadata from TMDb (supports optional search query or explicit TMDb ID)
apiRouter.post('/library/metadata/:id', async (req: Request, res: Response) => {
  try {
    if (!isTmdbConfigured()) {
      res.status(503).json({ error: 'TMDb não configurado. Configure sua chave da API do TMDb no menu Status.' });
      return;
    }

    const media = findMediaItem(req.params.id);
    if (!media) {
      res.status(404).json({ error: 'Mídia não encontrada' });
      return;
    }

    const { query, tmdbId } = req.body || {};
    await enrichMediaWithTmdb(media, query, tmdbId ? Number(tmdbId) : undefined);
    const library = readLibrary();
    const index = library.items.findIndex((item) => item.id === media.id);
    if (index < 0) {
      res.status(404).json({ error: 'Mídia não encontrada' });
      return;
    }
    library.items[index] = media;
    writeLibrary(library, true);
    res.json({ success: true, item: media });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Erro ao atualizar metadados' });
  }
});

// 3.2 Refresh metadata for all library items
apiRouter.post('/library/refresh-all-metadata', async (req: Request, res: Response) => {
  try {
    if (!isTmdbConfigured()) {
      res.status(503).json({ error: 'TMDb não configurado. Configure sua chave da API do TMDb.' });
      return;
    }

    const library = readLibrary();
    let updatedCount = 0;

    for (let i = 0; i < library.items.length; i++) {
      const item = library.items[i];
      try {
        await enrichMediaWithTmdb(item);
        updatedCount++;
      } catch (err) {
        console.warn(`[TMDb] Erro ao atualizar item ${item.title}:`, err);
      }
    }

    writeLibrary(library, true);
    res.json({ success: true, updatedCount, total: library.items.length });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Erro ao atualizar metadados da biblioteca' });
  }
});

// 4. Relocate media folder (e.g. drive letter changed or folder moved)
apiRouter.post('/library/relocate/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const { newFolderPath } = req.body;
  if (!newFolderPath) {
    res.status(400).json({ error: 'Novo caminho da pasta é obrigatório' });
    return;
  }
  const result = relocateMediaFolder(id, newFolderPath);
  if (!result.success) {
    res.status(400).json({ error: result.message });
    return;
  }
  res.json(result);
});

// 5. Delete media from library (does not delete video files on disk)
apiRouter.delete('/library/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const lib = readLibrary();
  lib.items = lib.items.filter((item) => item.id !== id);
  writeLibrary(lib);

  if (id.startsWith('torrent_')) {
    const cleanHash = id.replace('torrent_', '');
    try {
      removeTorrentHistoryItem(cleanHash);
      stopTorrent(cleanHash, true).catch(() => {});
    } catch {}
  }

  res.json({ success: true });
});

// 6. Save progress
apiRouter.post('/library/progress', (req: Request, res: Response) => {
  const { mediaId, episodeId, progressSeconds, durationSeconds, completed, audioIndex, subtitleIndex } = req.body;
  if (!mediaId || !episodeId || progressSeconds === undefined) {
    res.status(400).json({ error: 'Parâmetros insuficientes' });
    return;
  }

  const ok = updateEpisodeProgress(
    mediaId,
    episodeId,
    progressSeconds,
    durationSeconds,
    completed,
    audioIndex,
    subtitleIndex
  );
  res.json({ success: ok });
});

// 7. Toggle watched
apiRouter.post('/library/mark-watched', (req: Request, res: Response) => {
  const { mediaId, episodeId, watched } = req.body;
  if (!mediaId || !episodeId) {
    res.status(400).json({ error: 'mediaId e episodeId são obrigatórios' });
    return;
  }
  const ok = toggleEpisodeWatched(mediaId, episodeId, watched);
  res.json({ success: ok });
});

// 8. Stream video (Direct HTTP 206 Range for native MP4/WebM, or ffmpeg remux/transcode for MKV/audio track)
apiRouter.get('/media/:mediaId/episode/:episodeId/stream', (req: Request, res: Response) => {
  const { mediaId, episodeId } = req.params;
  const pair = findEpisode(mediaId, episodeId);
  if (!pair) {
    res.status(404).send('Episódio não encontrado');
    return;
  }

  const { episode } = pair;
  const filePath = episode.filePath;

  if (!fs.existsSync(filePath)) {
    res.status(404).send(`Arquivo não encontrado no disco: ${filePath}`);
    return;
  }

  const audioTrackParam = req.query.audio as string | undefined;
  const seekParam = req.query.seek as string | undefined;
  const forceTranscode = req.query.transcode === 'true' || req.query.transcode === '1';

  const audioTrackIndex = audioTrackParam !== undefined ? parseInt(audioTrackParam, 10) : undefined;
  const seekSeconds = seekParam ? parseFloat(seekParam) : 0;

  // Determine if direct streaming is possible:
  // Direct streaming requires:
  // - No custom seek offset that forces remux
  // - Browser native format (MP4/WebM)
  // - No specific audio track chosen that differs from default (or only 1 track)
  // - Video codec is h264/vp8/vp9/av1 with 8-bit yuv420p
  const directCompatible =
    !forceTranscode &&
    isBrowserNativeDirectPlayable(filePath, episode.videoCodec, episode.audioTracks[0]?.codec, episode.pixFmt) &&
    (audioTrackIndex === undefined || audioTrackIndex === 0);

  if (directCompatible && !seekParam) {
    // Native HTTP Range 206 streaming
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    const mimeType = episode.extension === '.webm' ? 'video/webm' : 'video/mp4';

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': mimeType,
      });

      const fileStream = fs.createReadStream(filePath, { start, end });
      fileStream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(filePath).pipe(res);
    }
    return;
  }

  // Otherwise: ffmpeg remux / on-the-fly transcode
  const { ffmpeg } = getBinaries();
  if (!ffmpeg) {
    res.status(500).send('FFmpeg não encontrado para transcodificar este formato');
    return;
  }

  const selectedAudio =
    audioTrackIndex !== undefined && episode.audioTracks[audioTrackIndex]
      ? episode.audioTracks[audioTrackIndex]
      : episode.audioTracks[0];

  const audioStreamIndex = selectedAudio ? selectedAudio.streamIndex : undefined;

  const args: string[] = [];
  const videoEncodingPlan = getVideoEncodingPlan(true);

  // Input flags: tolerate corrupt packets, missing PTS and discontinuous timestamps (common in spliced bumpers/vinhetas)
  args.push('-fflags', '+genpts+discardcorrupt+igndts');
  args.push('-err_detect', 'ignore_err');
  if (videoEncodingPlan.hardware) {
    args.push(...videoEncodingPlan.inputArgs);
  }

  // Seek position before input for fast keyframe seek
  if (seekSeconds > 0) {
    args.push('-ss', seekSeconds.toString());
  }

  args.push('-i', filePath);

  // Map real video stream (skipping attached cover images)
  args.push('-map', '0:V:0?');

  // Map chosen audio stream
  if (audioStreamIndex !== undefined) {
    args.push('-map', `0:${audioStreamIndex}`);
  } else {
    args.push('-map', '0:a:0?');
  }

  // Video codec:
  // Stream copy is only safe if:
  // - Not forced transcode
  // - Video codec is H.264 / AVC
  // - Pixel format is standard 8-bit YUV420P (not 10-bit Hi10P, not YUV444P)
  const isH264 = episode.videoCodec?.toLowerCase().includes('264') || episode.videoCodec?.toLowerCase().includes('avc');
  const is10BitOrHighColor = episode.pixFmt && (episode.pixFmt.includes('10') || episode.pixFmt.includes('444') || episode.pixFmt.includes('422'));
  const canDirectCopyVideo = !forceTranscode && isH264 && !is10BitOrHighColor;

  if (canDirectCopyVideo) {
    args.push(
      '-c:v', 'copy',
      '-bsf:v', 'dump_extra'
    );
  } else {
    args.push(...videoEncodingPlan.outputArgs);
  }

  // Audio: always encode to AAC with async audio resampling so bumper/vinheta timestamp jumps don't desync or crash FFmpeg
  args.push(
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ac', '2',
    '-af', 'aresample=async=1000:min_hard_comp=0.100000:first_pts=0'
  );

  // Fragmented MP4 flags for direct pipe streaming to HTML5 video player
  args.push(
    '-max_muxing_queue_size', '4096',
    '-avoid_negative_ts', 'make_zero',
    '-movflags', 'frag_keyframe+default_base_moof+negative_cts_offsets',
    '-f', 'mp4',
    'pipe:1'
  );

  res.writeHead(200, {
    'Content-Type': 'video/mp4',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Connection': 'keep-alive',
  });

  const proc = spawn(ffmpeg, args);
  proc.stdout.pipe(res);

  let stderrTail = '';
  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderrTail = (stderrTail + text).slice(-1000);
  });

  proc.on('close', (code) => {
    if (code !== 0 && code !== null) {
      console.warn(`[FFmpeg] Stream exited with code ${code}. Stderr snippet: ${stderrTail.trim()}`);
    }
  });

  proc.on('error', (err) => {
    console.error('FFmpeg streaming error:', err);
    if (!res.headersSent) {
      res.status(500).send('Erro no streaming ffmpeg');
    }
  });

  res.on('close', () => {
    try {
      proc.kill('SIGKILL');
    } catch {}
  });
});

// 8.1 HLS Streaming (M3U8 Manifest and TS Segments for MKV & Transcoded streams)
apiRouter.get('/media/:mediaId/episode/:episodeId/hls/:file', async (req: Request, res: Response) => {
  const { mediaId, episodeId, file } = req.params;
  const audioTrackParam = req.query.audio as string | undefined;
  const parsedAudioTrack = audioTrackParam !== undefined ? parseInt(audioTrackParam, 10) : 0;
  const audioTrackIndex = Number.isInteger(parsedAudioTrack) && parsedAudioTrack >= 0 ? parsedAudioTrack : 0;
  const seekParam = req.query.seek as string | undefined;
  const parsedSeek = seekParam !== undefined ? parseFloat(seekParam) : 0;
  const seekSeconds = Number.isFinite(parsedSeek) && parsedSeek > 0 ? parsedSeek : 0;
  const castMode = req.query.cast === 'true' || req.query.cast === '1';
  const forceTranscode = castMode || req.query.transcode === 'true' || req.query.transcode === '1';

  const pair = findEpisode(mediaId, episodeId);
  if (!pair) {
    console.warn(`[HLS Route] Episódio não encontrado para mediaId=${mediaId}, epId=${episodeId}`);
    res.status(404).send('Episódio não encontrado');
    return;
  }

  const { episode } = pair;
  const filePath = episode.filePath;
  if (!fs.existsSync(filePath)) {
    console.warn(`[HLS Route] Arquivo não existe no disco: ${filePath}`);
    res.status(404).send(`Arquivo não encontrado: ${filePath}`);
    return;
  }

  const selectedAudio = episode.audioTracks[audioTrackIndex] || episode.audioTracks[0];
  const audioStreamIndex = selectedAudio ? selectedAudio.streamIndex : undefined;

  const isH264 = !!(episode.videoCodec?.toLowerCase().includes('264') || episode.videoCodec?.toLowerCase().includes('avc'));
  const is10BitOrHighColor = !!(episode.pixFmt && (episode.pixFmt.includes('10') || episode.pixFmt.includes('444') || episode.pixFmt.includes('422')));
  const canDirectCopyVideo = Boolean(!forceTranscode && isH264 && !is10BitOrHighColor);
  // Keep direct-copy and transcode sessions separate. Otherwise a recovery
  // request with `transcode=1` can accidentally reuse the broken copy session.
  const isTranscodedSession = forceTranscode || !canDirectCopyVideo;

  try {
    let sessionDir: string;
    let manifestPath: string;

    const existingSession = findActiveSession(
      mediaId,
      episodeId,
      audioTrackIndex,
      isTranscodedSession,
      seekSeconds
    );

    if (existingSession && fs.existsSync(existingSession.manifestPath)) {
      existingSession.lastAccess = Date.now();
      sessionDir = existingSession.sessionDir;
      manifestPath = existingSession.manifestPath;
    } else {
      const created = await getOrCreateHlsSession(
        mediaId,
        episodeId,
        filePath,
        audioStreamIndex,
        audioTrackIndex,
        canDirectCopyVideo,
        forceTranscode,
        seekSeconds
      );
      sessionDir = created.sessionDir;
      manifestPath = created.manifestPath;
    }

    const targetFile = file === 'master.m3u8' ? manifestPath : path.join(sessionDir, file);

    // If requesting a segment that FFmpeg is still generating, wait up to 25 seconds
    if (!fs.existsSync(targetFile)) {
      const startWait = Date.now();
      while (Date.now() - startWait < 25000 && !fs.existsSync(targetFile)) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!fs.existsSync(targetFile)) {
        const availableFiles = fs.existsSync(sessionDir) ? fs.readdirSync(sessionDir).join(', ') : 'dir_not_found';
        console.error(`[HLS Route ERROR] Segmento ${file} não foi gerado em 25s. Arquivos: [${availableFiles}]`);
      }
    }

    if (!fs.existsSync(targetFile)) {
      res.status(404).send('Segmento HLS não encontrado');
      return;
    }

    if (file.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (file.endsWith('.ts')) {
      res.setHeader('Content-Type', 'video/mp2t');
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }

    if (file === 'master.m3u8') {
      // Query parameters from the playlist URL are not inherited by relative
      // HLS segment URLs. Add the audio/session selector to every segment so
      // each request resolves to the same FFmpeg session as the playlist.
      const segmentQuery = new URLSearchParams({ audio: String(audioTrackIndex) });
      if (seekSeconds > 0) segmentQuery.set('seek', String(seekSeconds));
      if (castMode) segmentQuery.set('cast', '1');
      if (forceTranscode) segmentQuery.set('transcode', '1');
      const manifest = fs.readFileSync(targetFile, 'utf8').replace(
        /^(segment_\d+\.ts)$/gm,
        `$1?${segmentQuery.toString()}`
      );
      res.setHeader('Content-Length', Buffer.byteLength(manifest, 'utf8'));
      res.send(manifest);
      return;
    }

    res.sendFile(path.resolve(targetFile), { dotfiles: 'allow' }, (err: any) => {
      // Hls.js routinely cancels an old manifest request while switching to
      // the refreshed playlist. That is a normal client-side abort, not a
      // server/FFmpeg failure, so do not flood the console with false errors.
      const clientAborted =
        req.destroyed ||
        res.destroyed ||
        ['ECONNABORTED', 'ECONNRESET', 'EPIPE'].includes(err?.code) ||
        /request aborted|connection reset/i.test(err?.message || '');

      if (err && !clientAborted && !res.headersSent) {
        console.warn(`[HLS Route] Failed to send ${file}:`, err.message);
      }
    });
  } catch (err: any) {
    console.error('[HLS Route Exception]:', err);
    if (!res.headersSent) {
      res.status(500).send(`Erro ao preparar streaming HLS: ${err.message}`);
    }
  }
});

// 9.1 Search subtitles online before the generic /:index route below.
apiRouter.get('/media/:mediaId/episode/:episodeId/subtitles/online', async (req: Request, res: Response) => {
  const { mediaId, episodeId } = req.params;
  if (!isOpenSubtitlesConfigured()) {
    res.status(503).json({ error: 'OpenSubtitles não configurado. Defina OPENSUBTITLES_API_KEY.' });
    return;
  }

  const pair = findEpisode(mediaId, episodeId);
  if (!pair) {
    res.status(404).json({ error: 'Episódio não encontrado' });
    return;
  }

  try {
    const language = typeof req.query.language === 'string' ? req.query.language : 'pt-br';
    const items = await searchOnlineSubtitles(pair.media, pair.episode, language);
    res.json({ items });
  } catch (error: any) {
    res.status(502).json({ error: error?.message || 'Não foi possível buscar legendas online.' });
  }
});

// 9.2 Download and persist one OpenSubtitles result in the portable data folder.
apiRouter.post('/media/:mediaId/episode/:episodeId/subtitles/online/download', async (req: Request, res: Response) => {
  const { mediaId, episodeId } = req.params;
  const pair = findEpisode(mediaId, episodeId);
  if (!pair) {
    res.status(404).json({ error: 'Episódio não encontrado' });
    return;
  }

  const fileId = Number(req.body?.fileId);
  if (!Number.isInteger(fileId) || fileId <= 0) {
    res.status(400).json({ error: 'fileId de legenda inválido.' });
    return;
  }

  try {
    const option = {
      id: String(req.body?.id || fileId),
      fileId,
      language: typeof req.body?.language === 'string' ? req.body.language : 'pt-br',
      languageName: typeof req.body?.languageName === 'string' ? req.body.languageName : undefined,
      release: typeof req.body?.release === 'string' ? req.body.release : undefined,
      fileName: typeof req.body?.fileName === 'string' ? req.body.fileName : undefined,
    };
    const track = await downloadOnlineSubtitle(pair.media, pair.episode, option);
    pair.episode.subtitleTracks.push(track);
    writeLibrary(readLibrary(), true);
    res.json({ success: true, track });
  } catch (error: any) {
    res.status(502).json({ error: error?.message || 'Não foi possível baixar a legenda online.' });
  }
});

// 9.3 Subtitles (Internal stream or External file converted to WebVTT)
apiRouter.get('/media/:mediaId/episode/:episodeId/subtitles/:index', (req: Request, res: Response) => {
  const { mediaId, episodeId, index } = req.params;
  const parsedOffset = Number(req.query.offset);
  const offsetSeconds = Number.isFinite(parsedOffset) ? parsedOffset : 0;
  const pair = findEpisode(mediaId, episodeId);
  if (!pair) {
    res.status(404).send('Episódio não encontrado');
    return;
  }

  const trackIdx = parseInt(index, 10);
  const track = pair.episode.subtitleTracks.find((t) => t.index === trackIdx);
  if (!track) {
    res.status(404).send('Faixa de legenda não encontrada');
    return;
  }

  // If external subtitle file
  if (track.isExternal && track.filePath && fs.existsSync(track.filePath)) {
    const ext = path.extname(track.filePath).toLowerCase();
    if (ext === '.vtt') {
      res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
      if (offsetSeconds === 0) {
        fs.createReadStream(track.filePath).pipe(res);
      } else {
        const raw = fs.readFileSync(track.filePath, 'utf-8');
        res.send(shiftWebVttTimestamps(raw, offsetSeconds));
      }
      return;
    }

    if (ext === '.srt') {
      try {
        const raw = fs.readFileSync(track.filePath, 'utf-8');
        // Convert SRT to WebVTT: replace timestamp comma with dot
        const vttContent = shiftWebVttTimestamps(
          'WEBVTT\n\n' + raw.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2'),
          offsetSeconds
        );
        res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
        res.send(vttContent);
        return;
      } catch {
        // Fallback to ffmpeg below
      }
    }

    // ASS/SSA files are also converted by FFmpeg, but the input must be the
    // external subtitle file rather than the episode video.
    if (ext === '.ass' || ext === '.ssa') {
      streamSubtitlesToVtt(track.filePath, 0, res, offsetSeconds);
      return;
    }
  }

  // Embedded subtitle stream or complex format via ffmpeg
  if (!track.isExternal && isBitmapSubtitleCodec(track.codec)) {
    res.status(415).json({
      code: 'BITMAP_SUBTITLE_UNSUPPORTED',
      error: 'Esta faixa usa legenda gráfica (PGS/VobSub) e não pode ser convertida diretamente para WebVTT.',
      suggestion: 'Use "Buscar online" para baixar uma legenda textual compatível com Chromecast.',
    });
    return;
  }

  const streamIdx = track.streamIndex >= 0 ? track.streamIndex : 0;
  streamSubtitlesToVtt(pair.episode.filePath, streamIdx, res, offsetSeconds);
});

// 9.1 Import an external subtitle into the portable application data
apiRouter.post('/media/:mediaId/episode/:episodeId/subtitles/import', (req: Request, res: Response) => {
  const { mediaId, episodeId } = req.params;
  const pair = findEpisode(mediaId, episodeId);
  if (!pair) {
    res.status(404).json({ error: 'Episódio não encontrado' });
    return;
  }

  const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName : '';
  const contentBase64 = typeof req.body?.contentBase64 === 'string' ? req.body.contentBase64 : '';
  const extension = path.extname(fileName).toLowerCase();
  if (!fileName || !IMPORTED_SUBTITLE_EXTENSIONS.has(extension)) {
    res.status(400).json({ error: 'Formato de legenda não suportado. Use .srt, .vtt, .ass ou .ssa.' });
    return;
  }
  if (!contentBase64) {
    res.status(400).json({ error: 'O arquivo de legenda está vazio.' });
    return;
  }

  let content: Buffer;
  try {
    content = Buffer.from(contentBase64, 'base64');
  } catch {
    res.status(400).json({ error: 'Conteúdo de legenda inválido.' });
    return;
  }
  if (content.length === 0 || content.length > MAX_IMPORTED_SUBTITLE_BYTES) {
    res.status(400).json({ error: 'A legenda deve ter entre 1 byte e 10 MB.' });
    return;
  }

  const subtitleDirectory = path.join(getDataDir(), 'subtitles', mediaId, episodeId);
  const safeFileName = sanitizeSubtitleFileName(fileName, extension);
  const targetPath = path.join(subtitleDirectory, safeFileName);
  const normalizedTargetPath = path.resolve(targetPath);
  const normalizedDirectory = path.resolve(subtitleDirectory);
  if (!isPathInsideDirectory(normalizedTargetPath, normalizedDirectory)) {
    res.status(400).json({ error: 'Nome de arquivo de legenda inválido.' });
    return;
  }

  try {
    fs.mkdirSync(subtitleDirectory, { recursive: true });
    fs.writeFileSync(normalizedTargetPath, content);

    const existingArrayIndex = pair.episode.subtitleTracks.findIndex(
      (track) => track.isImported && track.filePath && path.resolve(track.filePath) === normalizedTargetPath
    );
    const existingTrack = existingArrayIndex >= 0 ? pair.episode.subtitleTracks[existingArrayIndex] : undefined;
    const nextTrackIndex = existingTrack?.index ?? Math.max(99, ...pair.episode.subtitleTracks.map((track) => track.index)) + 1;
    const importedTrack = {
      index: nextTrackIndex,
      streamIndex: -1,
      codec: extension.slice(1),
      language: typeof req.body?.language === 'string' && req.body.language.trim() ? req.body.language.trim() : 'pt',
      title: `Legenda importada (${path.basename(safeFileName, extension)})`,
      isExternal: true,
      isImported: true,
      source: 'local' as const,
      filePath: normalizedTargetPath,
    };

    if (existingArrayIndex >= 0) {
      pair.episode.subtitleTracks[existingArrayIndex] = importedTrack;
    } else {
      pair.episode.subtitleTracks.push(importedTrack);
    }

    writeLibrary(readLibrary(), true);
    res.json({ success: true, track: importedTrack });
  } catch (error: any) {
    console.error('[Subtitles] Falha ao importar legenda:', error);
    res.status(500).json({ error: error?.message || 'Não foi possível importar a legenda.' });
  }
});

// 9.2 Remove only subtitles imported into data/subtitles
apiRouter.delete('/media/:mediaId/episode/:episodeId/subtitles/:index', (req: Request, res: Response) => {
  const { mediaId, episodeId } = req.params;
  const trackIndex = Number.parseInt(req.params.index, 10);
  const pair = findEpisode(mediaId, episodeId);
  if (!pair) {
    res.status(404).json({ error: 'Episódio não encontrado' });
    return;
  }

  const arrayIndex = pair.episode.subtitleTracks.findIndex((track) => track.index === trackIndex);
  const track = arrayIndex >= 0 ? pair.episode.subtitleTracks[arrayIndex] : undefined;
  const importedDirectory = path.join(getDataDir(), 'subtitles', mediaId, episodeId);
  if (!track?.isImported || !track.filePath || !isPathInsideDirectory(track.filePath, importedDirectory)) {
    res.status(400).json({ error: 'Somente legendas importadas podem ser removidas.' });
    return;
  }

  try {
    if (fs.existsSync(track.filePath)) fs.rmSync(track.filePath, { force: true });
    pair.episode.subtitleTracks.splice(arrayIndex, 1);
    if (pair.episode.selectedSubtitleIndex !== undefined) {
      if (pair.episode.selectedSubtitleIndex === arrayIndex) {
        pair.episode.selectedSubtitleIndex = -1;
      } else if (pair.episode.selectedSubtitleIndex > arrayIndex) {
        pair.episode.selectedSubtitleIndex -= 1;
      }
    }
    writeLibrary(readLibrary(), true);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Não foi possível remover a legenda.' });
  }
});

// 9.5 Update media banner image by URL
apiRouter.post('/media/:id/banner', (req: Request, res: Response) => {
  const { id } = req.params;
  const { bannerUrl } = req.body;
  const ok = updateMediaBanner(id, typeof bannerUrl === 'string' ? bannerUrl : '');
  if (!ok) {
    res.status(404).json({ error: 'Mídia não encontrada' });
    return;
  }
  const updatedMedia = findMediaItem(id);
  res.json({ success: true, media: updatedMedia });
});

// 9.6 Update media poster image by URL
apiRouter.post('/media/:id/poster', (req: Request, res: Response) => {
  const { id } = req.params;
  const { posterUrl } = req.body;
  const ok = updateMediaPoster(id, typeof posterUrl === 'string' ? posterUrl : '');
  if (!ok) {
    res.status(404).json({ error: 'Mídia não encontrada' });
    return;
  }
  const updatedMedia = findMediaItem(id);
  res.json({ success: true, media: updatedMedia });
});

// 10. Poster image
apiRouter.get('/media/:mediaId/poster', async (req: Request, res: Response) => {
  const { mediaId } = req.params;
  const media = findMediaItem(mediaId);
  if (!media) {
    res.status(404).send('Mídia não encontrada');
    return;
  }

  // 1. If posterPath is a remote URL, redirect
  if (media.posterPath && (media.posterPath.startsWith('http://') || media.posterPath.startsWith('https://'))) {
    res.redirect(media.posterPath);
    return;
  }

  // 2. Local explicit posterPath
  if (media.posterPath && fs.existsSync(media.posterPath)) {
    res.sendFile(media.posterPath);
    return;
  }

  // 3. Cached TMDb poster in data/metadata/{id}/poster.jpg
  const cachedPoster = path.join(getDataDir(), 'metadata', mediaId, 'poster.jpg');
  if (fs.existsSync(cachedPoster) && fs.statSync(cachedPoster).size > 1000) {
    res.sendFile(cachedPoster);
    return;
  }

  // 4. Try extracting embedded cover art from the first video file
  const firstEp = media.seasons[0]?.episodes[0];
  if (firstEp && fs.existsSync(firstEp.filePath)) {
    try {
      const embedded = await extractEmbeddedCover(firstEp.filePath);
      if (embedded && fs.existsSync(embedded) && fs.statSync(embedded).size > 1000) {
        res.sendFile(embedded);
        return;
      }
    } catch {}

    // 5. Fallback: generate high-quality vertical poster frame
    try {
      const thumbPath = await generateThumbnail(firstEp.filePath, 10, 'poster');
      if (thumbPath && fs.existsSync(thumbPath)) {
        res.sendFile(thumbPath);
        return;
      }
    } catch {}
  }

  // 6. Fallback: try backdrop URL or file
  if (media.backdropPath && (media.backdropPath.startsWith('http://') || media.backdropPath.startsWith('https://'))) {
    res.redirect(media.backdropPath);
    return;
  }

  if (media.backdropPath && fs.existsSync(media.backdropPath)) {
    res.sendFile(media.backdropPath);
    return;
  }

  res.status(404).send('Poster não encontrado');
});

// 10.5 Backdrop / Banner image
apiRouter.get(['/media/:mediaId/backdrop', '/media/:mediaId/banner'], (req: Request, res: Response) => {
  const { mediaId } = req.params;
  const media = findMediaItem(mediaId);
  if (!media) {
    res.status(404).send('Mídia não encontrada');
    return;
  }

  // If backdropPath is a remote URL, redirect directly
  if (media.backdropPath && (media.backdropPath.startsWith('http://') || media.backdropPath.startsWith('https://'))) {
    res.redirect(media.backdropPath);
    return;
  }

  if (media.backdropPath && fs.existsSync(media.backdropPath)) {
    res.sendFile(media.backdropPath);
    return;
  }

  // Check cached TMDb backdrop in data/metadata/{id}/backdrop.jpg
  const cachedBackdrop = path.join(getDataDir(), 'metadata', mediaId, 'backdrop.jpg');
  if (fs.existsSync(cachedBackdrop) && fs.statSync(cachedBackdrop).size > 1000) {
    res.sendFile(cachedBackdrop);
    return;
  }

  // Fallback: try poster if available
  if (media.posterPath && (media.posterPath.startsWith('http://') || media.posterPath.startsWith('https://'))) {
    res.redirect(media.posterPath);
    return;
  }

  if (media.posterPath && fs.existsSync(media.posterPath)) {
    res.sendFile(media.posterPath);
    return;
  }

  const firstEp = media.seasons[0]?.episodes[0];
  if (firstEp && fs.existsSync(firstEp.filePath)) {
    generateThumbnail(firstEp.filePath, 10, 'landscape').then((thumbPath) => {
      if (thumbPath && fs.existsSync(thumbPath)) {
        res.sendFile(thumbPath);
      } else {
        res.status(404).send('Banner não disponível');
      }
    });
    return;
  }

  res.status(404).send('Banner não encontrado');
});

// 11. Episode thumbnail
apiRouter.get('/media/:mediaId/episode/:episodeId/thumb', async (req: Request, res: Response) => {
  const { mediaId, episodeId } = req.params;
  const pair = findEpisode(mediaId, episodeId);
  if (!pair) {
    res.status(404).send('Episódio não encontrado');
    return;
  }

  if (pair.episode.stillPath) {
    if (pair.episode.stillPath.startsWith('http://') || pair.episode.stillPath.startsWith('https://')) {
      res.redirect(pair.episode.stillPath);
      return;
    }
    if (fs.existsSync(pair.episode.stillPath)) {
      res.sendFile(pair.episode.stillPath);
      return;
    }
  }

  const filePath = pair.episode.filePath;
  if (!fs.existsSync(filePath)) {
    res.status(404).send('Arquivo não encontrado');
    return;
  }

  const targetSec = pair.episode.progressSeconds > 10 ? pair.episode.progressSeconds : 15;
  const thumbPath = await generateThumbnail(filePath, targetSec);

  if (thumbPath && fs.existsSync(thumbPath)) {
    res.sendFile(thumbPath);
  } else {
    res.status(404).send('Miniatura indisponível');
  }
});

// 12. File explorer / Directory Browser
apiRouter.get('/browse', (req: Request, res: Response) => {
  try {
    const queryDir = (req.query.dir as string) || process.cwd();
    const resolvedDir = path.resolve(queryDir);

    if (!fs.existsSync(resolvedDir)) {
      res.status(404).json({ error: 'Diretório não existe' });
      return;
    }

    const items = fs.readdirSync(resolvedDir, { withFileTypes: true });
    const result: BrowseItem[] = [];

    // Add parent entry if not root
    const parent = path.dirname(resolvedDir);
    if (parent !== resolvedDir) {
      result.push({
        name: '..',
        path: parent,
        isDirectory: true,
      });
    }

    for (const item of items) {
      if (item.name.startsWith('.') || item.name === '$RECYCLE.BIN' || item.name === 'node_modules') {
        continue;
      }
      const fullPath = path.join(resolvedDir, item.name);
      try {
        if (item.isDirectory()) {
          // Check if contains video files
          let hasMedia = false;
          try {
            const sub = fs.readdirSync(fullPath);
            hasMedia = sub.some((f) => /\.(mp4|mkv|avi|webm|mov)$/i.test(f));
          } catch {}

          result.push({
            name: item.name,
            path: fullPath,
            isDirectory: true,
            hasMediaFiles: hasMedia,
          });
        }
      } catch {}
    }

    // Sort folders alphabetically
    result.sort((a, b) => {
      if (a.name === '..') return -1;
      if (b.name === '..') return 1;
      return a.name.localeCompare(b.name);
    });

    res.json({
      currentDir: resolvedDir,
      parentDir: parent !== resolvedDir ? parent : null,
      items: result,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 13. System Status
apiRouter.get('/system/status', (req: Request, res: Response) => {
  const { ffmpeg, ffprobe } = getBinaries();
  const lib = readLibrary();

  const status: SystemStatus = {
    ffmpegFound: !!ffmpeg,
    ffmpegPath: ffmpeg || undefined,
    ffprobeFound: !!ffprobe,
    ffprobePath: ffprobe || undefined,
    appDir: process.cwd(),
    dataDir: getDataDir(),
    libraryPath: path.join(getDataDir(), 'library.json'),
    totalItems: lib.items.length,
    platform: process.platform,
    tmdbConfigured: isTmdbConfigured(),
    tmdbApiKeyConfigured: Boolean(getApiKey()),
    tmdbLanguage: getLanguage(),
    openSubtitlesConfigured: isOpenSubtitlesConfigured(),
    openSubtitlesAccountConfigured: isOpenSubtitlesAccountConfigured(),
    openSubtitlesUsername: getOpenSubtitlesUsername(),
    hardwareAcceleration: getHardwareAccelerationStatus(),
  };

  res.json(status);
});

// 13.0.0.1 Save TMDb API settings
apiRouter.post('/system/tmdb', (req: Request, res: Response) => {
  const { apiKey, accessToken, language } = req.body;
  updateTmdbSettings(apiKey, accessToken, language);
  if (apiKey && typeof apiKey === 'string') {
    process.env.TMDB_API_KEY = apiKey.trim();
  }
  if (accessToken && typeof accessToken === 'string') {
    process.env.TMDB_ACCESS_TOKEN = accessToken.trim();
  }
  if (language && typeof language === 'string') {
    process.env.TMDB_LANGUAGE = language.trim();
  }
  res.json({
    success: true,
    tmdbConfigured: isTmdbConfigured(),
    tmdbLanguage: getLanguage(),
  });
});

// 13.0.0.2 Search TMDb titles
apiRouter.get('/system/tmdb/search', async (req: Request, res: Response) => {
  if (!isTmdbConfigured()) {
    res.status(503).json({ error: 'TMDb não configurado' });
    return;
  }
  const query = typeof req.query.query === 'string' ? req.query.query : '';
  const kind = req.query.kind === 'series' ? 'series' : 'movie';
  const results = await searchTmdb(query, kind);
  res.json({ results });
});

// 13.0.1 LAN addresses used by Chromecast to reach this local server
apiRouter.get('/system/cast-info', (req: Request, res: Response) => {
  const addresses = Object.values(os.networkInterfaces())
    .flatMap((entries) => entries || [])
    .filter((entry) => {
      const isIpv4 = entry.family === 'IPv4' || String(entry.family) === '4';
      return isIpv4 && !entry.internal && !entry.address.startsWith('169.254.');
    })
    .map((entry) => entry.address);

  res.json({
    protocol: req.app.locals.castMediaProtocol || null,
    port: Number(req.app.locals.castMediaPort) || null,
    addresses: [...new Set(addresses)],
  });
});

// 13.0.1b Full network and mobile LAN access info
apiRouter.get('/system/network-info', (req: Request, res: Response) => {
  const httpsRequested = process.env.HTTPS === 'true' || process.env.HTTPS === '1';
  const certificateDirectory = process.env.HTTPS_CERT_DIR || path.join(process.cwd(), 'certs');
  const pfxPath = process.env.HTTPS_PFX_PATH || path.join(certificateDirectory, 'cinelocal.pfx');
  const useHttps = httpsRequested && fs.existsSync(pfxPath);
  const protocol = useHttps ? 'https' : 'http';

  const configuredPort = Number(process.env.PORT);
  const port = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 3000;

  const addresses = Object.values(os.networkInterfaces())
    .flatMap((entries) => entries || [])
    .filter((entry) => {
      const isIpv4 = entry.family === 'IPv4' || String(entry.family) === '4';
      return isIpv4 && !entry.internal && !entry.address.startsWith('169.254.');
    })
    .map((entry) => entry.address);

  const uniqueAddresses = [...new Set(addresses)];
  const mobileUrls = uniqueAddresses.map((ip) => `${protocol}://${ip}:${port}`);

  res.json({
    protocol,
    port,
    addresses: uniqueAddresses,
    mobileUrls,
    certPath: path.join(certificateDirectory, 'cinelocal.crt'),
  });
});

// 13.0.2 Configure Hardware Acceleration
apiRouter.post('/system/hardware-acceleration', (req: Request, res: Response) => {
  const { mode, encoder } = req.body || {};
  if (mode && !['auto', 'software', 'off'].includes(mode)) {
    res.status(400).json({ error: 'Modo inválido. Use auto, software ou off.' });
    return;
  }
  setHardwareAccelerationConfig({
    mode: mode as any,
    encoder: typeof encoder === 'string' ? encoder : undefined,
  });
  res.json({ success: true, hardwareAcceleration: getHardwareAccelerationStatus() });
});

// 13.1 Install Portable FFmpeg into ./bin/
apiRouter.post('/system/install-ffmpeg', async (req: Request, res: Response) => {
  try {
    const result = await downloadAndInstallFFmpeg();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Erro ao baixar FFmpeg' });
  }
});

// 13.5 Native System Explorer Folder Picker
apiRouter.post('/system/pick-folder', (req: Request, res: Response) => {
  const platform = process.platform;

  if (platform === 'win32') {
    // Windows: Use PowerShell Shell.Application BrowseForFolder dialog
    const script = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
$app = New-Object -ComObject Shell.Application;
$folder = $app.BrowseForFolder(0, 'Selecione a pasta onde estao seus filmes ou series:', 0, 0);
if ($folder -and $folder.Self.Path) {
    [Console]::Out.Write($folder.Self.Path)
}
`;
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: 120000, encoding: 'utf-8' },
      (error, stdout, stderr) => {
        if (error) {
          if ((error as any).killed) {
            res.json({ success: false, cancelled: true, message: 'Tempo limite esgotado' });
          } else {
            res.json({ success: false, unsupported: true, error: error.message });
          }
          return;
        }
        const selected = (stdout || '').trim();
        if (!selected) {
          res.json({ success: false, cancelled: true });
          return;
        }
        res.json({ success: true, folderPath: selected });
      }
    );
    return;
  }

  if (platform === 'darwin') {
    // macOS: Use AppleScript native folder chooser
    const script = `POSIX path of (choose folder with prompt "Selecione a pasta onde estao seus filmes ou series:")`;
    execFile('osascript', ['-e', script], { timeout: 120000, encoding: 'utf-8' }, (error, stdout) => {
      if (error) {
        res.json({ success: false, cancelled: true });
        return;
      }
      const selected = (stdout || '').trim();
      if (!selected) {
        res.json({ success: false, cancelled: true });
        return;
      }
      res.json({ success: true, folderPath: selected });
    });
    return;
  }

  if (platform === 'linux') {
    // Linux: check if X11/Wayland display is available
    if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
      res.json({
        success: false,
        unsupported: true,
        message: 'Ambiente gráfico não disponível para abrir explorador nativo',
      });
      return;
    }

    const cmd = `zenity --file-selection --directory --title="Selecione a pasta de midia" 2>/dev/null || kdialog --getexistingdirectory 2>/dev/null`;
    exec(cmd, { timeout: 120000, encoding: 'utf-8' }, (error, stdout) => {
      if (error) {
        res.json({ success: false, cancelled: true });
        return;
      }
      const selected = (stdout || '').trim();
      if (!selected) {
        res.json({ success: false, cancelled: true });
        return;
      }
      res.json({ success: true, folderPath: selected });
    });
    return;
  }

  res.json({
    success: false,
    unsupported: true,
    message: 'Sistema operacional não suportado para explorador nativo',
  });
});

// 14. Demo generator: creates sample MP4 and MKV media in ./demo_media/ so user can test immediately!
apiRouter.post('/system/generate-demo', async (req: Request, res: Response) => {
  const { ffmpeg } = getBinaries();
  if (!ffmpeg) {
    res.status(500).json({ error: 'FFmpeg não disponível para gerar mídia de demonstração' });
    return;
  }

  try {
    const demoDir = path.resolve(process.cwd(), 'demo_media', 'Cosmos - O Infinito');
    if (!fs.existsSync(demoDir)) {
      fs.mkdirSync(demoDir, { recursive: true });
    }

    const ep1 = path.join(demoDir, 'Cosmos.S01E01.A.Grande.Jornada.mp4');
    const ep2 = path.join(demoDir, 'Cosmos.S01E02.As.Estrelas.mkv');
    const poster = path.join(demoDir, 'folder.jpg');

    // Create poster image if not exists
    if (!fs.existsSync(poster)) {
      await new Promise((resolve, reject) => {
        execFile(
          ffmpeg,
          [
            '-f', 'lavfi',
            '-i', 'color=c=0x1a237e:s=600x900:d=1',
            '-vf', "drawtext=text='COSMOS':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=200,drawtext=text='TEMPORADA 1':fontcolor=0xffd700:fontsize=28:x=(w-text_w)/2:y=280",
            '-vframes', '1',
            '-y',
            poster,
          ],
          (err) => (err ? resolve(false) : resolve(true))
        );
      });
    }

    // Create Episode 1 (MP4) - 15s test video with audio
    if (!fs.existsSync(ep1)) {
      await new Promise((resolve) => {
        execFile(
          ffmpeg,
          [
            '-f', 'lavfi',
            '-i', 'testsrc=duration=20:size=1280x720:rate=30',
            '-f', 'lavfi',
            '-i', 'sine=frequency=440:duration=20',
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-metadata:s:a:0', 'language=por',
            '-metadata:s:a:0', 'title=Português (Brasil)',
            '-y',
            ep1,
          ],
          (err) => resolve(!err)
        );
      });
    }

    // Create Episode 2 (MKV) - 20s test video with 2 audio tracks and subtitle!
    if (!fs.existsSync(ep2)) {
      await new Promise((resolve) => {
        execFile(
          ffmpeg,
          [
            '-f', 'lavfi',
            '-i', 'smptebars=duration=25:size=1280x720:rate=30',
            '-f', 'lavfi',
            '-i', 'sine=frequency=520:duration=25',
            '-f', 'lavfi',
            '-i', 'sine=frequency=880:duration=25',
            '-map', '0:v',
            '-map', '1:a',
            '-map', '2:a',
            '-c:v', 'libx264',
            '-c:a', 'aac',
            '-metadata:s:a:0', 'language=por',
            '-metadata:s:a:0', 'title=Português (Dublado)',
            '-metadata:s:a:1', 'language=eng',
            '-metadata:s:a:1', 'title=Inglês (Original)',
            '-y',
            ep2,
          ],
          (err) => resolve(!err)
        );
      });
    }

    // Scan into library
    const mediaItem = await scanMediaFolder(demoDir, 'Cosmos: O Infinito');
    const lib = readLibrary();
    const existingIdx = lib.items.findIndex((i) => i.id === mediaItem.id);
    if (existingIdx >= 0) {
      lib.items[existingIdx] = mediaItem;
    } else {
      lib.items.push(mediaItem);
    }
    writeLibrary(lib);

    res.json({ success: true, item: mediaItem });
  } catch (err: any) {
    console.error('Error generating demo:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// TORRENT STREAMING API ENDPOINTS
// ==========================================

// 1. Start or connect to a torrent from Magnet URI or infoHash
apiRouter.post('/torrent/start', async (req: Request, res: Response) => {
  try {
    const { magnetUri } = req.body;
    if (!magnetUri || typeof magnetUri !== 'string') {
      res.status(400).json({ error: 'Link magnet ou hash do torrent é obrigatório' });
      return;
    }

    const record = await getOrCreateTorrentEngine(magnetUri);
    const status = getTorrentStatus(record.infoHash);
    res.json(status);
  } catch (err: any) {
    console.error('Erro ao iniciar torrent:', err);
    res.status(500).json({ error: err?.message || 'Erro ao iniciar torrent' });
  }
});

// 2. Get real-time status of a torrent
apiRouter.get('/torrent/status/:infoHash', (req: Request, res: Response) => {
  const { infoHash } = req.params;
  const status = getTorrentStatus(infoHash);
  res.json(status);
});

// 3. Select which file to prioritize for streaming
apiRouter.post('/torrent/select', (req: Request, res: Response) => {
  const { infoHash, fileIndex } = req.body;
  if (!infoHash || typeof fileIndex !== 'number') {
    res.status(400).json({ error: 'infoHash e fileIndex são obrigatórios' });
    return;
  }
  const ok = selectTorrentFile(infoHash, fileIndex);
  res.json({ success: ok });
});

// 4. Stream video file from torrent (HTTP Range 206 partial content + FFmpeg transcode support)
apiRouter.get('/torrent/stream/:infoHash/:fileIndex', async (req: Request, res: Response) => {
  const { infoHash, fileIndex } = req.params;
  const parsedIdx = parseInt(fileIndex, 10);
  const transcode = req.query.transcode === 'true' || req.query.transcode === '1';
  const isCast = req.query.cast === 'true' || req.query.cast === '1';

  const file = getTorrentFile(infoHash, isNaN(parsedIdx) ? 0 : parsedIdx);
  if (!file) {
    res.status(404).send('Arquivo do torrent não encontrado ou metadados ainda carregando.');
    return;
  }

  const ext = path.extname(file.name).toLowerCase();
  let contentType = 'video/mp4';
  if (ext === '.webm') contentType = 'video/webm';
  else if (ext === '.mkv') contentType = 'video/x-matroska';
  else if (ext === '.avi') contentType = 'video/x-msvideo';
  else if (ext === '.mov') contentType = 'video/quicktime';
  else if (ext === '.ts') contentType = 'video/mp2t';
  else if (ext === '.srt' || ext === '.vtt') contentType = 'text/plain; charset=utf-8';

  const totalSize = file.length || 0;

  // If live transcode requested for incompatible MKV/AVI/AC3 or Google Cast
  if (transcode || (isCast && (ext === '.mkv' || ext === '.avi' || ext === '.wmv'))) {
    const { ffmpeg } = getBinaries();
    if (!ffmpeg) {
      console.warn('[Torrent Stream] FFmpeg não encontrado para transcode.');
    } else {
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Connection': 'keep-alive',
      });

      const inputStream = file.createReadStream();
      const ffmpegProc = spawn(ffmpeg, [
        '-i', 'pipe:0',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-ac', '2',
        '-movflags', 'frag_keyframe+default_base_moof',
        '-f', 'mp4',
        'pipe:1'
      ]);

      inputStream.pipe(ffmpegProc.stdin);
      ffmpegProc.stdout.pipe(res);

      ffmpegProc.on('error', (err) => {
        console.error('Erro no FFmpeg transcode torrent:', err);
      });

      res.on('close', () => {
        try {
          inputStream.destroy();
          ffmpegProc.kill('SIGKILL');
        } catch {}
      });
      return;
    }
  }

  // Standard HTTP Range 206 Streaming (Direct Play)
  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, {
      'Content-Length': totalSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    });
    const stream = file.createReadStream();
    stream.pipe(res);
    res.on('close', () => {
      try { stream.destroy(); } catch {}
    });
    return;
  }

  const parts = range.replace(/bytes=/, '').split('-');
  const start = parseInt(parts[0], 10);
  const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;

  if (start >= totalSize || end >= totalSize || start > end) {
    res.status(416).set('Content-Range', `bytes */${totalSize}`).end();
    return;
  }

  const chunkSize = end - start + 1;
  res.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${totalSize}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': chunkSize,
    'Content-Type': contentType,
    'Cache-Control': 'no-cache',
  });

  const stream = file.createReadStream({ start, end });
  stream.pipe(res);

  stream.on('error', (err: any) => {
    console.error('[Torrent Stream Read Error]:', err);
    if (!res.headersSent) res.status(500).end();
  });

  res.on('close', () => {
    try {
      stream.destroy();
    } catch {}
  });
});

// 4.5. Update media kind (movie vs series)
apiRouter.post('/media/:id/kind', (req: Request, res: Response) => {
  const { id } = req.params;
  const { kind } = req.body;
  if (kind !== 'movie' && kind !== 'series') {
    res.status(400).json({ error: 'Tipo inválido (deve ser "movie" ou "series")' });
    return;
  }
  const updated = updateMediaKind(id, kind);
  if (!updated) {
    res.status(404).json({ error: 'Mídia não encontrada' });
    return;
  }
  res.json({ success: true, item: updated });
});

apiRouter.patch('/media/:id/kind', (req: Request, res: Response) => {
  const { id } = req.params;
  const { kind } = req.body;
  if (kind !== 'movie' && kind !== 'series') {
    res.status(400).json({ error: 'Tipo inválido (deve ser "movie" ou "series")' });
    return;
  }
  const updated = updateMediaKind(id, kind);
  if (!updated) {
    res.status(404).json({ error: 'Mídia não encontrada' });
    return;
  }
  res.json({ success: true, item: updated });
});

// 5. Get recent torrent history
apiRouter.get('/torrent/history', (_req: Request, res: Response) => {
  const history = readTorrentHistory();
  const lib = readLibrary();
  const enriched = history.map((item) => {
    const cleanHash = item.infoHash.toLowerCase();
    const media = lib.items.find(
      (m) => (m.infoHash && m.infoHash.toLowerCase() === cleanHash) || m.id === `torrent_${cleanHash}`
    );
    const inferredKind = media?.kind || (/[Ss]\d{1,2}|Season\s*\d+|Temporada\s*\d+/i.test(item.name) ? 'series' : 'movie');
    return {
      ...item,
      kind: inferredKind,
    };
  });
  res.json(enriched);
});

// 6. Save watch progress for a torrent
apiRouter.post('/torrent/progress', (req: Request, res: Response) => {
  const { infoHash, magnetUri, name, progressSeconds, durationSeconds, selectedFileIndex, totalBytes } = req.body;
  if (!infoHash) {
    res.status(400).json({ error: 'infoHash é obrigatório' });
    return;
  }

  saveTorrentHistoryItem({
    infoHash,
    magnetUri: magnetUri || `magnet:?xt=urn:btih:${infoHash}`,
    name,
    progressSeconds: Math.floor(progressSeconds || 0),
    durationSeconds: Math.floor(durationSeconds || 0),
    selectedFileIndex: selectedFileIndex || 0,
    totalBytes: totalBytes || 0,
  });

  try {
    updateTorrentProgressInLibrary(
      infoHash,
      selectedFileIndex || 0,
      progressSeconds || 0,
      durationSeconds || 0
    );
  } catch (err) {
    console.error('Erro ao atualizar progresso do torrent na biblioteca:', err);
  }

  res.json({ success: true });
});

// 7. Remove torrent from history
apiRouter.delete('/torrent/history/:infoHash', (req: Request, res: Response) => {
  const { infoHash } = req.params;
  removeTorrentHistoryItem(infoHash);
  res.json({ success: true });
});

// 8. Stop active torrent engine
apiRouter.post('/torrent/stop', async (req: Request, res: Response) => {
  const { infoHash, deleteCache } = req.body;
  if (!infoHash) {
    res.status(400).json({ error: 'infoHash é obrigatório' });
    return;
  }
  const ok = await stopTorrent(infoHash, deleteCache === true);
  res.json({ success: ok });
});

// ==========================================
// IPTV Live Channels Endpoints
// ==========================================

const IPTV_FAVORITES_FILE = path.join(getDataDir(), 'iptv_favorites.json');

function getIptvFavorites(): string[] {
  try {
    if (fs.existsSync(IPTV_FAVORITES_FILE)) {
      return JSON.parse(fs.readFileSync(IPTV_FAVORITES_FILE, 'utf-8'));
    }
  } catch {}
  return [];
}

function saveIptvFavorites(favs: string[]) {
  try {
    fs.writeFileSync(IPTV_FAVORITES_FILE, JSON.stringify(favs, null, 2), 'utf-8');
  } catch (err) {
    console.error('Erro ao salvar favoritos IPTV:', err);
  }
}

// 1. Get preset playlists
apiRouter.get('/iptv/presets', (_req: Request, res: Response) => {
  res.json(IPTV_PRESETS);
});

// 2. Fetch and parse playlist
apiRouter.get('/iptv/playlist', async (req: Request, res: Response) => {
  try {
    const url = (req.query.url as string) || 'https://iptv-org.github.io/iptv/index.m3u';
    const forceRefresh = req.query.refresh === 'true';
    const summary = await fetchIptvPlaylist(url, forceRefresh);
    res.json(summary);
  } catch (error: any) {
    console.error('Erro ao carregar playlist IPTV:', error);
    res.status(500).json({ error: error.message || 'Falha ao carregar playlist IPTV' });
  }
});

// 3. Parse custom uploaded M3U content
apiRouter.post('/iptv/parse-custom', (req: Request, res: Response) => {
  try {
    const { content, name } = req.body;
    if (!content || typeof content !== 'string') {
      res.status(400).json({ error: 'Conteúdo M3U inválido' });
      return;
    }
    const summary = parseM3U(content, name || 'Playlist Personalizada');
    res.json(summary);
  } catch (error: any) {
    console.error('Erro ao processar M3U personalizado:', error);
    res.status(500).json({ error: error.message || 'Erro ao processar M3U' });
  }
});

// 4. Get favorite channel IDs
apiRouter.get('/iptv/favorites', (_req: Request, res: Response) => {
  res.json({ favorites: getIptvFavorites() });
});

// 5. Toggle or update favorites
apiRouter.post('/iptv/favorites', (req: Request, res: Response) => {
  const { channelId, isFavorite, favorites } = req.body;
  let current = getIptvFavorites();

  if (Array.isArray(favorites)) {
    current = favorites;
  } else if (channelId) {
    if (isFavorite === true) {
      if (!current.includes(channelId)) current.push(channelId);
    } else if (isFavorite === false) {
      current = current.filter((id) => id !== channelId);
    } else {
      // Toggle
      if (current.includes(channelId)) {
        current = current.filter((id) => id !== channelId);
      } else {
        current.push(channelId);
      }
    }
  }

  saveIptvFavorites(current);
  res.json({ success: true, favorites: current });
});

// 5.1 IPTV Channel Status Tracking & Batch Prober
apiRouter.get('/iptv/statuses', (_req: Request, res: Response) => {
  const map = readIptvStatusMap();
  res.json(map);
});

apiRouter.post('/iptv/report-status', (req: Request, res: Response) => {
  const { url, status } = req.body;
  if (!url || !status) {
    res.status(400).json({ error: 'url e status são obrigatórios' });
    return;
  }
  const map = readIptvStatusMap();
  map[url] = {
    status: status === 'online' ? 'online' : 'offline',
    lastChecked: new Date().toISOString(),
  };
  saveIptvStatusMap(map);
  res.json({ success: true, status: map[url] });
});

apiRouter.post('/iptv/check-batch', async (req: Request, res: Response) => {
  const urls: string[] = req.body.urls;
  if (!Array.isArray(urls) || urls.length === 0) {
    res.json({ results: {} });
    return;
  }

  // Cap at 60 URLs per batch request to prevent abuse
  const targetUrls = urls.slice(0, 60);
  const statusMap = readIptvStatusMap();
  const results: Record<string, { status: 'online' | 'offline'; lastChecked: string }> = {};

  const probeChannel = async (channelUrl: string) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      const parsedTarget = new URL(channelUrl);
      const resp = await fetch(channelUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20 (Windows NT 10.0; Win64; x64)',
          Referer: parsedTarget.origin,
          Range: 'bytes=0-2048',
          Accept: '*/*',
        },
        signal: controller.signal,
        redirect: 'follow',
      });

      clearTimeout(timeoutId);

      if (!resp.ok && resp.status !== 206) {
        const entry = { status: 'offline' as const, lastChecked: new Date().toISOString() };
        results[channelUrl] = entry;
        statusMap[channelUrl] = entry;
        return;
      }

      const contentType = (resp.headers.get('content-type') || '').toLowerCase();
      
      // Read first chunk of body
      const buffer = await resp.arrayBuffer().catch(() => new ArrayBuffer(0));
      const textSample = Buffer.from(buffer).toString('utf-8', 0, Math.min(buffer.byteLength, 1024));

      // Check if it is a fake 200 OK returning HTML error page
      const isHtml =
        contentType.includes('text/html') ||
        textSample.toLowerCase().includes('<!doctype html') ||
        textSample.toLowerCase().includes('<html') ||
        textSample.toLowerCase().includes('403 forbidden') ||
        textSample.toLowerCase().includes('access denied');

      const isM3U8 =
        textSample.includes('#EXTM3U') ||
        textSample.includes('#EXTINF') ||
        textSample.includes('#EXT-X-') ||
        contentType.includes('mpegurl');

      const isTsOrVideo =
        contentType.includes('video/') ||
        contentType.includes('application/octet-stream') ||
        (buffer.byteLength > 0 && Buffer.from(buffer)[0] === 0x47);

      const isOnline = !isHtml && (isM3U8 || isTsOrVideo || buffer.byteLength > 100);
      const statusValue: 'online' | 'offline' = isOnline ? 'online' : 'offline';
      const entry = { status: statusValue, lastChecked: new Date().toISOString() };
      results[channelUrl] = entry;
      statusMap[channelUrl] = entry;
    } catch {
      const entry = { status: 'offline' as const, lastChecked: new Date().toISOString() };
      results[channelUrl] = entry;
      statusMap[channelUrl] = entry;
    }
  };

  // Run in chunks of 8 concurrent requests
  const CHUNK_SIZE = 8;
  for (let i = 0; i < targetUrls.length; i += CHUNK_SIZE) {
    const chunk = targetUrls.slice(i, i + CHUNK_SIZE);
    await Promise.all(chunk.map((u) => probeChannel(u)));
  }

  saveIptvStatusMap(statusMap);
  res.json({ results });
});

// 6. IPTV Stream & M3U8 CORS Proxy (with VLC Header Emulation & Redirect Resolution)
apiRouter.get('/iptv/proxy', async (req: Request, res: Response) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl) {
    res.status(400).send('URL é obrigatória');
    return;
  }

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  try {
    const parsedTarget = new URL(targetUrl);
    const userAgent =
      (req.query.userAgent as string) ||
      'VLC/3.0.20 LibVLC/3.0.20 (Windows NT 10.0; Win64; x64)';
    const referrer = (req.query.referrer as string) || parsedTarget.origin;
    const country = (req.query.country as string) || '';

    const fetchHeaders: Record<string, string> = {
      'User-Agent': userAgent,
      Referer: referrer,
      Origin: parsedTarget.origin,
      Accept: '*/*',
      Connection: 'keep-alive',
    };

    // Forward country-specific IP simulation if country is provided
    if (country === 'BR') {
      fetchHeaders['X-Forwarded-For'] = '177.18.200.50';
      fetchHeaders['Client-IP'] = '177.18.200.50';
    } else if (country === 'PT') {
      fetchHeaders['X-Forwarded-For'] = '188.82.100.20';
      fetchHeaders['Client-IP'] = '188.82.100.20';
    } else if (country === 'US') {
      fetchHeaders['X-Forwarded-For'] = '198.51.100.42';
      fetchHeaders['Client-IP'] = '198.51.100.42';
    }

    if (req.headers.range) {
      fetchHeaders['Range'] = req.headers.range;
    }

    const response = await fetch(targetUrl, {
      headers: fetchHeaders,
      redirect: 'follow',
    });

    if (!response.ok && response.status !== 206) {
      res.status(response.status).send(`Erro do stream remoto: ${response.statusText}`);
      return;
    }

    // Base URL for relative segments must follow redirects!
    const finalBaseUrl = response.url || targetUrl;
    const contentType = response.headers.get('content-type') || '';
    const isM3U8 =
      contentType.includes('mpegurl') ||
      contentType.includes('application/vnd.apple.mpegurl') ||
      contentType.includes('application/x-mpegurl') ||
      finalBaseUrl.includes('.m3u8') ||
      finalBaseUrl.includes('playlist') ||
      finalBaseUrl.includes('.m3u');

    if (isM3U8) {
      const text = await response.text();
      // Check if it's really an M3U8 playlist
      if (text.includes('#EXTM3U') || text.includes('#EXTINF') || text.includes('#EXT-X-')) {
        const lines = text.split(/\r?\n/);
        const rewrittenLines: string[] = [];

        const extraQueryParams =
          (req.query.userAgent ? `&userAgent=${encodeURIComponent(req.query.userAgent as string)}` : '') +
          (req.query.referrer ? `&referrer=${encodeURIComponent(req.query.referrer as string)}` : '') +
          (req.query.country ? `&country=${encodeURIComponent(req.query.country as string)}` : '');

        for (let line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            rewrittenLines.push(line);
            continue;
          }

          if (trimmed.startsWith('#EXT-X-KEY:') || trimmed.startsWith('#EXT-X-MAP:')) {
            // Rewrite URI="..." inside tags
            const rewrittenTag = trimmed.replace(/URI="([^"]+)"/g, (_, uri) => {
              try {
                const absUrl = new URL(uri, finalBaseUrl).href;
                const proxyUrl = `/api/iptv/proxy?url=${encodeURIComponent(absUrl)}${extraQueryParams}`;
                return `URI="${proxyUrl}"`;
              } catch {
                return `URI="${uri}"`;
              }
            });
            rewrittenLines.push(rewrittenTag);
          } else if (trimmed.startsWith('#')) {
            rewrittenLines.push(line);
          } else {
            // It's a stream segment or variant playlist URI
            try {
              const absUrl = new URL(trimmed, finalBaseUrl).href;
              const proxyUrl = `/api/iptv/proxy?url=${encodeURIComponent(absUrl)}${extraQueryParams}`;
              rewrittenLines.push(proxyUrl);
            } catch {
              rewrittenLines.push(line);
            }
          }
        }

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(rewrittenLines.join('\n'));
        return;
      } else {
        // If response.text() was consumed but not a valid m3u8 playlist, send it directly
        if (contentType) {
          res.setHeader('Content-Type', contentType);
        }
        res.status(response.status).send(text);
        return;
      }
    }

    // Binary / TS stream or direct media chunk (response.body not yet consumed)
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }
    const acceptRanges = response.headers.get('accept-ranges');
    if (acceptRanges) {
      res.setHeader('Accept-Ranges', acceptRanges);
    }
    const contentRange = response.headers.get('content-range');
    if (contentRange) {
      res.setHeader('Content-Range', contentRange);
    }

    res.status(response.status);

    if (response.body) {
      try {
        const nodeStream = Readable.fromWeb(response.body as any);
        nodeStream.on('error', () => {
          if (!res.writableEnded) res.end();
        });
        res.on('close', () => {
          try {
            nodeStream.destroy();
          } catch {}
        });
        nodeStream.pipe(res);
      } catch (streamErr) {
        const arrayBuf = await response.arrayBuffer();
        res.send(Buffer.from(arrayBuf));
      }
    } else {
      res.end();
    }
  } catch (proxyError: any) {
    console.error('Erro no proxy IPTV:', proxyError);
    if (!res.headersSent) {
      res.status(502).send(`Falha ao conectar com o stream: ${proxyError.message}`);
    }
  }
});

// 7. FFmpeg Live Stream Transmuxer (converts raw TS / RTSP / HTTP to web-compatible fragmented MP4 on-the-fly)
apiRouter.get('/iptv/transmux', (req: Request, res: Response) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl) {
    res.status(400).send('URL é obrigatória');
    return;
  }

  const { ffmpeg } = getBinaries();
  if (!ffmpeg) {
    res.status(503).send('FFmpeg não encontrado no sistema para modo transmux');
    return;
  }

  const userAgent =
    (req.query.userAgent as string) ||
    'VLC/3.0.20 LibVLC/3.0.20 (Windows NT 10.0; Win64; x64)';
  const referrer = (req.query.referrer as string) || '';
  const country = (req.query.country as string) || '';

  const headersList = [
    `User-Agent: ${userAgent}`,
    `Accept: */*`,
    `Connection: keep-alive`,
  ];

  if (referrer) {
    headersList.push(`Referer: ${referrer}`);
  }
  if (country === 'BR') {
    headersList.push('X-Forwarded-For: 177.18.200.50');
    headersList.push('Client-IP: 177.18.200.50');
  } else if (country === 'PT') {
    headersList.push('X-Forwarded-For: 188.82.100.20');
    headersList.push('Client-IP: 188.82.100.20');
  } else if (country === 'US') {
    headersList.push('X-Forwarded-For: 198.51.100.42');
    headersList.push('Client-IP: 198.51.100.42');
  }

  const args = [
    '-protocol_whitelist', 'file,http,https,tcp,tls,crypto,data',
    '-allowed_extensions', 'ALL',
    '-headers', headersList.join('\r\n') + '\r\n',
    '-user_agent', userAgent,
    '-i', targetUrl,
    '-map', '0:v:0?',
    '-map', '0:a:0?',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-crf', '25',
    '-pix_fmt', 'yuv420p',
    '-g', '25',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    '-ac', '2',
    '-f', 'mp4',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    'pipe:1',
  ];

  console.log(`[FFmpeg IPTV Transmux] Iniciando streaming de: ${targetUrl}`);
  const proc = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  let hasSentData = false;
  let stderrBuffer = '';

  proc.stdout.on('data', (chunk) => {
    if (!hasSentData) {
      hasSentData = true;
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-cache, no-store');
      res.status(200);
    }
    res.write(chunk);
  });

  proc.stderr.on('data', (d) => {
    const msg = d.toString();
    stderrBuffer += msg;
    if (stderrBuffer.length > 2000) {
      stderrBuffer = stderrBuffer.substring(stderrBuffer.length - 2000);
    }
    if (msg.includes('Error') || msg.includes('403') || msg.includes('404')) {
      console.warn('[FFmpeg IPTV Transmux]', msg.trim());
    }
  });

  proc.on('close', (code) => {
    if (!hasSentData && !res.headersSent) {
      if (stderrBuffer.includes('403 Forbidden')) {
        res.status(403).send('Servidor remoto retornou 403 Forbidden (Acesso negado pela emissora)');
      } else if (stderrBuffer.includes('404 Not Found')) {
        res.status(404).send('Servidor remoto retornou 404 (Sinal não encontrado)');
      } else {
        res.status(502).send(`Falha ao decodificar stream via FFmpeg (Código ${code})`);
      }
    } else {
      if (!res.writableEnded) res.end();
    }
  });

  const cleanup = () => {
    try {
      proc.kill('SIGKILL');
    } catch {}
  };

  req.on('close', cleanup);
  res.on('finish', cleanup);
});

// 8. Generate and download VLC M3U Launcher
apiRouter.get('/iptv/export-m3u', (req: Request, res: Response) => {
  const streamUrl = req.query.url as string;
  const name = (req.query.name as string) || 'Canal IPTV';
  const logo = (req.query.logo as string) || '';
  const group = (req.query.group as string) || 'Geral';
  const userAgent = req.query.userAgent as string;

  if (!streamUrl) {
    res.status(400).send('URL do stream é obrigatória');
    return;
  }

  let m3uContent = '#EXTM3U\n';
  m3uContent += `#EXTINF:-1 tvg-logo="${logo}" group-title="${group}",${name}\n`;
  if (userAgent) {
    m3uContent += `#EXTVLCOPT:http-user-agent=${userAgent}\n`;
  }
  m3uContent += `${streamUrl}\n`;

  res.setHeader('Content-Type', 'audio/x-mpegurl');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name.replace(/[^a-zA-Z0-9_-]/g, '_'))}.m3u"`);
  res.send(m3uContent);
});
