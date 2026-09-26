import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, ChildProcess } from 'child_process';
import { getBinaries, getHardwareAccelerationStatus, getVideoEncodingPlan } from './ffmpeg';

interface HlsSession {
  sessionId: string;
  mediaId: string;
  episodeId: string;
  audioIndex: number;
  startSeconds: number;
  transcoded: boolean;
  sessionDir: string;
  manifestPath: string;
  process?: ChildProcess;
  createdAt: number;
  lastAccess: number;
  isComplete: boolean;
}

const activeSessions = new Map<string, HlsSession>();
const inFlightSessions = new Map<string, Promise<{ sessionId: string; manifestPath: string; sessionDir: string }>>();

// Keep HLS data beside the portable app by default instead of using the
// Windows system temp folder (usually on C:). HLS_CACHE_DIR can point to a
// dedicated disk when the library is large.
function resolveHlsBaseDir(): string {
  const configuredDirectory = process.env.HLS_CACHE_DIR?.trim();
  const preferredDirectory = configuredDirectory
    ? path.resolve(configuredDirectory)
    : path.join(process.cwd(), '.cache', 'hls');

  try {
    fs.mkdirSync(preferredDirectory, { recursive: true });
    return preferredDirectory;
  } catch (error: any) {
    const fallbackDirectory = path.join(os.tmpdir(), 'cinelocal_hls');
    try {
      fs.mkdirSync(fallbackDirectory, { recursive: true });
      console.warn(
        `[HLS] Não foi possível usar o cache configurado em ${preferredDirectory}. ` +
        `Usando o temporário do sistema: ${fallbackDirectory}. ${error?.message || ''}`
      );
    } catch {}
    return fallbackDirectory;
  }
}

const HLS_BASE_DIR = resolveHlsBaseDir();
const HLS_SESSION_IDLE_MS = 15 * 60 * 1000;
const configuredCacheLimitMb = Number(process.env.HLS_CACHE_MAX_MB);
const HLS_CACHE_LIMIT_BYTES = Number.isFinite(configuredCacheLimitMb) && configuredCacheLimitMb > 0
  ? configuredCacheLimitMb * 1024 * 1024
  : 4 * 1024 * 1024 * 1024;

function getDirectorySize(directory: string): number {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        total += getDirectorySize(entryPath);
      } else if (entry.isFile()) {
        total += fs.statSync(entryPath).size;
      }
    }
  } catch {}
  return total;
}

function removeOrphanedCacheSessions() {
  try {
    for (const entry of fs.readdirSync(HLS_BASE_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      fs.rmSync(path.join(HLS_BASE_DIR, entry.name), { recursive: true, force: true });
    }
  } catch (error: any) {
    console.warn(`[HLS] Não foi possível limpar sessões antigas: ${error?.message || error}`);
  }
}

function enforceCacheLimit() {
  let entries: Array<{ directory: string; size: number; modifiedAt: number }> = [];
  try {
    entries = fs.readdirSync(HLS_BASE_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const directory = path.join(HLS_BASE_DIR, entry.name);
        let modifiedAt = 0;
        try {
          modifiedAt = fs.statSync(directory).mtimeMs;
        } catch {}
        return { directory, size: getDirectorySize(directory), modifiedAt };
      })
      .sort((a, b) => a.modifiedAt - b.modifiedAt);
  } catch {
    return;
  }

  let totalSize = entries.reduce((total, entry) => total + entry.size, 0);
  if (totalSize <= HLS_CACHE_LIMIT_BYTES) return;

  const activeDirectories = new Set(
    Array.from(activeSessions.values()).map((session) => path.resolve(session.sessionDir))
  );

  for (const entry of entries) {
    if (totalSize <= HLS_CACHE_LIMIT_BYTES) break;
    if (activeDirectories.has(path.resolve(entry.directory))) continue;

    try {
      fs.rmSync(entry.directory, { recursive: true, force: true });
      totalSize -= entry.size;
    } catch {}
  }
}

// A crashed/restarted server leaves no in-memory session registry. Remove
// only children of the dedicated HLS cache directory at startup.
removeOrphanedCacheSessions();

// Cleanup inactive sessions and enforce a bounded cache every 5 minutes.
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of activeSessions.entries()) {
    if (now - session.lastAccess > HLS_SESSION_IDLE_MS) {
      cleanupSession(id);
    }
  }
  enforceCacheLimit();
}, 5 * 60 * 1000);

export function cleanupSession(sessionId: string) {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  if (session.process && !session.process.killed) {
    try {
      session.process.kill('SIGKILL');
    } catch {}
  }

  activeSessions.delete(sessionId);

  try {
    if (fs.existsSync(session.sessionDir)) {
      fs.rmSync(session.sessionDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn(`[HLS] Error removing directory for session ${sessionId}:`, err);
  }
}

export function findActiveSession(
  mediaId: string,
  episodeId: string,
  audioTrackIndex?: number,
  transcoded = false,
  startSeconds = 0
): HlsSession | undefined {
  if (audioTrackIndex !== undefined) {
    const key = `${mediaId}_${episodeId}_a${audioTrackIndex}_s${Math.floor(startSeconds)}${transcoded ? '_t' : ''}`;
    const s = activeSessions.get(key);
    if (s) {
      s.lastAccess = Date.now();
      return s;
    }

    // A requested audio track must never fall back to another track's
    // session. Doing so silently locks playback to whichever audio session
    // happened to be created first.
    return undefined;
  }

  // Fallback to any active session for this media/episode
  for (const session of activeSessions.values()) {
    if (
      session.mediaId === mediaId &&
      session.episodeId === episodeId &&
      session.transcoded === transcoded &&
      Math.floor(session.startSeconds) === Math.floor(startSeconds)
    ) {
      session.lastAccess = Date.now();
      return session;
    }
  }
  return undefined;
}

function spawnFfmpegHls(
  ffmpegBin: string,
  filePath: string,
  manifestPath: string,
  sessionDir: string,
  audioStreamIndex: number | undefined,
  canCopy: boolean,
  startSeconds = 0,
  preferHardware = true
): ChildProcess {
  const args: string[] = [
    // This is a local file, not a live input. `nobuffer` disables the demuxer
    // reordering/buffering that MKV/H.264 needs and can produce uneven PTS.
    '-fflags', '+genpts+discardcorrupt+igndts',
    '-err_detect', 'ignore_err',
    '-analyzeduration', '20M',
    '-probesize', '20M',
  ];

  if (startSeconds > 0) {
    // Seek at the input before FFmpeg starts producing HLS segments.
    args.push('-ss', startSeconds.toString());
  }

  const videoEncodingPlan = getVideoEncodingPlan(preferHardware);
  if (!canCopy && videoEncodingPlan.hardware) {
    args.push(...videoEncodingPlan.inputArgs);
  }

  args.push('-i', filePath, '-map', '0:V:0?');

  if (audioStreamIndex !== undefined) {
    args.push('-map', `0:${audioStreamIndex}?`);
  } else {
    args.push('-map', '0:a:0?');
  }

  if (canCopy) {
    args.push(
      '-c:v', 'copy',
      '-bsf:v', 'h264_mp4toannexb'
    );
  } else {
    args.push(...videoEncodingPlan.outputArgs, '-g', '60', '-keyint_min', '30', '-sc_threshold', '0', '-threads', '0');
  }

  args.push(
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ac', '2',
    '-af', 'aresample=async=1000:min_hard_comp=0.100000:first_pts=0',
    '-avoid_negative_ts', 'make_zero',
    '-f', 'hls',
    '-hls_time', '4',
    '-hls_list_size', '0',
    '-hls_playlist_type', 'event',
    // Never expose a playlist/segment while FFmpeg is still writing it.
    '-hls_flags', 'independent_segments+temp_file',
    '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', path.join(sessionDir, 'segment_%04d.ts'),
    manifestPath
  );

  const proc = spawn(ffmpegBin, args, { stdio: ['ignore', 'ignore', 'pipe'] });

  // Attach immediate error handler on ChildProcess to prevent unhandled 'error' event crash
  proc.on('error', (err) => {
    console.error(`[HLS Server Error] FFmpeg spawn error (${ffmpegBin}):`, err);
  });
  return proc;
}

export async function getOrCreateHlsSession(
  mediaId: string,
  episodeId: string,
  filePath: string,
  audioStreamIndex: number | undefined,
  audioTrackIndex: number = 0,
  canDirectCopyVideo: boolean = false,
  forceTranscode = false,
  startSeconds = 0
): Promise<{ sessionId: string; manifestPath: string; sessionDir: string }> {
  const transcoded = forceTranscode || !canDirectCopyVideo;
  const sessionId = `${mediaId}_${episodeId}_a${audioTrackIndex}_s${Math.floor(startSeconds)}${transcoded ? '_t' : ''}`;
  const existing = activeSessions.get(sessionId);

  if (existing && fs.existsSync(existing.manifestPath)) {
    existing.lastAccess = Date.now();
    return {
      sessionId,
      manifestPath: existing.manifestPath,
      sessionDir: existing.sessionDir,
    };
  }

  if (inFlightSessions.has(sessionId)) {
    return inFlightSessions.get(sessionId)!;
  }

  const sessionPromise = (async () => {
    // Clean up any stale directory for this session
    const sessionDir = path.join(HLS_BASE_DIR, sessionId);
    if (fs.existsSync(sessionDir)) {
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      } catch {}
    }
    try {
      fs.mkdirSync(sessionDir, { recursive: true });
    } catch {}

    const manifestPath = path.join(sessionDir, 'master.m3u8');
    const { ffmpeg } = getBinaries();
    if (!ffmpeg) {
      throw new Error(
        'FFmpeg não encontrado no computador. Para reproduzir arquivos MKV ou transcodificar áudio, instale o FFmpeg ou coloque o executável ffmpeg.exe na pasta "bin" do CineLocal.'
      );
    }

    let proc: ChildProcess;
    let stderrTail = '';
    let hasExited = false;
    let exitCode: number | null = null;
    let spawnError: Error | null = null;

    // A Cast session must always use the H.264/AAC path when transcoding is
    // requested, even if the source video could otherwise be copied.
    const copyVideo = canDirectCopyVideo && !forceTranscode;

    // Try direct copy first if eligible, otherwise transcode with hardware
    // encoding when the installed FFmpeg exposes a compatible encoder.
    try {
      const hardwareAttempt = !copyVideo && getHardwareAccelerationStatus().mode === 'auto' && !!getHardwareAccelerationStatus().encoder;
      proc = spawnFfmpegHls(ffmpeg, filePath, manifestPath, sessionDir, audioStreamIndex, copyVideo, startSeconds, hardwareAttempt);
      (proc as any).__cinelocalHardwareAttempt = hardwareAttempt;
    } catch (err: any) {
      throw new Error(`Erro ao iniciar processo FFmpeg: ${err.message}`);
    }

    proc.on('error', (err) => {
      spawnError = err;
      console.error(`[HLS] Process error for session ${sessionId}:`, err);
    });

    proc.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      stderrTail = (stderrTail + text).slice(-2000);
    });

    proc.on('close', (code) => {
      hasExited = true;
      exitCode = code;
      if (code !== 0 && code !== null && !proc.killed) {
        console.warn(`[HLS Server Warning] FFmpeg finalizou com código ${code}. Stderr:\n${stderrTail.trim()}`);
      }
    });

    // Wait for the initial manifest file to be generated
    const startTime = Date.now();
    let manifestReady = false;

    while (Date.now() - startTime < 8000) {
      if (spawnError) break;

      if (fs.existsSync(manifestPath)) {
        try {
          const content = fs.readFileSync(manifestPath, 'utf8');
          if (content.includes('#EXTM3U')) {
            manifestReady = true;
            break;
          }
        } catch {}
      }

      if (hasExited && exitCode !== 0) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    // If copy or hardware encoding failed, retry once with software libx264.
    const hardwareAttempt = Boolean((proc as any).__cinelocalHardwareAttempt);
    if ((!manifestReady || (hasExited && exitCode !== 0)) && (copyVideo || hardwareAttempt)) {
      console.warn(`[HLS] ${hardwareAttempt ? 'Hardware/transcode' : 'Remux'} failed, attempting software fallback...`);
      try {
        proc.kill('SIGKILL');
      } catch {}

      stderrTail = '';
      hasExited = false;
      exitCode = null;
      spawnError = null;

      try {
        proc = spawnFfmpegHls(ffmpeg, filePath, manifestPath, sessionDir, audioStreamIndex, false, startSeconds, false);
        proc.on('error', (err) => {
          spawnError = err;
          console.error(`[HLS Fallback] Process error for session ${sessionId}:`, err);
        });
        proc.stderr?.on('data', (chunk) => {
          stderrTail = (stderrTail + chunk.toString()).slice(-1500);
        });
        proc.on('close', (code) => {
          hasExited = true;
          exitCode = code;
        });

        const fallbackStart = Date.now();
        while (Date.now() - fallbackStart < 8000) {
          if (spawnError) break;
          if (fs.existsSync(manifestPath)) {
            try {
              const content = fs.readFileSync(manifestPath, 'utf8');
              if (content.includes('#EXTM3U')) {
                manifestReady = true;
                break;
              }
            } catch {}
          }
          if (hasExited && exitCode !== 0) break;
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
      } catch (fallbackErr) {
        console.error('[HLS Fallback] Failed to spawn fallback transcode:', fallbackErr);
      }
    }

    if (!fs.existsSync(manifestPath)) {
      if (spawnError) {
        throw new Error(`Erro ao executar o FFmpeg (${(spawnError as any).message || 'ENOENT'}). Verifique o executável do FFmpeg.`);
      }
      throw new Error(`Falha ao gerar o fluxo HLS: ${stderrTail.slice(-400) || 'FFmpeg encerrou sem gerar arquivo de streaming.'}`);
    }

    const session: HlsSession = {
      sessionId,
      mediaId,
      episodeId,
      audioIndex: audioTrackIndex,
      startSeconds,
      transcoded,
      sessionDir,
      manifestPath,
      process: proc,
      createdAt: Date.now(),
      lastAccess: Date.now(),
      isComplete: hasExited && exitCode === 0,
    };

    proc.on('close', (code) => {
      if (code === 0) {
        session.isComplete = true;
      }
    });

    activeSessions.set(sessionId, session);

    return {
      sessionId,
      manifestPath,
      sessionDir,
    };
  })();

  inFlightSessions.set(sessionId, sessionPromise);

  try {
    const res = await sessionPromise;
    return res;
  } finally {
    inFlightSessions.delete(sessionId);
  }
}
