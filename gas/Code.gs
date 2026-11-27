/**
 * そぞろつづり — サーバー側（Google Apps Script のウェブアプリ / API）
 *
 * 画面（PWA）は GitHub Pages にあり、このスクリプトはデータの保存と同期だけを担当する。
 *   ・データ：スプレッドシート「そぞろつづり データ」（Trips / Items / Photos シート）
 *   ・写真　：Googleドライブのフォルダ「そぞろつづり 写真」
 *   ・合言葉：スクリプト プロパティ API_KEY（setup で自動作成）
 *
 * 初回だけ、エディタで setup を実行してください（docs/setup.md）。
 */

const APP = 'そぞろつづり';
const API_VERSION = 1;
const GEOCODE_PER_SYNC = 20;

const SHEETS = {
  trips: { name: 'Trips', headers: ['id', 'updatedAt', 'deleted', 'serverAt', 'json'] },
  items: { name: 'Items', headers: ['id', 'tripId', 'type', 'updatedAt', 'deleted', 'serverAt', 'json'] },
  photos: { name: 'Photos', headers: ['id', 'itemId', 'tripId', 'fileId', 'mime', 'createdAt'] },
};

/* ------------------------------------------------------------------ */
/* 初期設定                                                             */
/* ------------------------------------------------------------------ */

/** 初回に一度エディタから実行する。保存先の作成と合言葉の発行 */
function setup() {
  const ss = db_();
  const folder = photoFolder_();
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('API_KEY');
  if (!key) {
    key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('API_KEY', key);
  }
  Logger.log('データ: ' + ss.getUrl());
  Logger.log('写真フォルダ: ' + folder.getUrl());
  Logger.log('合言葉（アプリの設定に入力）: ' + key);
}

/** 合言葉を作り直す（漏れたかもしれないとき）。アプリ側の設定も入れ直すこと */
function resetApiKey() {
  const key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('API_KEY', key);
  Logger.log('新しい合言葉: ' + key);
}

/* ------------------------------------------------------------------ */
/* 入口                                                                 */
/* ------------------------------------------------------------------ */

function doGet() {
  return json_({ ok: true, app: APP, api: API_VERSION, message: 'そぞろつづりのサーバーです。アプリから POST で使います。' });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    checkKey_(body.key);
    switch (body.action) {
      case 'ping': return json_({ ok: true, app: APP, api: API_VERSION, serverTime: new Date().toISOString() });
      case 'sync': return json_(sync_(body));
      case 'uploadPhoto': return json_(uploadPhoto_(body.photo));
      case 'getPhoto': return json_(getPhoto_(body.id));
      default: throw new Error('不明な操作です: ' + body.action);
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function checkKey_(key) {
  const expected = PropertiesService.getScriptProperties().getProperty('API_KEY');
  if (!expected) throw new Error('サーバーの初期設定（setup）がまだです');
  if (typeof key !== 'string' || key.length !== expected.length) throw new Error('合言葉が違います');
  // 文字ごとの比較時間をそろえる
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= key.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) throw new Error('合言葉が違います');
}

/* ------------------------------------------------------------------ */
/* 同期                                                                 */
/* ------------------------------------------------------------------ */

/**
 * 端末から届いた変更を保存し、since 以降にサーバーで変わったデータを返す。
 * ・同じデータが両方で変わっていたら、updatedAt が新しい方を残す
 * ・since の比較には、端末の時計ではなく、サーバーの同期ごとの連番（serverAt）を使う。
 *   時刻だと、同じミリ秒の中の更新を取りこぼすことがあるため
 */
function sync_(body) {
  const since = String(body.since || '');
  const changes = body.changes || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const seq = nextSeq_();
    upsert_('trips', changes.trips || [], seq);
    upsert_('items', changes.items || [], seq);
    geocodePending_(seq);
    return {
      ok: true,
      cursor: seq, // 次回の since に使う
      serverTime: new Date().toISOString(),
      changes: {
        trips: changedSince_('trips', since),
        items: changedSince_('items', since),
      },
    };
  } finally {
    lock.releaseLock();
  }
}

/** 同期ごとに1ずつ増える連番（12桁の文字列。文字列のまま大小を比べられる） */
function nextSeq_() {
  const props = PropertiesService.getScriptProperties();
  const n = Number(props.getProperty('SYNC_SEQ') || '0') + 1;
  props.setProperty('SYNC_SEQ', String(n));
  return ('000000000000' + n).slice(-12);
}

function sheet_(key) {
  const def = SHEETS[key];
  const ss = db_();
  let sh = ss.getSheetByName(def.name);
  if (!sh) {
    sh = ss.insertSheet(def.name);
    sh.getRange(1, 1, 1, def.headers.length).setValues([def.headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), def.headers.length).setNumberFormat('@');
  }
  return sh;
}

/** シートの全行を読み、{ rows, index(id→行番号) } を返す */
function readSheet_(key) {
  const def = SHEETS[key];
  const sh = sheet_(key);
  const last = sh.getLastRow();
  const rows = last < 2 ? [] : sh.getRange(2, 1, last - 1, def.headers.length).getValues();
  const index = {};
  rows.forEach((r, i) => { if (r[0]) index[String(r[0])] = i + 2; });
  return { sh: sh, def: def, rows: rows, index: index };
}

function toRow_(key, rec, serverAt) {
  const deleted = rec.deleted ? '1' : '';
  const jsonStr = JSON.stringify(rec);
  if (key === 'trips') return [rec.id, rec.updatedAt || '', deleted, serverAt, jsonStr];
  return [rec.id, rec.tripId || '', rec.type || '', rec.updatedAt || '', deleted, serverAt, jsonStr];
}

function validRecord_(key, rec) {
  if (!rec || typeof rec !== 'object' || typeof rec.id !== 'string' || !rec.id) return false;
  if (rec.id.length > 64) return false;
  if (key === 'items' && (typeof rec.tripId !== 'string' || !rec.tripId)) return false;
  return JSON.stringify(rec).length <= 45000; // セル1つの上限（5万文字）より小さく
}

function upsert_(key, records, serverAt) {
  if (!records.length) return;
  const t = readSheet_(key);
  const updatedCol = key === 'trips' ? 1 : 3; // 0始まりの列番号
  const appends = [];
  records.forEach(rec => {
    if (!validRecord_(key, rec)) return;
    delete rec.dirty;
    const row = t.index[rec.id];
    if (row) {
      const cur = String(t.rows[row - 2][updatedCol] || '');
      if (cur && String(rec.updatedAt || '') < cur) return; // サーバーの方が新しい
      const values = toRow_(key, rec, serverAt);
      t.sh.getRange(row, 1, 1, values.length).setNumberFormat('@').setValues([values]);
      t.rows[row - 2] = values;
    } else {
      appends.push(toRow_(key, rec, serverAt));
      t.index[rec.id] = -1; // 同じ送信内での重複を防ぐ
    }
  });
  if (appends.length) {
    const start = t.sh.getLastRow() + 1;
    const need = start + appends.length - 1;
    if (need > t.sh.getMaxRows()) t.sh.insertRowsAfter(t.sh.getMaxRows(), need - t.sh.getMaxRows() + 100);
    t.sh.getRange(start, 1, appends.length, t.def.headers.length).setNumberFormat('@').setValues(appends);
  }
}

function changedSince_(key, since) {
  const t = readSheet_(key);
  const serverAtCol = key === 'trips' ? 3 : 5;
  const jsonCol = t.def.headers.length - 1;
  const out = [];
  t.rows.forEach(r => {
    if (!r[0]) return;
    if (since && String(r[serverAtCol]) <= since) return;
    try { out.push(JSON.parse(r[jsonCol])); } catch (e) { /* 壊れた行は飛ばす */ }
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* 市町村の自動付与（逆ジオコーディング）                               */
/* ------------------------------------------------------------------ */

/** 位置があり市町村がない「記録」に、都道府県・市町村を付ける */
function geocodePending_(serverAt) {
  const t = readSheet_('items');
  let count = 0;
  for (let i = 0; i < t.rows.length && count < GEOCODE_PER_SYNC; i++) {
    const r = t.rows[i];
    if (r[2] !== 'log' || r[4] === '1') continue;
    let rec;
    try { rec = JSON.parse(r[6]); } catch (e) { continue; }
    if (!rec.lat || !rec.lng || rec.city || rec.geocoded === '1') continue;
    count++;
    const place = reverseGeocode_(Number(rec.lat), Number(rec.lng));
    rec.geocoded = '1';
    if (place) {
      rec.pref = place.pref;
      rec.city = place.city;
    }
    rec.updatedAt = new Date().toISOString();
    const values = toRow_('items', rec, serverAt);
    t.sh.getRange(i + 2, 1, 1, values.length).setNumberFormat('@').setValues([values]);
  }
}

/** 緯度経度から { pref, city } を返す。東京23区は「〇〇区」を city にする */
function reverseGeocode_(lat, lng) {
  if (!isFinite(lat) || !isFinite(lng)) return null;
  try {
    const res = Maps.newGeocoder().setLanguage('ja').setRegion('jp').reverseGeocode(lat, lng);
    if (!res || res.status !== 'OK' || !res.results.length) return null;
    let pref = '', city = '', ward = '';
    for (const result of res.results) {
      for (const c of result.address_components) {
        const types = c.types || [];
        if (!pref && types.indexOf('administrative_area_level_1') >= 0) pref = c.long_name;
        if (!city && types.indexOf('locality') >= 0) city = c.long_name;
        if (!ward && types.indexOf('sublocality_level_1') >= 0 && /区$/.test(c.long_name)) ward = c.long_name;
      }
      if (pref && city) break;
    }
    if (!city && ward) city = ward;
    if (pref === '東京都' && ward && !/市$|町$|村$/.test(city)) city = ward;
    return pref || city ? { pref: pref, city: city } : null;
  } catch (e) {
    console.warn('reverseGeocode failed', e);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 写真                                                                 */
/* ------------------------------------------------------------------ */

function uploadPhoto_(p) {
  if (!p || typeof p.id !== 'string' || !p.id || p.id.length > 64) throw new Error('写真の情報が足りません');
  if (typeof p.data !== 'string' || !p.data) throw new Error('写真のデータがありません');
  const mime = /^image\/(jpeg|png|webp)$/.test(p.mime || '') ? p.mime : 'image/jpeg';
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const t = readSheet_('photos');
    const row = t.index[p.id];
    if (row) return { ok: true, fileId: String(t.rows[row - 2][3]), existed: true };
    const bytes = Utilities.base64Decode(p.data);
    if (bytes.length > 8 * 1024 * 1024) throw new Error('写真が大きすぎます');
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    const blob = Utilities.newBlob(bytes, mime, p.id + '.' + ext);
    const file = photoFolder_().createFile(blob);
    t.sh.appendRow([p.id, String(p.itemId || ''), String(p.tripId || ''), file.getId(), mime, new Date().toISOString()]);
    return { ok: true, fileId: file.getId() };
  } finally {
    lock.releaseLock();
  }
}

function getPhoto_(id) {
  const t = readSheet_('photos');
  const row = t.index[String(id || '')];
  if (!row) throw new Error('写真が見つかりません');
  const r = t.rows[row - 2];
  const file = DriveApp.getFileById(String(r[3]));
  return {
    ok: true, id: String(r[0]), itemId: String(r[1]), tripId: String(r[2]), fileId: String(r[3]),
    mime: String(r[4] || 'image/jpeg'), data: Utilities.base64Encode(file.getBlob().getBytes()),
  };
}

/* ------------------------------------------------------------------ */
/* 保存先                                                               */
/* ------------------------------------------------------------------ */

let dbCache_ = null;

function db_() {
  if (dbCache_) return dbCache_;
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('DB_ID');
  if (id) {
    dbCache_ = SpreadsheetApp.openById(id);
    return dbCache_;
  }
  const ss = SpreadsheetApp.create(APP + ' データ');
  const blank = ss.getSheets()[0];
  dbCache_ = ss;
  Object.keys(SHEETS).forEach(k => sheet_(k));
  ss.deleteSheet(blank);
  props.setProperty('DB_ID', ss.getId());
  return ss;
}

function photoFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) return DriveApp.getFolderById(id);
  const folder = DriveApp.createFolder(APP + ' 写真');
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}
