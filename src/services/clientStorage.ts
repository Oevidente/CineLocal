import { LibraryData } from '../types';

const DB_NAME = 'cinelocal_offline_db';
const DB_VERSION = 1;
const STORE_HANDLES = 'dir_handles';
const STORE_LIBRARY = 'offline_library';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB não suportado neste navegador.'));
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_HANDLES)) {
        db.createObjectStore(STORE_HANDLES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_LIBRARY)) {
        db.createObjectStore(STORE_LIBRARY, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export interface StoredDirectoryHandle {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
  addedAt: string;
}

export async function verifyPermission(
  fileHandle: FileSystemHandle,
  readWrite = true,
): Promise<boolean> {
  const options = {
    mode: readWrite ? ('readwrite' as const) : ('read' as const),
  };

  // Check if permission was already granted
  if ((await (fileHandle as any).queryPermission(options)) === 'granted') {
    return true;
  }

  // Request permission from the user
  if ((await (fileHandle as any).requestPermission(options)) === 'granted') {
    return true;
  }

  return false;
}

export async function saveDirectoryHandle(
  id: string,
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_HANDLES, 'readwrite');
    const store = tx.objectStore(STORE_HANDLES);
    const item: StoredDirectoryHandle = {
      id,
      name: handle.name,
      handle,
      addedAt: new Date().toISOString(),
    };
    const req = store.put(item);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getAllDirectoryHandles(): Promise<StoredDirectoryHandle[]> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_HANDLES, 'readonly');
      const store = tx.objectStore(STORE_HANDLES);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[CineLocal] Falha ao listar diretórios salvos:', err);
    return [];
  }
}

export async function removeDirectoryHandle(id: string): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_HANDLES, 'readwrite');
      const store = tx.objectStore(STORE_HANDLES);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[CineLocal] Falha ao remover diretório salvo:', err);
  }
}

export async function saveClientLibrary(data: LibraryData): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_LIBRARY, 'readwrite');
      const store = tx.objectStore(STORE_LIBRARY);
      const req = store.put({ id: 'main', data, updatedAt: new Date().toISOString() });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[CineLocal] Falha ao salvar biblioteca offline:', err);
  }
}

export async function getClientLibrary(): Promise<LibraryData | null> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_LIBRARY, 'readonly');
      const store = tx.objectStore(STORE_LIBRARY);
      const req = store.get('main');
      req.onsuccess = () => {
        if (req.result && req.result.data) {
          resolve(req.result.data);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[CineLocal] Falha ao obter biblioteca offline:', err);
    return null;
  }
}
