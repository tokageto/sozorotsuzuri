// 端末内の保存（IndexedDB）
// trips / items / photos / meta の4つの保存場所を持つ。
// trips と items は「dirty=1（未送信）」の印で同期対象を管理する。

import { uuid, nowIso, OWNER_ID } from './util.js';

const DB_NAME = 'sozorotsuzuri';
const DB_VERSION = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('trips')) {
        const s = db.createObjectStore('trips', { keyPath: 'id' });
        s.createIndex('dirty', 'dirty');
      }
      if (!db.objectStoreNames.contains('items')) {
        const s = db.createObjectStore('items', { keyPath: 'id' });
        s.createIndex('tripId', 'tripId');
        s.createIndex('dirty', 'dirty');
      }
      if (!db.objectStoreNames.contains('photos')) {
        const s = db.createObjectStore('photos', { keyPath: 'id' });
        s.createIndex('itemId', 'itemId');
        s.createIndex('uploaded', 'uploaded');
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    Promise.resolve(fn(t)).then(r => { result = r; }, reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/* ---------- 汎用 ---------- */

export async function getAll(store) {
  return tx([store], 'readonly', t => reqP(t.objectStore(store).getAll()));
}

export async function get(store, id) {
  return tx([store], 'readonly', t => reqP(t.objectStore(store).get(id)));
}

export async function byIndex(store, index, value) {
  return tx([store], 'readonly', t => reqP(t.objectStore(store).index(index).getAll(value)));
}

export async function putRaw(store, obj) {
  return tx([store], 'readwrite', t => reqP(t.objectStore(store).put(obj)));
}

export async function putManyRaw(store, objs) {
  return tx([store], 'readwrite', t => {
    const s = t.objectStore(store);
    objs.forEach(o => s.put(o));
  });
}

/* ---------- 旅行・項目（同期対象） ---------- */

/** 保存（新規なら id 等を付与）。dirty=1 にして同期待ちにする */
export async function save(store, data) {
  const now = nowIso();
  const cur = data.id ? await get(store, data.id) : null;
  const obj = Object.assign({}, cur || {}, data);
  if (!obj.id) obj.id = uuid();
  if (!obj.createdAt) obj.createdAt = now;
  if (!obj.ownerId) obj.ownerId = OWNER_ID;
  obj.deleted = obj.deleted ? 1 : 0;
  obj.updatedAt = now;
  obj.dirty = 1;
  await putRaw(store, obj);
  return obj;
}

/** 削除の印を付ける（同期で他の端末にも削除を伝えるため、実際には消さない） */
export async function remove(store, id) {
  const cur = await get(store, id);
  if (!cur) return;
  return save(store, { id, deleted: 1 });
}

export async function listTrips() {
  return (await getAll('trips')).filter(t => !t.deleted);
}

export async function listItems(tripId) {
  return (await byIndex('items', 'tripId', tripId)).filter(i => !i.deleted);
}

export async function deleteTrip(tripId) {
  const items = await byIndex('items', 'tripId', tripId);
  for (const i of items) if (!i.deleted) await remove('items', i.id);
  await remove('trips', tripId);
}

export async function dirtyRecords(store) {
  return byIndex(store, 'dirty', 1);
}

/* ---------- 写真 ---------- */

export async function savePhoto(p) {
  return putRaw('photos', Object.assign({ uploaded: 0, createdAt: nowIso() }, p));
}

export async function photosForItem(itemId) {
  return byIndex('photos', 'itemId', itemId);
}

export async function pendingPhotos() {
  return byIndex('photos', 'uploaded', 0);
}

/* ---------- 設定など ---------- */

export async function getMeta(key, def) {
  const r = await get('meta', key);
  return r ? r.value : def;
}

export async function setMeta(key, value) {
  return putRaw('meta', { key, value });
}

export async function pendingCount() {
  const [t, i, p] = await Promise.all([dirtyRecords('trips'), dirtyRecords('items'), pendingPhotos()]);
  return t.length + i.length + p.length;
}

/** バックアップ用：全データを書き出す（写真は含めない） */
export async function exportAll() {
  const [trips, items] = await Promise.all([getAll('trips'), getAll('items')]);
  return { app: 'sozorotsuzuri', version: 1, exportedAt: nowIso(), trips, items };
}

export async function importAll(data) {
  if (!data || data.app !== 'sozorotsuzuri') throw new Error('そぞろつづりのバックアップファイルではありません');
  const trips = (data.trips || []).map(t => Object.assign({}, t, { dirty: 1 }));
  const items = (data.items || []).map(i => Object.assign({}, i, { dirty: 1 }));
  await putManyRaw('trips', trips);
  await putManyRaw('items', items);
  return { trips: trips.length, items: items.length };
}
