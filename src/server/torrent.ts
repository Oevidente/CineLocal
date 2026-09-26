import fs from 'fs';
import path from 'path';
import os from 'os';
// @ts-ignore
import torrentStream from 'torrent-stream';
import { TorrentStatus, TorrentFileItem, TorrentHistoryItem } from '../types';
import { getDataDir, saveTorrentMediaItem, removeTorrentFromLibrary, updateTorrentProgressInLibrary, readLibrary, writeLibrary, normalizeSearchTitle } from './storage';
import { enrichMediaWithTmdb, isTmdbConfigured } from './tmdb';

const TORRENT_CACHE_DIR = path.join(getDataDir(), 'torrent-cache');
const TORRENT_HISTORY_FILE = path.join(getDataDir(), 'torrent-history.json');

if (!fs.existsSync(TORRENT_CACHE_DIR)) {
  try {
    fs.mkdirSync(TORRENT_CACHE_DIR, { recursive: true });
  } catch (err) {
    console.error('Erro ao criar pasta de cache do torrent:', err);
  }
}

// Popular public trackers to accelerate peer discovery
const DEFAULT_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://9.rarbg.to:2920/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://explodie.org:6969/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.tiny-vps.com:6969/announce',
  'udp://tracker.moeking.me:6969/announce',
  'udp://p4p.arenabg.com:1337/announce',
  'http://tracker.openbittorrent.com:80/announce',
  'udp://tracker.internetwarriors.net:1337/announce',
];

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.webm', '.mov', '.m4v', '.wmv', '.flv', '.ts']);
const SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt', '.ass', '.ssa']);

interface EngineRecord {
  engine: any;
  infoHash: string;
  magnetUri: string;
  name: string;
  state: 'connecting' | 'metadata' | 'ready' | 'downloading' | 'error';
  totalBytes: number;
  files: any[];
  selectedFileIndex: number;
  createdAt: number;
  lastAccessAt: number;
  errorMessage?: string;
  idleTimer?: NodeJS.Timeout;
}

const activeEngines = new Map<string, EngineRecord>();

// Helper to extract or normalize infoHash
export function parseInfoHash(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/xt=urn:btih:([a-zA-Z0-9]+)/i);
  if (match && match[1]) {
    return match[1].toLowerCase();
  }
  // If it is a raw 40-char hex
  if (/^[a-fA-F0-9]{40}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  // If it is a raw 32-char base32
  if (/^[a-zA-Z2-7]{32}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return trimmed.toLowerCase();
}

// Extract displayName from magnet URI if present
export function parseTorrentName(magnetUri: string): string | undefined {
  const match = magnetUri.match(/dn=([^&]+)/i);
  if (match && match[1]) {
    try {
      return decodeURIComponent(match[1].replace(/\+/g, ' '));
    } catch {
      return match[1];
    }
  }
  return undefined;
}

// Read and write history
export function readTorrentHistory(): TorrentHistoryItem[] {
  try {
    if (fs.existsSync(TORRENT_HISTORY_FILE)) {
      const content = fs.readFileSync(TORRENT_HISTORY_FILE, 'utf-8');
      const data = JSON.parse(content);
      if (Array.isArray(data)) return data;
    }
  } catch (err) {
    console.error('Erro ao ler torrent-history.json:', err);
  }
  return [];
}

export function saveTorrentHistoryItem(item: Partial<TorrentHistoryItem> & { infoHash: string; magnetUri: string }): void {
  try {
    const list = readTorrentHistory();
    const existingIndex = list.findIndex((i) => i.infoHash.toLowerCase() === item.infoHash.toLowerCase());
    const now = new Date().toISOString();

    if (existingIndex >= 0) {
      list[existingIndex] = {
        ...list[existingIndex],
        ...item,
        lastWatchedAt: now,
      };
    } else {
      list.unshift({
        infoHash: item.infoHash.toLowerCase(),
        magnetUri: item.magnetUri,
        name: item.name || 'Torrent',
        dateAdded: now,
        lastWatchedAt: now,
        progressSeconds: item.progressSeconds || 0,
        durationSeconds: item.durationSeconds || 0,
        selectedFileIndex: item.selectedFileIndex || 0,
        totalBytes: item.totalBytes || 0,
      });
    }

    // Keep top 50 recent torrents
    const trimmed = list.slice(0, 50);
    fs.writeFileSync(TORRENT_HISTORY_FILE, JSON.stringify(trimmed, null, 2), 'utf-8');
  } catch (err) {
    console.error('Erro ao salvar torrent-history.json:', err);
  }
}

export function removeTorrentHistoryItem(infoHash: string): void {
  try {
    const list = readTorrentHistory().filter((i) => i.infoHash.toLowerCase() !== infoHash.toLowerCase());
    fs.writeFileSync(TORRENT_HISTORY_FILE, JSON.stringify(list, null, 2), 'utf-8');
    removeTorrentFromLibrary(infoHash);
  } catch (err) {
    console.error('Erro ao remover item do histórico:', err);
  }
}

export function syncExistingTorrentHistoryToLibrary(): void {
  // Do NOT re-create or insert items into library.json from history on startup.
  // Library.json is the source of truth for media library items.
  // We only sync watch progress for items that ALREADY exist in the library.
  try {
    const library = readLibrary();
    const history = readTorrentHistory();

    for (const item of history) {
      if (!item.infoHash || !item.progressSeconds) continue;
      const cleanHash = item.infoHash.toLowerCase();

      const existsInLibrary = library.items.some(
        (i) => (i.infoHash && i.infoHash.toLowerCase() === cleanHash) || i.id === `torrent_${cleanHash}`
      );

      if (existsInLibrary) {
        updateTorrentProgressInLibrary(
          item.infoHash,
          item.selectedFileIndex || 0,
          item.progressSeconds,
          item.durationSeconds
        );
      }
    }
  } catch (err) {
    console.error('Erro ao sincronizar histórico de torrents:', err);
  }
}

// Initial sync of existing torrents into library
syncExistingTorrentHistoryToLibrary();

/**
 * Initializes or returns an active torrent-stream engine for a magnet link.
 */
export function getOrCreateTorrentEngine(magnetUriOrHash: string): Promise<EngineRecord> {
  const infoHash = parseInfoHash(magnetUriOrHash);
  let magnetUri = magnetUriOrHash.trim();
  if (!magnetUri.startsWith('magnet:?')) {
    magnetUri = `magnet:?xt=urn:btih:${infoHash}`;
  }

  const existing = activeEngines.get(infoHash);
  if (existing) {
    existing.lastAccessAt = Date.now();
    return Promise.resolve(existing);
  }

  return new Promise((resolve) => {
    const initialName = parseTorrentName(magnetUri) || `Torrent_${infoHash.slice(0, 8)}`;
    const torrentPath = path.join(TORRENT_CACHE_DIR, infoHash);

    // Immediately register in library with initial name and magnet URI
    try {
      saveTorrentMediaItem({
        infoHash,
        magnetUri,
        name: initialName,
      });
    } catch (e) {
      console.error('Erro ao salvar torrent preliminar na biblioteca:', e);
    }

    const record: EngineRecord = {
      engine: null,
      infoHash,
      magnetUri,
      name: initialName,
      state: 'connecting',
      totalBytes: 0,
      files: [],
      selectedFileIndex: 0,
      createdAt: Date.now(),
      lastAccessAt: Date.now(),
    };

    activeEngines.set(infoHash, record);

    try {
      const engine = torrentStream(magnetUri, {
        path: torrentPath,
        tmp: TORRENT_CACHE_DIR,
        trackers: DEFAULT_TRACKERS,
        verify: true,
        dht: true,
      });

      record.engine = engine;

      // Timeout for metadata discovery notification
      const metaTimer = setTimeout(() => {
        if (record.state === 'connecting') {
          record.state = 'metadata';
        }
      }, 3000);

      engine.on('ready', () => {
        clearTimeout(metaTimer);
        record.state = 'ready';
        record.name = (engine as any).torrent?.name || record.name;
        record.files = engine.files || [];
        record.totalBytes = (engine as any).torrent?.length || engine.files.reduce((acc: number, f: any) => acc + (f.length || 0), 0);

        // Auto-select largest video file by default
        let bestVideoIdx = -1;
        let maxLen = 0;
        record.files.forEach((file: any, idx: number) => {
          const ext = path.extname(file.name).toLowerCase();
          if (VIDEO_EXTENSIONS.has(ext)) {
            if (file.length > maxLen) {
              maxLen = file.length;
              bestVideoIdx = idx;
            }
          }
        });

        if (bestVideoIdx >= 0) {
          record.selectedFileIndex = bestVideoIdx;
          // Prioritize pieces for the video file
          try {
            record.files[bestVideoIdx].select();
          } catch {}
        }

        // Save to history
        saveTorrentHistoryItem({
          infoHash: record.infoHash,
          magnetUri: record.magnetUri,
          name: record.name,
          totalBytes: record.totalBytes,
          selectedFileIndex: record.selectedFileIndex,
        });

        // Save / update complete media in library with files
        try {
          const savedItem = saveTorrentMediaItem({
            infoHash: record.infoHash,
            magnetUri: record.magnetUri,
            name: record.name,
            files: record.files.map((f: any, idx: number) => ({
              name: f.name,
              path: f.path,
              length: f.length,
              index: idx,
            })),
            totalBytes: record.totalBytes,
            selectedFileIndex: record.selectedFileIndex,
          });

          // Asynchronously enrich with TMDb metadata if configured
          if (isTmdbConfigured()) {
            enrichMediaWithTmdb(savedItem)
              .then((enriched) => {
                const lib = readLibrary();
                const idx = lib.items.findIndex((i) => i.id === enriched.id);
                if (idx >= 0) {
                  lib.items[idx] = enriched;
                  writeLibrary(lib, true);
                }
              })
              .catch(() => {});
          }
        } catch (e) {
          console.error('Erro ao atualizar torrent na biblioteca:', e);
        }

        resolve(record);
      });

      engine.on('download', () => {
        if (record.state === 'ready') {
          record.state = 'downloading';
        }
      });

      engine.on('error', (err: any) => {
        console.error(`[Torrent Engine Error ${infoHash}]:`, err);
        record.state = 'error';
        record.errorMessage = String(err?.message || err);
      });

      engine.on('idle', () => {
        // All requested pieces finished
      });

      // If ready takes a while, resolve early so client gets connecting/metadata status
      setTimeout(() => {
        resolve(record);
      }, 500);

    } catch (err: any) {
      console.error('Erro ao instanciar torrentStream:', err);
      record.state = 'error';
      record.errorMessage = String(err?.message || err);
      resolve(record);
    }
  });
}

/**
 * Get current real-time status of a torrent.
 */
export function getTorrentStatus(infoHash: string): TorrentStatus {
  const normalizedHash = parseInfoHash(infoHash);
  const record = activeEngines.get(normalizedHash);

  if (!record) {
    // Check history
    const historyItem = readTorrentHistory().find((h) => h.infoHash.toLowerCase() === normalizedHash);
    return {
      infoHash: normalizedHash,
      name: historyItem?.name || 'Torrent',
      state: 'connecting',
      totalBytes: historyItem?.totalBytes || 0,
      downloadedBytes: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      peers: 0,
      progress: 0,
      selectedFileIndex: historyItem?.selectedFileIndex || 0,
      files: [],
      errorMessage: 'Torrent inativo. Clique para conectar.',
    };
  }

  record.lastAccessAt = Date.now();
  const engine = record.engine;
  const swarm = engine?.swarm;

  const downloadedBytes = swarm?.downloaded || 0;
  const downloadSpeed = swarm?.downloadSpeed?.() || 0;
  const uploadSpeed = swarm?.uploadSpeed?.() || 0;
  const peers = (swarm?.wires?.length) || 0;

  const totalBytes = record.totalBytes || 1;
  const progress = Math.min(100, Math.round((downloadedBytes / totalBytes) * 1000) / 10);

  const fileItems: TorrentFileItem[] = (record.files || []).map((file: any, index: number) => {
    const ext = path.extname(file.name).toLowerCase();
    return {
      index,
      name: file.name,
      path: file.path,
      length: file.length || 0,
      isVideo: VIDEO_EXTENSIONS.has(ext),
      isSubtitle: SUBTITLE_EXTENSIONS.has(ext),
      extension: ext,
    };
  });

  return {
    infoHash: record.infoHash,
    magnetUri: record.magnetUri,
    name: record.name,
    state: record.state,
    totalBytes: record.totalBytes,
    downloadedBytes,
    downloadSpeed,
    uploadSpeed,
    peers,
    progress,
    selectedFileIndex: record.selectedFileIndex,
    files: fileItems,
    errorMessage: record.errorMessage,
  };
}

/**
 * Get a specific file from the torrent engine.
 */
export function getTorrentFile(infoHash: string, fileIndex: number): any | null {
  const normalizedHash = parseInfoHash(infoHash);
  const record = activeEngines.get(normalizedHash);
  if (!record || !record.files || !record.files[fileIndex]) {
    return null;
  }
  record.lastAccessAt = Date.now();
  record.selectedFileIndex = fileIndex;
  return record.files[fileIndex];
}

/**
 * Select a specific file to prioritize for sequential streaming.
 */
export function selectTorrentFile(infoHash: string, fileIndex: number): boolean {
  const normalizedHash = parseInfoHash(infoHash);
  const record = activeEngines.get(normalizedHash);
  if (!record || !record.files || !record.files[fileIndex]) {
    return false;
  }
  record.selectedFileIndex = fileIndex;
  try {
    // Deselect other video files to focus bandwidth on current video
    record.files.forEach((f: any, i: number) => {
      if (i === fileIndex) {
        f.select();
      } else {
        try {
          f.deselect();
        } catch {}
      }
    });
  } catch {}
  return true;
}

/**
 * Stop and destroy a torrent engine to free memory.
 */
export function stopTorrent(infoHash: string, deleteData = false): Promise<boolean> {
  const normalizedHash = parseInfoHash(infoHash);
  const record = activeEngines.get(normalizedHash);
  if (!record) return Promise.resolve(false);

  return new Promise((resolve) => {
    try {
      if (record.engine) {
        record.engine.destroy(() => {
          activeEngines.delete(normalizedHash);
          if (deleteData) {
            const torrentPath = path.join(TORRENT_CACHE_DIR, normalizedHash);
            try {
              if (fs.existsSync(torrentPath)) {
                fs.rmSync(torrentPath, { recursive: true, force: true });
              }
            } catch {}
          }
          resolve(true);
        });
      } else {
        activeEngines.delete(normalizedHash);
        resolve(true);
      }
    } catch (err) {
      console.error(`Erro ao parar torrent ${infoHash}:`, err);
      activeEngines.delete(normalizedHash);
      resolve(false);
    }
  });
}
