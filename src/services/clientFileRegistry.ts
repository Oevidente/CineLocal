import { Episode, MediaItem, LibraryData } from '../types';
import { saveClientLibrary, getClientLibrary } from './clientStorage';

class ClientFileRegistry {
  private episodeHandles = new Map<string, FileSystemFileHandle>();
  private subtitleHandles = new Map<string, FileSystemFileHandle>();
  private dirHandles = new Map<string, FileSystemDirectoryHandle>();
  private blobUrls = new Map<string, string>();
  private inMemoryLibrary: LibraryData | null = null;

  registerEpisodeHandle(episodeId: string, handle: FileSystemFileHandle) {
    this.episodeHandles.set(episodeId, handle);
  }

  registerSubtitleHandle(subtitleId: string, handle: FileSystemFileHandle) {
    this.subtitleHandles.set(subtitleId, handle);
  }

  registerDirectoryHandle(mediaId: string, handle: FileSystemDirectoryHandle) {
    this.dirHandles.set(mediaId, handle);
  }

  hasEpisode(episodeId: string): boolean {
    return this.episodeHandles.has(episodeId);
  }

  getEpisodeHandle(episodeId: string): FileSystemFileHandle | undefined {
    return this.episodeHandles.get(episodeId);
  }

  getSubtitleHandle(subtitleId: string): FileSystemFileHandle | undefined {
    return this.subtitleHandles.get(subtitleId);
  }

  getDirectoryHandle(mediaId: string): FileSystemDirectoryHandle | undefined {
    return this.dirHandles.get(mediaId);
  }

  setInMemoryLibrary(lib: LibraryData) {
    this.inMemoryLibrary = lib;
  }

  getInMemoryLibrary(): LibraryData | null {
    return this.inMemoryLibrary;
  }

  async getVideoBlobUrl(episodeId: string): Promise<string | null> {
    const cachedUrl = this.blobUrls.get(episodeId);
    if (cachedUrl) return cachedUrl;

    const handle = this.episodeHandles.get(episodeId);
    if (!handle) return null;

    try {
      const file = await handle.getFile();
      const url = URL.createObjectURL(file);
      this.blobUrls.set(episodeId, url);
      return url;
    } catch (err) {
      console.error('[CineLocal] Falha ao criar ObjectURL para episódio:', episodeId, err);
      return null;
    }
  }

  async getSubtitleText(subtitleId: string): Promise<string | null> {
    const handle = this.subtitleHandles.get(subtitleId);
    if (!handle) return null;

    try {
      const file = await handle.getFile();
      return await file.text();
    } catch (err) {
      console.error('[CineLocal] Falha ao ler arquivo de legenda:', subtitleId, err);
      return null;
    }
  }

  /**
   * Saves progress both to the in-memory library, the IndexedDB cache, and directly
   * writes the updated library.json into the local folder handle.
   */
  async saveProgress(
    mediaId: string,
    episodeId: string,
    progressSeconds: number,
    durationSeconds?: number,
    completed?: boolean,
    audioIndex?: number,
    subtitleIndex?: number
  ): Promise<void> {
    if (!this.inMemoryLibrary) {
      this.inMemoryLibrary = await getClientLibrary();
    }

    if (!this.inMemoryLibrary) return;

    let mediaUpdated = false;
    const nowIso = new Date().toISOString();

    for (const item of this.inMemoryLibrary.items) {
      if (item.id !== mediaId) continue;

      for (const season of item.seasons) {
        for (const ep of season.episodes) {
          if (ep.id === episodeId) {
            ep.progressSeconds = Math.max(0, Math.floor(progressSeconds));
            if (durationSeconds && durationSeconds > 0) {
              ep.durationSeconds = durationSeconds;
            }
            if (completed !== undefined) {
              ep.watched = completed;
            } else if (durationSeconds && progressSeconds > durationSeconds * 0.9) {
              ep.watched = true;
            }
            if (audioIndex !== undefined) ep.selectedAudioIndex = audioIndex;
            if (subtitleIndex !== undefined) ep.selectedSubtitleIndex = subtitleIndex;
            ep.lastWatchedAt = nowIso;
            mediaUpdated = true;
          }
        }
      }

      if (mediaUpdated) {
        item.lastWatchedEpisodeId = episodeId;
        item.lastWatchedAt = nowIso;
        item.updatedAt = nowIso;
      }
    }

    if (mediaUpdated) {
      this.inMemoryLibrary.updatedAt = nowIso;
      // 1. Save to IndexedDB
      await saveClientLibrary(this.inMemoryLibrary);

      // 2. Direct write to library.json in the folder handle if writable
      const dirHandle = this.dirHandles.get(mediaId);
      if (dirHandle) {
        try {
          const fileHandle = await dirHandle.getFileHandle('library.json', { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(JSON.stringify(this.inMemoryLibrary, null, 2));
          await writable.close();
        } catch (err) {
          console.warn('[CineLocal] Não foi possível gravar library.json no disco:', err);
        }
      }
    }
  }

  revokeBlobUrl(episodeId: string) {
    const url = this.blobUrls.get(episodeId);
    if (url) {
      URL.revokeObjectURL(url);
      this.blobUrls.delete(episodeId);
    }
  }

  clear() {
    this.blobUrls.forEach((url) => URL.revokeObjectURL(url));
    this.blobUrls.clear();
    this.episodeHandles.clear();
    this.subtitleHandles.clear();
    this.dirHandles.clear();
  }
}

export const clientFileRegistry = new ClientFileRegistry();
