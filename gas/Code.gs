/**
 * 旅のしおり — Google Apps Script ウェブアプリ（個人用）
 *
 * データは自動作成されるスプレッドシート「旅のしおり データ」に保存します。
 *   Trips シート … 旅行（タイトル・行き先・日付）
 *   Items シート … 旅行ごとの 日程 / 持ち物 / 費用 / メモ（type 列で区別）
 */

const APP_TITLE = '旅のしおり';
const ITEM_TYPES = ['schedule', 'packing', 'expense', 'note'];
const MAX_LEN = 5000;

const SHEET_DEFS = {
  trips: {
    name: 'Trips',
    headers: ['id', 'title', 'destination', 'startDate', 'endDate', 'memo', 'createdAt', 'updatedAt'],
  },
  items: {
    name: 'Items',
    headers: ['id', 'tripId', 'type', 'date', 'time', 'title', 'place', 'amount', 'currency',
      'category', 'done', 'memo', 'url', 'createdAt', 'updatedAt'],
  },
};

const PACKING_TEMPLATE = [
  ['貴重品', ['財布', '現金', 'クレジットカード', '身分証・保険証', 'スマホ', 'パスポート（海外のみ）']],
  ['電子機器', ['スマホ充電器', 'モバイルバッテリー', 'イヤホン', '変換プラグ（海外のみ）']],
  ['衣類', ['着替え', '下着・靴下', 'パジャマ', '羽織るもの']],
  ['洗面・衛生', ['歯ブラシ', 'スキンケア用品', '常備薬', 'マスク', 'ティッシュ・ウェットティッシュ']],
  ['その他', ['折りたたみ傘', 'エコバッグ', '予約確認メール・チケット']],
];

/* ------------------------------------------------------------------ */
/* エントリーポイント                                                   */
/* ------------------------------------------------------------------ */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** 初回に一度エディタから実行：権限の承認とデータ用スプレッドシートの作成 */
function setup() {
  const ss = getDb_();
  Logger.log('データ保存先: ' + ss.getUrl());
}

/* ------------------------------------------------------------------ */
/* クライアントから呼ぶ API                                             */
/* ------------------------------------------------------------------ */

function api_init() {
  const ss = getDb_();
  return { trips: readAll_('trips'), dbUrl: ss.getUrl() };
}

function api_getTrip(id) {
  const trip = readAll_('trips').find(t => t.id === id);
  if (!trip) throw new Error('旅行が見つかりません（削除された可能性があります）');
  return { trip: trip, items: readAll_('items').filter(i => i.tripId === id) };
}

function api_saveTrip(input) {
  return upsert_('trips', input, validateTrip_);
}

function api_deleteTrip(id) {
  if (!id) throw new Error('id がありません');
  withLock_(() => {
    deleteWhere_('items', r => r.tripId === id);
    deleteWhere_('trips', r => r.id === id);
  });
  return true;
}

function api_saveItem(input) {
  const tripSheet = sheet_('trips');
  return upsert_('items', input, obj => {
    validateItem_(obj);
    if (findRow_(tripSheet, obj.tripId) < 0) throw new Error('旅行が見つかりません');
  });
}

function api_deleteItem(id) {
  if (!id) throw new Error('id がありません');
  withLock_(() => deleteWhere_('items', r => r.id === id));
  return true;
}

/** 定番の持ち物リストを追加（同名のものはスキップ） */
function api_addPackingTemplate(tripId) {
  if (findRow_(sheet_('trips'), tripId) < 0) throw new Error('旅行が見つかりません');
  const def = SHEET_DEFS.items;
  const sh = sheet_('items');
  return withLock_(() => {
    const existing = new Set(readAll_('items')
      .filter(i => i.tripId === tripId && i.type === 'packing')
      .map(i => i.title));
    const now = new Date().toISOString();
    const objs = [];
    PACKING_TEMPLATE.forEach(([category, titles]) => {
      titles.forEach(title => {
        if (existing.has(title)) return;
        objs.push(fill_(def.headers, {
          id: Utilities.getUuid(), tripId: tripId, type: 'packing',
          title: title, category: category, createdAt: now, updatedAt: now,
        }));
      });
    });
    writeRows_(sh, sh.getLastRow() + 1, def.headers, objs);
    return objs;
  });
}

/* ------------------------------------------------------------------ */
/* 入力チェック                                                         */
/* ------------------------------------------------------------------ */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function validateTrip_(t) {
  if (!t.title) throw new Error('タイトルを入力してください');
  if (t.startDate && !DATE_RE.test(t.startDate)) throw new Error('出発日の形式が正しくありません');
  if (t.endDate && !DATE_RE.test(t.endDate)) throw new Error('帰着日の形式が正しくありません');
  if (t.startDate && t.endDate && t.endDate < t.startDate) throw new Error('帰着日は出発日以降にしてください');
  if (!t.startDate && t.endDate) throw new Error('出発日も入力してください');
}

function validateItem_(i) {
  if (ITEM_TYPES.indexOf(i.type) < 0) throw new Error('種類が正しくありません');
  if (!i.tripId) throw new Error('旅行が指定されていません');
  if (!i.title) throw new Error('内容を入力してください');
  if (i.date && !DATE_RE.test(i.date)) throw new Error('日付の形式が正しくありません');
  if (i.time && !TIME_RE.test(i.time)) throw new Error('時刻の形式が正しくありません');
  if (i.url && !/^https?:\/\//i.test(i.url)) throw new Error('URL は http:// か https:// で始めてください');
  if (i.type === 'expense') {
    const n = Number(i.amount);
    if (i.amount === '' || !isFinite(n)) throw new Error('金額を数字で入力してください');
    i.amount = String(n);
    i.currency = (i.currency || 'JPY').toUpperCase();
    i.category = i.category || 'その他';
  }
  if (i.done && i.done !== '1') i.done = '1';
}

/* ------------------------------------------------------------------ */
/* スプレッドシート操作                                                 */
/* ------------------------------------------------------------------ */

let dbCache_ = null;

function getDb_() {
  if (dbCache_) return dbCache_;
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('DB_ID');
  if (id) {
    try {
      dbCache_ = SpreadsheetApp.openById(id);
    } catch (e) {
      throw new Error('データ用スプレッドシートを開けません。作り直す場合はスクリプト プロパティの DB_ID を削除してください。(' + e.message + ')');
    }
  } else {
    const ss = SpreadsheetApp.create(APP_TITLE + ' データ');
    const blank = ss.getSheets()[0];
    Object.keys(SHEET_DEFS).forEach(k => ensureSheet_(ss, k));
    ss.deleteSheet(blank);
    props.setProperty('DB_ID', ss.getId());
    dbCache_ = ss;
  }
  return dbCache_;
}

function ensureSheet_(ss, key) {
  const def = SHEET_DEFS[key];
  let sh = ss.getSheetByName(def.name);
  if (!sh) {
    sh = ss.insertSheet(def.name);
    sh.getRange(1, 1, 1, def.headers.length).setValues([def.headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    // 日付や時刻が自動変換されないよう、すべて書式なしテキストで保存する
    sh.getRange(1, 1, sh.getMaxRows(), def.headers.length).setNumberFormat('@');
  }
  return sh;
}

function sheet_(key) {
  return ensureSheet_(getDb_(), key);
}

function readAll_(key) {
  const def = SHEET_DEFS[key];
  const sh = sheet_(key);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, def.headers.length).getValues()
    .filter(r => r[0] !== '' && r[0] != null)
    .map(r => rowToObj_(def.headers, r));
}

function rowToObj_(headers, row) {
  const tz = Session.getScriptTimeZone();
  const o = {};
  headers.forEach((h, i) => {
    let v = row[i];
    if (v instanceof Date) v = Utilities.formatDate(v, tz, h === 'time' ? 'HH:mm' : 'yyyy-MM-dd');
    else if (typeof v === 'boolean') v = v ? '1' : '';
    v = v == null ? '' : String(v);
    if (/^'[=+@]/.test(v)) v = v.slice(1);
    o[h] = v;
  });
  return o;
}

function toCell_(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+@]/.test(s)) s = "'" + s; // 数式として解釈させない
  return s;
}

function fill_(headers, obj) {
  const o = {};
  headers.forEach(h => { o[h] = obj[h] == null ? '' : String(obj[h]); });
  return o;
}

function pick_(headers, input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  headers.forEach(h => {
    if (h === 'createdAt' || h === 'updatedAt') return;
    if (Object.prototype.hasOwnProperty.call(input, h) && input[h] != null) {
      out[h] = String(input[h]).trim().slice(0, MAX_LEN);
    }
  });
  return out;
}

function findRow_(sh, id) {
  if (!id) return -1;
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function writeRows_(sh, startRow, headers, objs) {
  if (!objs.length) return;
  const need = startRow + objs.length - 1;
  if (need > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows() + 50);
  sh.getRange(startRow, 1, objs.length, headers.length)
    .setNumberFormat('@')
    .setValues(objs.map(o => headers.map(h => toCell_(o[h]))));
}

/** 追加または更新。input に含まれる項目だけを上書きする */
function upsert_(key, input, validate) {
  const def = SHEET_DEFS[key];
  const sh = sheet_(key);
  return withLock_(() => {
    const now = new Date().toISOString();
    const patch = pick_(def.headers, input);
    let row = findRow_(sh, patch.id);
    let obj;
    if (row > 0) {
      const cur = rowToObj_(def.headers, sh.getRange(row, 1, 1, def.headers.length).getValues()[0]);
      obj = Object.assign(cur, patch);
    } else {
      obj = fill_(def.headers, Object.assign({}, patch, { id: Utilities.getUuid(), createdAt: now }));
      row = sh.getLastRow() + 1;
    }
    obj.updatedAt = now;
    if (validate) validate(obj);
    writeRows_(sh, row, def.headers, [obj]);
    return obj;
  });
}

/** 条件に合う行を削除（残りの行を詰めて書き直す） */
function deleteWhere_(key, pred) {
  const def = SHEET_DEFS[key];
  const sh = sheet_(key);
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const all = sh.getRange(2, 1, last - 1, def.headers.length).getValues()
    .filter(r => r[0] !== '' && r[0] != null)
    .map(r => rowToObj_(def.headers, r));
  const keep = all.filter(o => !pred(o));
  const removed = all.length - keep.length;
  if (!removed) return 0;
  sh.getRange(2, 1, last - 1, def.headers.length).clearContent();
  writeRows_(sh, 2, def.headers, keep);
  return removed;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
