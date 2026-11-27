// サーバー（GAS）との同期
// ・端末の未送信データを送り、サーバー側で更新されたデータを受け取る
// ・写真は1枚ずつ送る
// ・Background Sync は iPhone で使えないため使わない。アプリを開いたとき・
//   画面に戻ったとき・電波が戻ったとき・保存したあとに同期する（要件定義 4.2）

import * as db from './db.js';
import { blobToBase64, base64ToBlob } from './util.js';

const listeners = new Set();
let running = null;
let lastError = '';

export function onStatus(fn) { listeners.add(fn); }

async function emit(state) {
  const pending = await db.pendingCount();
  const s = Object.assign({
    pending,
    lastSync: await db.getMeta('lastSyncAt', ''),
    configured: await isConfigured(),
    online: navigator.onLine,
    error: lastError,
  }, state);
  listeners.forEach(fn => { try { fn(s); } catch (e) { console.error(e); } });
}

export async function getSettings() {
  return {
    apiUrl: await db.getMeta('apiUrl', ''),
    apiKey: await db.getMeta('apiKey', ''),
  };
}

export async function isConfigured() {
  const s = await getSettings();
  return !!(s.apiUrl && s.apiKey);
}

async function post(action, payload) {
  const { apiUrl, apiKey } = await getSettings();
  if (!apiUrl || !apiKey) throw new Error('サーバーの設定がありません');
  // Content-Type を text/plain にして、ブラウザの事前確認（プリフライト）を避ける
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ action, key: apiKey }, payload)),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error('サーバーエラー（' + res.status + '）');
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'サーバーエラー');
  return data;
}

export async function ping() {
  return post('ping', {});
}

const strip = r => { const o = Object.assign({}, r); delete o.dirty; return o; };

/** 受け取ったデータを端末に反映する。端末側の方が新しい未送信データは残す */
async function applyIncoming(store, records) {
  let changed = 0;
  for (const r of records || []) {
    const cur = await db.get(store, r.id);
    if (cur && cur.dirty && String(cur.updatedAt) > String(r.updatedAt)) continue;
    await db.putRaw(store, Object.assign({}, r, { dirty: 0 }));
    changed++;
  }
  return changed;
}

/** 送信した記録のうち、送信後に変更されていないものの未送信印を外す */
async function clearDirty(store, sent) {
  for (const r of sent) {
    const cur = await db.get(store, r.id);
    if (cur && cur.dirty && cur.updatedAt === r.updatedAt) {
      await db.putRaw(store, Object.assign({}, cur, { dirty: 0 }));
    }
  }
}

async function runSync() {
  if (!navigator.onLine) { await emit({ syncing: false }); return { skipped: 'offline' }; }
  if (!(await isConfigured())) { await emit({ syncing: false }); return { skipped: 'not-configured' }; }
  await emit({ syncing: true });
  try {
    const trips = await db.dirtyRecords('trips');
    const items = await db.dirtyRecords('items');
    const since = await db.getMeta('serverCursor', '');
    const res = await post('sync', {
      since,
      changes: { trips: trips.map(strip), items: items.map(strip) },
    });
    await clearDirty('trips', trips);
    await clearDirty('items', items);
    const changed = (await applyIncoming('trips', res.changes && res.changes.trips)) +
      (await applyIncoming('items', res.changes && res.changes.items));
    await db.setMeta('serverCursor', res.cursor);

    // 写真を1枚ずつ送る
    const photos = await db.pendingPhotos();
    for (const p of photos) {
      const data = await blobToBase64(p.blob);
      const r = await post('uploadPhoto', {
        photo: { id: p.id, itemId: p.itemId, tripId: p.tripId, mime: p.blob.type || 'image/jpeg', data },
      });
      await db.putRaw('photos', Object.assign({}, p, { uploaded: 1, fileId: r.fileId }));
    }

    lastError = '';
    await db.setMeta('lastSyncAt', new Date().toISOString());
    await emit({ syncing: false, changed });
    return { changed };
  } catch (e) {
    lastError = e.message || String(e);
    await emit({ syncing: false });
    throw e;
  }
}

/** 同期する（同時に複数走らないようにする） */
export function syncNow() {
  if (!running) running = runSync().finally(() => { running = null; });
  return running;
}

/** 他の端末で撮った写真など、端末にない写真をサーバーから取ってくる */
export async function fetchPhoto(id) {
  const r = await post('getPhoto', { id });
  const blob = base64ToBlob(r.data, r.mime);
  await db.savePhoto({ id, itemId: r.itemId, tripId: r.tripId, blob, uploaded: 1, fileId: r.fileId });
  return blob;
}

export async function refreshStatus() { await emit({}); }
