import type { Kind, RigDef } from './rig';

/** User-added garments live in IndexedDB on the device; nothing is uploaded. */
export interface StoredGarment {
  id: string;
  name: string;
  kind: Kind;
  blob: Blob;
  rig: RigDef;
  /** average colour, for the little dot on the tab */
  color?: string;
  created: number;
}

const DB = 'clothes-tryon';
const STORE = 'garments';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

export async function listStored(): Promise<StoredGarment[]> {
  try {
    const all = await run<StoredGarment[]>('readonly', (s) => s.getAll());
    return all.sort((a, b) => a.created - b.created);
  } catch {
    return [];
  }
}

/** Resolves false when the browser refuses to store (private mode); the garment then lasts this session only. */
export async function saveStored(g: StoredGarment): Promise<boolean> {
  try {
    await run('readwrite', (s) => s.put(g));
    return true;
  } catch {
    return false;
  }
}

export async function deleteStored(id: string): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(id));
  } catch {
    /* ignore */
  }
}
