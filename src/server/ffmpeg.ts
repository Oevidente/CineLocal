import { spawn, execFile, spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AudioTrackInfo, HardwareAccelerationStatus, SubtitleTrackInfo } from '../types';
import { getThumbnailDir } from './storage';

export interface FFprobeData {
  durationSeconds: number;
  videoCodec?: string;
  pixFmt?: string;
  resolution?: string;
  audioTracks: AudioTrackInfo[];
  subtitleTracks: SubtitleTrackInfo[];
}

let cachedFfmpegPath: string | null | undefined = undefined;
let cachedFfprobePath: string | null | undefined = undefined;
let cachedHardwareStatus: HardwareAccelerationStatus | undefined;

// Test if an executable or command name actually exists and can be executed
function testExecutable(binPath: string, arg: string = '-version'): boolean {
  try {
    const result = spawnSync(binPath, [arg], {
      timeout: 3000,
      windowsHide: true,
      stdio: 'ignore',
    });
    return result.status === 0 || (result.error === undefined && result.status !== null);
  } catch {
    return false;
  }
}

// Find portable or system ffmpeg/ffprobe binary paths safely
export function getBinaries(): { ffmpeg: string | null; ffprobe: string | null } {
  if (cachedFfmpegPath !== undefined && cachedFfprobePath !== undefined) {
    return { ffmpeg: cachedFfmpegPath, ffprobe: cachedFfprobePath };
  }

  const isWindows = process.platform === 'win32';
  const rootDir = process.cwd();

  // 1. Candidate paths for FFmpeg
  const ffmpegCandidates: string[] = [];
  if (process.env.FFMPEG_PATH) ffmpegCandidates.push(process.env.FFMPEG_PATH);

  ffmpegCandidates.push(
    path.join(rootDir, 'bin', isWindows ? 'ffmpeg.exe' : 'ffmpeg'),
    path.join(rootDir, 'ffmpeg', 'bin', isWindows ? 'ffmpeg.exe' : 'ffmpeg'),
    path.join(rootDir, 'ffmpeg', isWindows ? 'ffmpeg.exe' : 'ffmpeg'),
    path.join(rootDir, isWindows ? 'ffmpeg.exe' : 'ffmpeg')
  );

  if (isWindows) {
    const localAppData = process.env.LOCALAPPDATA || '';
    const userProfile = process.env.USERPROFILE || '';
    const programData = process.env.ProgramData || 'C:\\ProgramData';
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

    // WinGet Links
    if (localAppData) {
      ffmpegCandidates.push(path.join(localAppData, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'));
      // WinGet Packages folder scan
      try {
        const wingetPkgs = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
        if (fs.existsSync(wingetPkgs)) {
          const dirs = fs.readdirSync(wingetPkgs);
          for (const d of dirs) {
            if (d.toLowerCase().includes('ffmpeg')) {
              const fullPkgDir = path.join(wingetPkgs, d);
              const subItems = fs.readdirSync(fullPkgDir);
              for (const sub of subItems) {
                ffmpegCandidates.push(path.join(fullPkgDir, sub, 'bin', 'ffmpeg.exe'));
                ffmpegCandidates.push(path.join(fullPkgDir, sub, 'ffmpeg.exe'));
              }
            }
          }
        }
      } catch {}
    }

    // Scoop
    if (userProfile) {
      ffmpegCandidates.push(path.join(userProfile, 'scoop', 'shims', 'ffmpeg.exe'));
      ffmpegCandidates.push(path.join(userProfile, 'scoop', 'apps', 'ffmpeg', 'current', 'bin', 'ffmpeg.exe'));
    }

    // Chocolatey
    ffmpegCandidates.push(
      path.join(programData, 'chocolatey', 'bin', 'ffmpeg.exe'),
      path.join(programData, 'chocolatey', 'lib', 'ffmpeg', 'tools', 'ffmpeg', 'bin', 'ffmpeg.exe')
    );

    // Standard root folders
    ffmpegCandidates.push(
      'C:\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\ffmpeg\\ffmpeg.exe',
      path.join(programFiles, 'ffmpeg', 'bin', 'ffmpeg.exe'),
      path.join(programFilesX86, 'ffmpeg', 'bin', 'ffmpeg.exe')
    );
  }

  // 2. Candidate paths for FFprobe
  const ffprobeCandidates: string[] = [];
  if (process.env.FFPROBE_PATH) ffprobeCandidates.push(process.env.FFPROBE_PATH);

  ffprobeCandidates.push(
    path.join(rootDir, 'bin', isWindows ? 'ffprobe.exe' : 'ffprobe'),
    path.join(rootDir, 'ffmpeg', 'bin', isWindows ? 'ffprobe.exe' : 'ffprobe'),
    path.join(rootDir, 'ffmpeg', isWindows ? 'ffprobe.exe' : 'ffprobe'),
    path.join(rootDir, isWindows ? 'ffprobe.exe' : 'ffprobe')
  );

  if (isWindows) {
    const localAppData = process.env.LOCALAPPDATA || '';
    const userProfile = process.env.USERPROFILE || '';
    const programData = process.env.ProgramData || 'C:\\ProgramData';
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

    if (localAppData) {
      ffprobeCandidates.push(path.join(localAppData, 'Microsoft', 'WinGet', 'Links', 'ffprobe.exe'));
    }
    if (userProfile) {
      ffprobeCandidates.push(path.join(userProfile, 'scoop', 'shims', 'ffprobe.exe'));
      ffprobeCandidates.push(path.join(userProfile, 'scoop', 'apps', 'ffmpeg', 'current', 'bin', 'ffprobe.exe'));
    }
    ffprobeCandidates.push(
      path.join(programData, 'chocolatey', 'bin', 'ffprobe.exe'),
      path.join(programData, 'chocolatey', 'lib', 'ffmpeg', 'tools', 'ffmpeg', 'bin', 'ffprobe.exe')
    );
    ffprobeCandidates.push(
      'C:\\ffmpeg\\bin\\ffprobe.exe',
      'C:\\ffmpeg\\ffprobe.exe',
      path.join(programFiles, 'ffmpeg', 'bin', 'ffprobe.exe'),
      path.join(programFilesX86, 'ffmpeg', 'bin', 'ffprobe.exe')
    );
  }

  // Check explicit file candidates on disk first
  let resolvedFfmpeg: string | null = null;
  for (const cand of ffmpegCandidates) {
    try {
      if (cand && fs.existsSync(cand) && fs.statSync(cand).isFile()) {
        resolvedFfmpeg = path.resolve(cand);
        break;
      }
    } catch {}
  }

  // If not found in explicit paths, test system PATH
  if (!resolvedFfmpeg) {
    if (testExecutable('ffmpeg')) {
      resolvedFfmpeg = 'ffmpeg';
    }
  }

  let resolvedFfprobe: string | null = null;
  for (const cand of ffprobeCandidates) {
    try {
      if (cand && fs.existsSync(cand) && fs.statSync(cand).isFile()) {
        resolvedFfprobe = path.resolve(cand);
        break;
      }
    } catch {}
  }

  if (!resolvedFfprobe) {
    if (testExecutable('ffprobe')) {
      resolvedFfprobe = 'ffprobe';
    }
  }

  cachedFfmpegPath = resolvedFfmpeg;
  cachedFfprobePath = resolvedFfprobe;

  return { ffmpeg: resolvedFfmpeg, ffprobe: resolvedFfprobe };
}

function readAvailableVideoEncoders(ffmpeg: string): string[] {
  try {
    const result = spawnSync(ffmpeg, ['-hide_banner', '-encoders'], {
      timeout: 5000,
      windowsHide: true,
      encoding: 'utf8',
    });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    return ['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_vaapi'].filter((encoder) => output.includes(encoder));
  } catch {
    return [];
  }
}

let runtimeHwMode: HardwareAccelerationStatus['mode'] | undefined;
let runtimeHwEncoder: string | undefined;

export function setHardwareAccelerationConfig(config: { mode?: HardwareAccelerationStatus['mode']; encoder?: string }) {
  if (config.mode !== undefined) runtimeHwMode = config.mode;
  if (config.encoder !== undefined) runtimeHwEncoder = config.encoder || undefined;
  cachedHardwareStatus = undefined;
}

export function getHardwareAccelerationStatus(): HardwareAccelerationStatus {
  if (cachedHardwareStatus) return cachedHardwareStatus;

  const envMode = process.env.FFMPEG_HW_ACCELERATION?.trim().toLowerCase();
  const rawMode = runtimeHwMode || (envMode === 'off' || envMode === 'software' ? envMode : 'auto');
  const mode: HardwareAccelerationStatus['mode'] = rawMode === 'off' || rawMode === 'software'
    ? rawMode
    : 'auto';
  const { ffmpeg } = getBinaries();
  const availableEncoders = ffmpeg ? readAvailableVideoEncoders(ffmpeg) : [];
  const requestedEncoder = runtimeHwEncoder || process.env.FFMPEG_VIDEO_ENCODER?.trim().toLowerCase();
  const preferredOrder = requestedEncoder
    ? [requestedEncoder]
    : ['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_vaapi'];
  const encoder = mode === 'auto'
    ? preferredOrder.find((candidate) => availableEncoders.includes(candidate))
    : undefined;

  cachedHardwareStatus = { mode, encoder, availableEncoders };
  return cachedHardwareStatus;
}

export interface VideoEncodingPlan {
  inputArgs: string[];
  outputArgs: string[];
  encoder: string;
  hardware: boolean;
}

export function getVideoEncodingPlan(preferHardware = true): VideoEncodingPlan {
  const status = getHardwareAccelerationStatus();
  const encoder = preferHardware && status.mode === 'auto' ? status.encoder : undefined;

  if (encoder === 'h264_nvenc') {
    return {
      inputArgs: ['-hwaccel', 'auto'],
      outputArgs: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '23', '-b:v', '0', '-profile:v', 'main', '-pix_fmt', 'yuv420p'],
      encoder,
      hardware: true,
    };
  }
  if (encoder === 'h264_qsv') {
    return {
      inputArgs: ['-hwaccel', 'auto'],
      outputArgs: ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', '23', '-profile:v', 'main', '-pix_fmt', 'yuv420p'],
      encoder,
      hardware: true,
    };
  }
  if (encoder === 'h264_amf') {
    return {
      inputArgs: ['-hwaccel', 'auto'],
      outputArgs: ['-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'cqp', '-qp_i', '23', '-qp_p', '23', '-profile:v', 'main', '-pix_fmt', 'yuv420p'],
      encoder,
      hardware: true,
    };
  }
  if (encoder === 'h264_vaapi') {
    return {
      inputArgs: [],
      outputArgs: ['-c:v', 'h264_vaapi', '-qp', '23', '-profile:v', 'main'],
      encoder,
      hardware: true,
    };
  }

  return {
    inputArgs: [],
    outputArgs: [
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-profile:v', 'baseline',
      '-level', '3.1',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-g', '30',
      '-keyint_min', '30',
    ],
    encoder: 'libx264',
    hardware: false,
  };
}

// Automatically download and install portable FFmpeg for Windows/Linux into ./bin/ folder
export async function downloadAndInstallFFmpeg(): Promise<{ success: boolean; message: string; binaries: { ffmpeg: string | null; ffprobe: string | null } }> {
  const rootDir = process.cwd();
  const binDir = path.join(rootDir, 'bin');
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  const isWindows = process.platform === 'win32';

  if (isWindows) {
    const psScript = `
$ProgressPreference = 'SilentlyContinue';
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12;
$binDir = '${binDir.replace(/\\/g, '\\\\')}';
$zipUrl = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
$zipPath = Join-Path $env:TEMP 'cinelocal_ffmpeg.zip';
$extractDir = Join-Path $env:TEMP 'cinelocal_ffmpeg_extract';

if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue };
if (Test-Path $zipPath) { Remove-Item $zipPath -Force -ErrorAction SilentlyContinue };

Write-Output 'DOWNLOADING';
try {
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing -TimeoutSec 180;
} catch {
    # Fallback to Gyan essentials
    $zipUrl = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing -TimeoutSec 180;
}

Write-Output 'EXTRACTING';
Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force;

$ffmpegExe = Get-ChildItem -Path $extractDir -Filter 'ffmpeg.exe' -Recurse | Select-Object -First 1;
$ffprobeExe = Get-ChildItem -Path $extractDir -Filter 'ffprobe.exe' -Recurse | Select-Object -First 1;

if ($ffmpegExe) {
    Copy-Item $ffmpegExe.FullName -Destination (Join-Path $binDir 'ffmpeg.exe') -Force;
}
if ($ffprobeExe) {
    Copy-Item $ffprobeExe.FullName -Destination (Join-Path $binDir 'ffprobe.exe') -Force;
}

Remove-Item $zipPath -Force -ErrorAction SilentlyContinue;
Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue;
Write-Output 'DONE';
`;

    return new Promise((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
        { timeout: 300000 },
        (err, stdout, stderr) => {
          invalidateBinariesCache();
          const bins = getBinaries();
          if (bins.ffmpeg) {
            resolve({
              success: true,
              message: 'FFmpeg instalado com sucesso na pasta bin do CineLocal!',
              binaries: bins,
            });
          } else {
            resolve({
              success: false,
              message: `Falha ao baixar FFmpeg: ${err?.message || stderr || stdout || 'Erro desconhecido'}`,
              binaries: bins,
            });
          }
        }
      );
    });
  }

  // Linux / macOS fallback
  invalidateBinariesCache();
  const bins = getBinaries();
  return {
    success: !!bins.ffmpeg,
    message: bins.ffmpeg
      ? 'FFmpeg detectado no sistema.'
      : 'No Linux ou macOS, instale o ffmpeg via terminal (ex: sudo apt install ffmpeg ou brew install ffmpeg).',
    binaries: bins,
  };
}

// Invalidate binary cache to force re-detection
export function invalidateBinariesCache() {
  cachedFfmpegPath = undefined;
  cachedFfprobePath = undefined;
  cachedHardwareStatus = undefined;
}

// Helper to parse duration from string (e.g. seconds or HH:MM:SS.mmm format from MKV tags)
export function parseDurationString(val: any): number {
  if (!val) return 0;
  if (typeof val === 'number') return Math.floor(val);
  const str = String(val).trim();
  if (!str || str === 'N/A') return 0;
  if (str.includes(':')) {
    const parts = str.split(':');
    if (parts.length === 3) {
      const hours = parseFloat(parts[0]) || 0;
      const minutes = parseFloat(parts[1]) || 0;
      const seconds = parseFloat(parts[2]) || 0;
      return Math.floor(hours * 3600 + minutes * 60 + seconds);
    }
    if (parts.length === 2) {
      const minutes = parseFloat(parts[0]) || 0;
      const seconds = parseFloat(parts[1]) || 0;
      return Math.floor(minutes * 60 + seconds);
    }
  }
  const parsed = parseFloat(str);
  return isNaN(parsed) ? 0 : Math.floor(parsed);
}

// Probe a media file with ffprobe
export async function probeMedia(filePath: string): Promise<FFprobeData> {
  const { ffprobe } = getBinaries();

  const fallbackData: FFprobeData = {
    durationSeconds: 0,
    videoCodec: undefined,
    resolution: undefined,
    audioTracks: [],
    subtitleTracks: [],
  };

  if (!ffprobe || !fs.existsSync(filePath)) {
    return fallbackData;
  }

  return new Promise((resolve) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ];

    execFile(ffprobe, args, { timeout: 15000 }, (err, stdout) => {
      if (err || !stdout) {
        return resolve(fallbackData);
      }

      try {
        const data = JSON.parse(stdout);
        const format = data.format || {};
        const streams = Array.isArray(data.streams) ? data.streams : [];

        let durationSeconds = parseDurationString(format.duration);
        if (!durationSeconds && format.tags) {
          durationSeconds = parseDurationString(
            format.tags.DURATION ||
            format.tags.duration ||
            format.tags['DURATION-por'] ||
            format.tags['DURATION-eng']
          );
        }

        let videoCodec: string | undefined;
        let pixFmt: string | undefined;
        let resolution: string | undefined;
        const audioTracks: AudioTrackInfo[] = [];
        const subtitleTracks: SubtitleTrackInfo[] = [];

        let audioCounter = 0;
        let subCounter = 0;

        for (const stream of streams) {
          if (stream.codec_type === 'video' && !videoCodec) {
            videoCodec = stream.codec_name;
            pixFmt = stream.pix_fmt;
            if (stream.width && stream.height) {
              resolution = `${stream.width}x${stream.height}`;
            }
            if (!durationSeconds && stream.duration) {
              durationSeconds = parseDurationString(stream.duration);
            }
            if (!durationSeconds && stream.tags) {
              durationSeconds = parseDurationString(
                stream.tags.DURATION ||
                stream.tags.duration ||
                stream.tags['DURATION-por'] ||
                stream.tags['DURATION-eng']
              );
            }
          } else if (stream.codec_type === 'audio') {
            const tags = stream.tags || {};
            const lang = tags.language || tags.LANGUAGE || 'und';
            const title = tags.title || tags.handler_name || `Faixa ${audioCounter + 1}`;
            if (!durationSeconds && stream.duration) {
              durationSeconds = parseDurationString(stream.duration);
            }
            if (!durationSeconds && tags) {
              durationSeconds = parseDurationString(
                tags.DURATION ||
                tags.duration ||
                tags['DURATION-por'] ||
                tags['DURATION-eng']
              );
            }
            audioTracks.push({
              index: audioCounter++,
              streamIndex: stream.index,
              codec: stream.codec_name || 'unknown',
              language: lang,
              title: `${title} (${lang.toUpperCase()})`,
              channels: stream.channels || 2,
            });
          } else if (stream.codec_type === 'subtitle') {
            const tags = stream.tags || {};
            const lang = tags.language || tags.LANGUAGE || 'und';
            const title = tags.title || tags.handler_name || `Legenda ${subCounter + 1}`;
            subtitleTracks.push({
              index: subCounter++,
              streamIndex: stream.index,
              codec: stream.codec_name || 'unknown',
              language: lang,
              title: `${title} (${lang.toUpperCase()})`,
              isExternal: false,
            });
          }
        }

        resolve({
          durationSeconds,
          videoCodec,
          pixFmt,
          resolution,
          audioTracks,
          subtitleTracks,
        });
      } catch (parseErr) {
        console.error('Error parsing ffprobe output:', parseErr);
        resolve(fallbackData);
      }
    });
  });
}

// Extract embedded cover art from MP4 / MKV video file if present
export async function extractEmbeddedCover(filePath: string): Promise<string | null> {
  const { ffmpeg } = getBinaries();
  if (!ffmpeg || !fs.existsSync(filePath)) return null;

  const hash = Buffer.from(filePath).toString('base64url').slice(0, 32);
  const outPath = path.join(getThumbnailDir(), `cover_${hash}.jpg`);

  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 1500) {
    return outPath;
  }

  return new Promise((resolve) => {
    // Attempt 1: dump embedded video stream / attached_pic cover directly
    const args = [
      '-i', filePath,
      '-map', '0:v',
      '-map', '-0:V',
      '-c', 'copy',
      '-y',
      outPath,
    ];

    execFile(ffmpeg, args, { timeout: 8000 }, (err) => {
      if (!err && fs.existsSync(outPath) && fs.statSync(outPath).size > 1500) {
        resolve(outPath);
      } else {
        if (fs.existsSync(outPath) && fs.statSync(outPath).size <= 1500) {
          try { fs.unlinkSync(outPath); } catch {}
        }
        resolve(null);
      }
    });
  });
}

// Generate thumbnail at given second with optional vertical poster ratio
export async function generateThumbnail(
  filePath: string,
  timeSec: number = 10,
  aspectRatio: 'landscape' | 'poster' = 'landscape'
): Promise<string | null> {
  const { ffmpeg } = getBinaries();
  if (!ffmpeg || !fs.existsSync(filePath)) return null;

  const prefix = aspectRatio === 'poster' ? 'poster_thumb' : 'thumb';
  const hash = Buffer.from(filePath).toString('base64url').slice(0, 32);
  const outPath = path.join(getThumbnailDir(), `${prefix}_${hash}.jpg`);

  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 1000) {
    return outPath;
  }

  const vfFilter = aspectRatio === 'poster'
    ? 'scale=480:720:force_original_aspect_ratio=increase,crop=480:720'
    : 'scale=640:-1';

  return new Promise((resolve) => {
    const args = [
      '-ss', Math.max(1, timeSec).toString(),
      '-i', filePath,
      '-vframes', '1',
      '-q:v', '3',
      '-vf', vfFilter,
      '-y',
      outPath,
    ];

    execFile(ffmpeg, args, { timeout: 10000 }, (err) => {
      if (err || !fs.existsSync(outPath)) {
        resolve(null);
      } else {
        resolve(outPath);
      }
    });
  });
}

// Check if file is direct-playable in standard browser without transcoding
export function isBrowserNativeDirectPlayable(filePath: string, videoCodec?: string, audioCodec?: string, pixFmt?: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp4' || ext === '.m4v' || ext === '.webm') {
    const vc = (videoCodec || '').toLowerCase();
    const ac = (audioCodec || '').toLowerCase();
    const pf = (pixFmt || '').toLowerCase();
    // Video: h264 (8-bit yuv420p), vp8, vp9, av1
    // Audio: aac, mp3, opus, vorbis
    const isVGood = !vc || vc === 'h264' || vc === 'vp8' || vc === 'vp9' || vc === 'av1';
    const isAGood = !ac || ac === 'aac' || ac === 'mp3' || ac === 'opus' || ac === 'vorbis';
    const isPixGood = !pf || pf === 'yuv420p';
    return isVGood && isAGood && isPixGood;
  }
  return false;
}

// Stream subtitle as WebVTT (either from internal stream via ffmpeg or external file)
function parseWebVttTimestamp(value: string): number {
  const parts = value.split(':').map(Number);
  if (parts.length === 3) {
    return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  }
  if (parts.length === 2) {
    return (parts[0] * 60) + parts[1];
  }
  return Number(parts[0]) || 0;
}

function formatWebVttTimestamp(totalSeconds: number): string {
  const safeMs = Math.max(0, Math.round(totalSeconds * 1000));
  const ms = safeMs % 1000;
  const totalSec = Math.floor(safeMs / 1000);
  const seconds = totalSec % 60;
  const minutes = Math.floor(totalSec / 60) % 60;
  const hours = Math.floor(totalSec / 3600);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

export function shiftWebVttTimestamps(content: string, offsetSeconds: number): string {
  const safeOffset = Number.isFinite(offsetSeconds) ? offsetSeconds : 0;
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trimEnd();
  if (!normalized) return 'WEBVTT\n\n';

  const blocks = normalized.split(/\n{2,}/);
  const validBlocks: string[] = [];
  const timingRegex = /^(\s*)(\d{1,3}:\d{2}(?::\d{2})?[\.,]\d{3})\s+-->\s+(\d{1,3}:\d{2}(?::\d{2})?[\.,]\d{3})(.*)$/;

  for (const block of blocks) {
    const lines = block.split('\n');
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) {
      validBlocks.push(block);
      continue;
    }

    const match = lines[timingIndex].match(timingRegex);
    if (!match) {
      validBlocks.push(block);
      continue;
    }

    const start = parseWebVttTimestamp(match[2].replace(',', '.')) + safeOffset;
    const end = parseWebVttTimestamp(match[3].replace(',', '.')) + safeOffset;
    const clampedStart = Math.max(0, start);
    const clampedEnd = Math.max(0, end);

    // Chromecast rejects zero-length and fully-negative cues. Dropping them
    // is safer than collapsing both timestamps to 00:00:00.000.
    if (clampedEnd <= 0 || clampedEnd <= clampedStart) continue;

    lines[timingIndex] = `${match[1]}${formatWebVttTimestamp(clampedStart)} --> ${formatWebVttTimestamp(clampedEnd)}${match[4] || ''}`;
    validBlocks.push(lines.join('\n'));
  }

  const header = validBlocks[0]?.trimStart().toUpperCase().startsWith('WEBVTT') ? validBlocks.shift() : 'WEBVTT';
  return `${[header, ...validBlocks].filter(Boolean).join('\n\n')}\n\n`;
}

export function isBitmapSubtitleCodec(codec?: string): boolean {
  return /pgs|dvd[_-]?subtitle|dvb[_-]?subtitle|vobsub|xsub|teletext/i.test(codec || '');
}

function getSubtitleCachePath(filePath: string, streamIndex: number, offsetSeconds: number): string {
  const stat = fs.statSync(filePath);
  const key = crypto.createHash('sha1')
    .update(`${path.resolve(filePath)}:${stat.size}:${stat.mtimeMs}:${streamIndex}:${offsetSeconds.toFixed(3)}`)
    .digest('hex');
  return path.join(process.cwd(), '.cache', 'subtitles', `${key}.vtt`);
}

function writeSubtitleCache(cachePath: string, content: string): void {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const tempPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, content, 'utf8');
    fs.renameSync(tempPath, cachePath);
  } catch (error) {
    console.warn('[Subtitles] Não foi possível gravar cache WebVTT:', error instanceof Error ? error.message : error);
  }
}

export function streamSubtitlesToVtt(
  filePath: string,
  streamIndex: number,
  res: any,
  offsetSeconds = 0
): void {
  const { ffmpeg } = getBinaries();
  if (!ffmpeg || !fs.existsSync(filePath)) {
    res.status(404).send('Arquivo de vídeo ou ffmpeg não encontrado');
    return;
  }

  const cachePath = getSubtitleCachePath(filePath, streamIndex, Number.isFinite(offsetSeconds) ? offsetSeconds : 0);
  if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 0) {
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(cachePath);
    return;
  }

  res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60');

  const args = [
    '-i', filePath,
    '-map', `0:${streamIndex}`,
    '-f', 'webvtt',
    'pipe:1',
  ];

  const proc = spawn(ffmpeg, args);
  const chunks: Buffer[] = [];
  proc.stdout.on('data', (chunk) => {
    const buffer = Buffer.from(chunk);
    chunks.push(buffer);
    if (offsetSeconds === 0 && !res.writableEnded) res.write(buffer);
  });
  proc.stdout.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    const output = shiftWebVttTimestamps(raw, offsetSeconds);
    writeSubtitleCache(cachePath, output);
    if (offsetSeconds !== 0 && !res.writableEnded) {
      res.end(output);
    } else if (!res.writableEnded) {
      res.end();
    }
  });

  proc.stderr.on('data', () => {}); // silence or debug
  proc.on('error', (err) => {
    console.error('Subtitle extraction error:', err);
    if (!res.headersSent) {
      res.status(500).send('Erro ao extrair legenda');
    }
  });

  res.on('close', () => {
    try {
      proc.kill('SIGKILL');
    } catch {}
  });
}
