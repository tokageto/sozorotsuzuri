// そぞろつづり ― 画面と操作
import * as db from './db.js';
import * as sync from './sync.js';
import { resizePhoto, photoUrl } from './photos.js';
import { makeHighlight } from './highlight.js';
import {
  uuid, esc, ymd, hm, todayStr, parseYmd, fmtDate, daysBetween, cmp, tripStatus, fmtRange,
  money, safeUrl, mapSearchUrl, routeUrl, toast, debounce, downloadBlob,
} from './util.js';

/* ================================================================== */
/* 定数                                                                */
/* ================================================================== */

const APP_VERSION = '0.2.0';

const TABS = [
  { key: 'schedule', label: '日程', icon: '🗓️' },
  { key: 'log', label: '記録', icon: '📷' },
  { key: 'expense', label: '費用', icon: '💴' },
  { key: 'packing', label: '持ち物', icon: '🎒' },
  { key: 'note', label: 'メモ', icon: '📝' },
];
const EXPENSE_CATS = ['交通', '宿泊', '食事', '観光', '買い物', 'その他'];
const CAT_ICON = { 交通: '🚃', 宿泊: '🏨', 食事: '🍽️', 観光: '🎫', 買い物: '🛍️', その他: '💡' };
const PACKING_TEMPLATE = [
  ['貴重品', ['財布', '現金', 'クレジットカード', '身分証・保険証', 'スマホ']],
  ['電子機器', ['スマホ充電器', 'モバイルバッテリー', 'イヤホン']],
  ['衣類', ['着替え', '下着・靴下', 'パジャマ', '羽織るもの']],
  ['洗面・衛生', ['歯ブラシ', 'スキンケア用品', '常備薬', 'マスク', 'ティッシュ・ウェットティッシュ']],
  ['その他', ['折りたたみ傘', 'エコバッグ', '予約確認メール・チケット']],
];

const FORMS = {
  trip: { title: '旅行', fields: [
    { k: 'title', label: 'タイトル', req: true, ph: '例：銚子 ぬれ煎餅さんぽ' },
    { k: 'destination', label: '行き先', ph: '例：銚子' },
    { k: 'startDate', label: '出発日', type: 'date', half: true },
    { k: 'endDate', label: '帰着日', type: 'date', half: true },
    { k: 'memo', label: 'メモ', type: 'textarea', ph: '同行者・テーマなど' },
  ] },
  schedule: { title: '予定', fields: [
    { k: 'date', label: '日付', type: 'date', half: true },
    { k: 'time', label: '時刻', type: 'time', half: true },
    { k: 'title', label: '内容', req: true, ph: '例：銚子電鉄で外川へ' },
    { k: 'place', label: '場所', ph: '入力すると地図と行き方を開けます' },
    { k: 'memo', label: 'メモ', type: 'textarea', ph: '予約番号・座席など' },
    { k: 'url', label: 'URL', type: 'url', ph: 'https://' },
  ] },
  log: { title: '記録', fields: [
    { k: 'photos', label: '写真', type: 'photos' },
    { k: 'memo', label: 'ひとこと', type: 'textarea', rows: 3, ph: 'いま見ているもの、感じたこと' },
    { k: 'date', label: '日付', type: 'date', half: true },
    { k: 'time', label: '時刻', type: 'time', half: true },
    { k: 'geo', label: '場所', type: 'geo' },
    { k: 'spot', label: 'スポット', list: 'dl-spot', ph: '例：犬吠埼灯台' },
    { k: 'pref', label: '都道府県', half: true, ph: '自動（同期時）' },
    { k: 'city', label: '市町村', half: true, ph: '自動（同期時）' },
  ] },
  expense: { title: '費用', fields: [
    { k: 'title', label: '内容', req: true, ph: '例：ランチ' },
    { k: 'amount', label: '金額', type: 'number', req: true, half: true, inputmode: 'decimal' },
    { k: 'currency', label: '通貨', half: true, list: 'dl-cur' },
    { k: 'category', label: 'カテゴリ', type: 'chips', options: EXPENSE_CATS },
    { k: 'from', label: '出発地', half: true, ph: '例：銚子', only: 'transport' },
    { k: 'to', label: '到着地', half: true, ph: '例：外川', only: 'transport' },
    { k: 'date', label: '日付', type: 'date', half: true },
    { k: 'city', label: '市町村', half: true, ph: '例：銚子市' },
    { k: 'memo', label: 'メモ' },
  ] },
  packing: { title: '持ち物', fields: [
    { k: 'title', label: '持ち物', req: true },
    { k: 'category', label: 'カテゴリ', list: 'dl-pack', ph: '例：衣類' },
    { k: 'memo', label: 'メモ', ph: '個数など' },
  ] },
  note: { title: 'メモ', fields: [
    { k: 'title', label: 'タイトル', req: true, ph: '例：宿の予約情報' },
    { k: 'memo', label: '内容', type: 'textarea', rows: 8, ph: '予約番号・住所・電話番号など' },
    { k: 'url', label: 'URL', type: 'url', ph: 'https://' },
  ] },
};

/* ================================================================== */
/* 状態                                                                */
/* ================================================================== */

const S = {
  view: 'loading', trips: [], trip: null, items: [], photos: new Map(), tab: 'schedule',
  sync: { pending: 0, configured: false, online: navigator.onLine, syncing: false, error: '', lastSync: '' },
};
const app = document.getElementById('app');
let renderToken = 0;

/* ================================================================== */
/* 画面遷移（URLの # で管理。戻るボタンが効く）                       */
/* ================================================================== */

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  if (parts[0] === 'trip' && parts[1]) return { view: 'trip', id: parts[1], tab: parts[2] };
  if (parts[0] === 'settings') return { view: 'settings' };
  return { view: 'home' };
}

function go(hash, replace) {
  if (replace) history.replaceState(null, '', hash);
  else location.hash = hash;
  if (replace) route();
}

async function route() {
  const r = parseHash();
  const token = ++renderToken;
  S.trips = await db.listTrips();
  if (r.view === 'trip') {
    const trip = S.trips.find(t => t.id === r.id);
    if (!trip) { go('#/', true); return; }
    const sameTrip = S.trip && S.trip.id === trip.id && S.view === 'trip';
    S.trip = trip;
    S.tab = TABS.some(t => t.key === r.tab) ? r.tab : 'schedule';
    await loadItems();
    if (token !== renderToken) return;
    S.view = 'trip';
    render();
    if (!sameTrip) {
      window.scrollTo(0, 0);
      if (S.tab === 'schedule') scrollToToday();
    }
  } else {
    S.view = r.view;
    S.trip = null;
    render();
    window.scrollTo(0, 0);
  }
}

async function loadItems() {
  S.items = await db.listItems(S.trip.id);
  const ids = new Set();
  S.items.forEach(i => (i.photoIds || []).forEach(id => ids.add(id)));
  const map = new Map();
  for (const id of ids) {
    const p = await db.get('photos', id);
    map.set(id, p || null);
  }
  S.photos = map;
}

async function refresh() {
  S.trips = await db.listTrips();
  if (S.view === 'trip' && S.trip) {
    S.trip = S.trips.find(t => t.id === S.trip.id) || S.trip;
    await loadItems();
  }
  render();
}

function scrollToToday() {
  const el = document.getElementById('today');
  if (el) el.scrollIntoView({ block: 'start' });
}

/* ================================================================== */
/* 描画                                                                */
/* ================================================================== */

function render() {
  const y = window.scrollY;
  if (S.view === 'home') app.innerHTML = homeHtml();
  else if (S.view === 'trip') app.innerHTML = tripHtml();
  else if (S.view === 'settings') app.innerHTML = settingsHtml();
  document.body.classList.toggle('has-tabbar', S.view === 'trip');
  window.scrollTo(0, y);
}

function syncChip() {
  const s = S.sync;
  let cls = '', label;
  if (!s.configured) label = s.pending ? '端末のみ・' + s.pending + '件' : '端末のみ';
  else if (s.syncing) label = '同期中…';
  else if (!s.online) { cls = 'pending'; label = 'オフライン' + (s.pending ? '・未送信' + s.pending : ''); }
  else if (s.error) { cls = 'err'; label = '同期エラー'; }
  else if (s.pending) { cls = 'pending'; label = '未送信 ' + s.pending; }
  else { cls = 'ok'; label = '同期済み'; }
  return '<button class="sync-chip ' + cls + '" data-act="sync" aria-label="同期の状態：' + esc(label) + '">' + esc(label) + '</button>';
}

function hint(icon, text) {
  return '<div class="hint"><div class="empty-ico">' + icon + '</div><p>' + text + '</p></div>';
}

/* ---------- ホーム ---------- */

function homeHtml() {
  const g = { ongoing: [], upcoming: [], past: [] };
  S.trips.forEach(t => g[tripStatus(t).kind].push(t));
  g.ongoing.sort((a, b) => cmp(a.startDate, b.startDate));
  g.upcoming.sort((a, b) => cmp(a.startDate || '9999', b.startDate || '9999'));
  g.past.sort((a, b) => cmp(b.startDate, a.startDate));

  let h = '<header class="topbar"><h1 class="brand">そぞろつづり<small>小さな旅の記録帳</small></h1>' +
    syncChip() + '<button class="icon-btn" data-act="settings" aria-label="設定">⚙️</button></header><main class="wrap">';
  if (!S.trips.length) {
    h += '<div class="empty"><div class="empty-ico">🗺️</div><p>まだ旅行がありません。<br>右下の「＋」から作成しましょう。</p>' +
      '<button class="btn" data-act="seed">見本の旅を入れてみる</button></div>';
  }
  [['ongoing', '旅行中'], ['upcoming', 'これから'], ['past', 'これまで']].forEach(([k, label]) => {
    if (!g[k].length) return;
    h += '<h2 class="sec">' + label + '</h2><div class="list">' + g[k].map(tripCard).join('') + '</div>';
  });
  h += '<p class="foot">気の向くままに歩いた旅を、そっと綴っておく帳面</p>';
  h += '</main><button class="fab" data-act="new-trip" aria-label="旅行を追加">＋</button>';
  return h;
}

function tripCard(t) {
  const st = tripStatus(t);
  return '<div class="card trip-card ' + st.kind + '" role="button" tabindex="0" data-act="open-trip" data-id="' + esc(t.id) + '">' +
    '<div class="tc-main"><div class="tc-title">' + esc(t.title) + '</div>' +
    '<div class="tc-sub">' + (t.destination ? '📍' + esc(t.destination) + '　' : '') + esc(fmtRange(t)) + '</div></div>' +
    '<span class="pill ' + st.kind + '">' + esc(st.label) + '</span></div>';
}

/* ---------- 旅行詳細 ---------- */

function tripHtml() {
  const t = S.trip, st = tripStatus(t);
  let h = '<header class="topbar">' +
    '<button class="icon-btn" data-act="home" aria-label="一覧へ戻る">‹</button>' +
    '<div class="tb-title">' + esc(t.title) + '</div>' + syncChip() +
    '<button class="icon-btn" data-act="edit-trip" aria-label="旅行を編集">✎</button></header>' +
    '<main class="wrap"><section class="hero">' +
    (t.destination ? '<div class="hero-sub">📍 ' + esc(t.destination) + '</div>' : '') +
    '<div class="hero-date">' + esc(fmtRange(t)) + '</div>' +
    '<span class="pill ' + st.kind + '">' + esc(st.label) + '</span>' +
    (t.memo ? '<div class="hero-memo">' + esc(t.memo) + '</div>' : '') +
    '<div class="hero-actions"><button class="chip-btn" data-act="highlight">🖼️ ハイライト画像</button>' +
    (t.destination ? '<a class="chip-btn" href="' + esc(routeUrl(t.destination)) + '" target="_blank" rel="noopener">🚃 ' + esc(t.destination) + 'への行き方</a>' : '') +
    '</div></section>';
  h += { schedule: scheduleHtml, log: logHtml, expense: expenseHtml, packing: packingHtml, note: noteHtml }[S.tab]();
  h += '</main><button class="fab with-nav" data-act="add" aria-label="追加">＋</button>' +
    '<nav class="tabbar">' + TABS.map(tb =>
      '<button class="tab' + (tb.key === S.tab ? ' on' : '') + '" data-act="tab" data-tab="' + tb.key + '">' +
      '<span class="tab-ico">' + tb.icon + '</span><span>' + tb.label + '</span></button>').join('') +
    '</nav>';
  return h;
}

const byTime = (a, b) => cmp(a.time || '99:99', b.time || '99:99') || cmp(a.createdAt, b.createdAt);

/** 旅行期間の日付＋データがある日付の一覧 */
function tripDates(items) {
  const t = S.trip;
  const dates = new Set(items.map(i => i.date).filter(Boolean));
  if (t.startDate) {
    const d = parseYmd(t.startDate), e = parseYmd(t.endDate || t.startDate);
    for (let n = 0; d <= e && n < 60; n++) { dates.add(ymd(d)); d.setDate(d.getDate() + 1); }
  }
  return Array.from(dates).sort();
}

function dayLabel(date) {
  const t = S.trip;
  const dayNo = t.startDate ? daysBetween(t.startDate, date) + 1 : 0;
  return (dayNo >= 1 ? '<span class="day-no">' + dayNo + '日目</span>' : '') + '<span class="day-date">' + fmtDate(date) + '</span>';
}

function scheduleHtml() {
  const today = todayStr();
  const items = S.items.filter(i => i.type === 'schedule');
  const byDate = {};
  items.forEach(i => { (byDate[i.date || ''] = byDate[i.date || ''] || []).push(i); });
  const dates = tripDates(items);
  if (!dates.length && !byDate['']) return hint('🗓️', '出発日を設定するか、「＋」から予定を追加しましょう');
  let h = '';
  dates.forEach(date => {
    const list = (byDate[date] || []).sort(byTime);
    const isToday = date === today;
    h += '<section class="day' + (isToday ? ' today" id="today' : '') + '">' +
      '<div class="day-head">' + dayLabel(date) + (isToday ? '<span class="pill today">今日</span>' : '') +
      '<span class="spacer"></span><button class="mini" data-act="add" data-date="' + date + '" aria-label="この日に予定を追加">＋</button></div>' +
      '<div class="card day-card">' +
      (list.length ? '<ol class="tl">' + list.map(scheduleItem).join('') + '</ol>' : '<div class="day-empty">予定なし</div>') +
      '</div></section>';
  });
  if (byDate['']) {
    h += '<section class="day"><div class="day-head"><span class="day-date">日付未定</span></div>' +
      '<div class="card day-card"><ol class="tl">' + byDate[''].sort(byTime).map(scheduleItem).join('') + '</ol></div></section>';
  }
  return h;
}

function scheduleItem(i) {
  const url = safeUrl(i.url);
  const links = [];
  if (i.place) {
    links.push('<a href="' + esc(mapSearchUrl(i.place)) + '" target="_blank" rel="noopener">📍 ' + esc(i.place) + '</a>');
    links.push('<a href="' + esc(routeUrl(i.place)) + '" target="_blank" rel="noopener">🚃 行き方</a>');
  }
  if (url) links.push('<a href="' + esc(url) + '" target="_blank" rel="noopener">🔗 リンク</a>');
  return '<li class="tl-item" data-act="edit" data-id="' + esc(i.id) + '">' +
    '<div class="tl-time' + (i.time ? '' : ' none') + '">' + (i.time ? esc(i.time) : '—') + '</div>' +
    '<div class="tl-body"><div class="tl-title">' + esc(i.title) + '</div>' +
    (i.memo ? '<div class="tl-memo">' + esc(i.memo) + '</div>' : '') +
    (links.length ? '<div class="tl-links">' + links.join('') + '</div>' : '') +
    '</div></li>';
}

function photosHtml(ids) {
  ids = (ids || []).slice(0, 4);
  if (!ids.length) return '';
  return '<div class="photos n' + ids.length + '">' + ids.map(id => {
    const p = S.photos.get(id);
    if (p && p.blob) {
      return '<div class="ph"><img src="' + photoUrl(p) + '" alt="" loading="lazy">' +
        (p.uploaded ? '' : '<span class="ph-badge">未送信</span>') + '</div>';
    }
    return '<div class="ph"><button class="ph-missing" data-act="fetch-photo" data-pid="' + esc(id) + '">📷<br>タップで読み込む</button></div>';
  }).join('') + '</div>';
}

function logHtml() {
  const items = S.items.filter(i => i.type === 'log');
  if (!items.length) return hint('📷', '写真やひとことで、旅の今を残しましょう。<br>電波がなくても保存でき、つながったときに送られます。');
  const byDate = {};
  items.forEach(i => { (byDate[i.date || ''] = byDate[i.date || ''] || []).push(i); });
  const dates = Object.keys(byDate).sort().reverse();
  let h = '';
  dates.forEach(date => {
    const list = byDate[date].sort(byTime).reverse();
    h += '<div class="day-head">' + (date ? dayLabel(date) : '<span class="day-date">日付なし</span>') + '</div>';
    h += list.map(i => '<article class="card log" data-act="edit" data-id="' + esc(i.id) + '">' +
      '<div class="log-meta">' + (i.time ? '<span>' + esc(i.time) + '</span>' : '') +
      (i.lat ? '<a href="' + esc(mapSearchUrl(i.lat + ',' + i.lng)) + '" target="_blank" rel="noopener">📍地図</a>' : '') + '</div>' +
      photosHtml(i.photoIds) +
      (i.memo ? '<div class="log-text">' + esc(i.memo) + '</div>' : '') +
      '<div>' + (i.city ? '<span class="tag">' + esc((i.pref || '') + i.city) + '</span>' : '') +
      (i.spot ? '<span class="tag spot">' + esc(i.spot) + '</span>' : '') + '</div>' +
      '</article>').join('');
  });
  return h;
}

function expenseHtml() {
  const items = S.items.filter(i => i.type === 'expense');
  if (!items.length) return hint('💴', '使ったお金を「＋」から記録しましょう。<br>交通費は出発地・到着地も残せます。');
  const byCur = {};
  items.forEach(i => {
    const c = (i.currency || 'JPY').toUpperCase();
    const o = byCur[c] = byCur[c] || { total: 0, transport: 0, cats: {}, cities: {} };
    const n = Number(i.amount) || 0;
    const cat = i.category || 'その他';
    o.total += n;
    if (cat === '交通') o.transport += n;
    o.cats[cat] = (o.cats[cat] || 0) + n;
    if (i.city) o.cities[i.city] = (o.cities[i.city] || 0) + n;
  });
  const multi = Object.keys(byCur).length > 1;
  let h = '';
  Object.keys(byCur).forEach(c => {
    const o = byCur[c];
    const bars = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, n]) => {
      const w = o.total > 0 ? Math.min(100, Math.max(2, Math.round(n / o.total * 100))) : 0;
      return '<div class="cat-row"><span>' + (CAT_ICON[k] ? CAT_ICON[k] + ' ' : '') + esc(k) + '</span>' +
        '<span class="cat-bar"><i style="width:' + w + '%"></i></span><span class="cat-amt">' + esc(money(n, c)) + '</span></div>';
    }).join('');
    h += '<div class="card sum"><div class="sum-total"><span>合計' + (multi || c !== 'JPY' ? '（' + esc(c) + '）' : '') + '</span>' +
      '<strong>' + esc(money(o.total, c)) + '</strong></div>' +
      '<div class="split"><div>🚃 交通費<b>' + esc(money(o.transport, c)) + '</b></div>' +
      '<div>🍽️ それ以外<b>' + esc(money(o.total - o.transport, c)) + '</b></div></div>' +
      bars(o.cats) +
      (Object.keys(o.cities).length ? '<h3 class="sec" style="margin:14px 0 6px">市町村別</h3>' + bars(o.cities) : '') +
      '</div>';
  });
  const sorted = items.slice().sort((a, b) => cmp(b.date, a.date) || cmp(b.createdAt, a.createdAt));
  const groups = new Map();
  sorted.forEach(i => {
    const k = i.date || '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  });
  groups.forEach((list, date) => {
    h += '<div class="group"><h3>' + (date ? esc(fmtDate(date)) : '日付なし') + '</h3><div class="card">' + list.map(i => {
      const route = i.category === '交通' && (i.from || i.to) ? (i.from || '?') + ' → ' + (i.to || '?') : '';
      return '<div class="ex-item" data-act="edit" data-id="' + esc(i.id) + '">' +
        '<span class="ex-ico">' + (CAT_ICON[i.category] || '💡') + '</span>' +
        '<div class="ex-main"><div class="ex-title">' + esc(i.title) + '</div>' +
        '<div class="ex-sub">' + esc([i.category || 'その他', route, i.city, i.memo].filter(Boolean).join('・')) + '</div></div>' +
        '<span class="ex-amt">' + esc(money(i.amount, i.currency)) + '</span></div>';
    }).join('') + '</div></div>';
  });
  return h;
}

const isDone = i => i.done === 1 || i.done === '1' || i.done === true;

function packingHtml() {
  const items = S.items.filter(i => i.type === 'packing');
  if (!items.length) {
    return hint('🎒', '持ち物リストはまだ空です') +
      '<button class="btn primary" data-act="template">定番の持ち物リストを追加</button>';
  }
  const done = items.filter(isDone).length;
  const pct = Math.round(done / items.length * 100);
  let h = '<div class="card progress"><div class="row"><span>準備 ' + done + ' / ' + items.length + '</span>' +
    (done === items.length ? '<span class="pill ok">準備完了！</span>' : '<span class="pill">' + pct + '%</span>') + '</div>' +
    '<div class="bar-bg"><div class="bar-fg" style="width:' + pct + '%"></div></div></div>';
  const groups = new Map();
  items.slice().sort((a, b) => cmp(a.createdAt, b.createdAt)).forEach(i => {
    const c = i.category || '未分類';
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(i);
  });
  groups.forEach((list, cat) => {
    h += '<div class="group"><h3>' + esc(cat) + '</h3><div class="card">' + list.map(i =>
      '<div class="check' + (isDone(i) ? ' done' : '') + '">' +
      '<button class="cb" data-act="toggle" data-id="' + esc(i.id) + '" aria-label="' + esc(i.title) + 'をチェック" aria-pressed="' + isDone(i) + '"><i>✓</i></button>' +
      '<div class="ck-body" data-act="edit" data-id="' + esc(i.id) + '"><div class="ck-title">' + esc(i.title) + '</div>' +
      (i.memo ? '<div class="ck-memo">' + esc(i.memo) + '</div>' : '') + '</div></div>').join('') + '</div></div>';
  });
  h += '<button class="btn" data-act="template">定番の持ち物を追加</button>';
  if (done) h += '<button class="btn" data-act="uncheck-all">チェックをすべて外す</button>';
  return h;
}

function noteHtml() {
  const items = S.items.filter(i => i.type === 'note').sort((a, b) => cmp(a.createdAt, b.createdAt));
  if (!items.length) return hint('📝', '予約番号・宿の住所・緊急連絡先など<br>旅先で見たい情報をメモしておきましょう');
  return '<div class="list">' + items.map(i => {
    const url = safeUrl(i.url);
    return '<div class="card note" data-act="edit" data-id="' + esc(i.id) + '">' +
      '<div class="note-title">' + esc(i.title) + '</div>' +
      (i.memo ? '<div class="note-body">' + esc(i.memo) + '</div>' : '') +
      (url ? '<div class="tl-links"><a href="' + esc(url) + '" target="_blank" rel="noopener">🔗 ' + esc(url) + '</a></div>' : '') +
      '</div>';
  }).join('') + '</div>';
}

/* ---------- 設定 ---------- */

let settingsCache = { apiUrl: '', apiKey: '' };
let persistState = '確認中';

function settingsHtml() {
  const s = S.sync;
  return '<header class="topbar"><button class="icon-btn" data-act="home" aria-label="戻る">‹</button>' +
    '<div class="tb-title">設定</div><span style="width:44px"></span></header><main class="wrap">' +
    '<section class="card set"><h2>サーバー（GAS）との同期</h2>' +
    '<p>設定すると、記録や写真がGoogleドライブに保存され、スマホとPCで同じデータを使えます。設定しなくても、この端末の中だけで使えます。</p>' +
    '<form id="server-form" class="fields">' +
    '<div class="f"><label class="f-label" for="s-url">GASのURL（ウェブアプリのURL）</label>' +
    '<input id="s-url" name="apiUrl" type="url" placeholder="https://script.google.com/macros/s/…/exec" value="' + esc(settingsCache.apiUrl) + '" autocomplete="off"></div>' +
    '<div class="f"><label class="f-label" for="s-key">合言葉（APIキー）</label>' +
    '<input id="s-key" name="apiKey" type="password" placeholder="GASの setup で表示された合言葉" value="' + esc(settingsCache.apiKey) + '" autocomplete="off"></div>' +
    '<div class="f btn-row"><button class="btn primary" type="submit">保存して接続テスト</button></div></form>' +
    '<dl class="kv" style="margin-top:12px"><dt>状態</dt><dd>' + esc(s.configured ? (s.error ? 'エラー：' + s.error : '設定済み') : '未設定（端末のみ）') + '</dd>' +
    '<dt>未送信</dt><dd>' + s.pending + '件</dd>' +
    '<dt>最終同期</dt><dd>' + esc(s.lastSync ? new Date(s.lastSync).toLocaleString('ja-JP') : '—') + '</dd></dl>' +
    '<button class="btn" data-act="sync-now"' + (s.configured ? '' : ' disabled') + '>今すぐ同期</button></section>' +

    '<section class="card set"><h2>バックアップ</h2>' +
    '<p>旅行と記録の文字データを、ファイルに書き出せます（写真は含みません）。</p>' +
    '<div class="btn-row"><button class="btn" data-act="export">書き出す</button>' +
    '<button class="btn" data-act="import">読み込む</button></div>' +
    '<input type="file" id="import-file" accept="application/json,.json" hidden></section>' +

    '<section class="card set"><h2>端末の保存</h2>' +
    '<p>ホーム画面に追加して使うと、データが消されにくくなります。</p>' +
    '<dl class="kv"><dt>保存の保護</dt><dd>' + esc(persistState) + '</dd></dl></section>' +

    '<section class="card set"><h2>そぞろつづりについて</h2>' +
    '<p>「そぞろ（気の向くままに）」＋「つづり（書き綴ったもの）」。気の向くままに歩いた旅を、そっと綴っておく帳面です。</p>' +
    '<dl class="kv"><dt>バージョン</dt><dd>' + APP_VERSION + '</dd>' +
    '<dt>ソース</dt><dd><a href="https://github.com/tokageto/sozorotsuzuri" target="_blank" rel="noopener">GitHub</a></dd></dl></section>' +
    '</main>';
}

/* ================================================================== */
/* 入力フォーム                                                        */
/* ================================================================== */

function defaultsFor(type, ds) {
  const t = S.trip, today = todayStr(), now = new Date();
  const inTrip = t.startDate && today >= t.startDate && today <= (t.endDate || t.startDate);
  const last = (ty, k) => {
    const arr = S.items.filter(i => i.type === ty && i[k]).sort((a, b) => cmp(a.createdAt, b.createdAt));
    return arr.length ? arr[arr.length - 1][k] : '';
  };
  if (type === 'schedule') return { date: ds.date || (inTrip ? today : (t.startDate || '')) };
  if (type === 'log') return { date: inTrip || !t.startDate ? today : t.startDate, time: hm(now) };
  if (type === 'expense') {
    return {
      date: inTrip || !t.startDate ? today : t.startDate,
      currency: last('expense', 'currency') || 'JPY',
      city: last('log', 'city'),
    };
  }
  if (type === 'packing') return { category: last('packing', 'category') };
  return {};
}

function fieldHtml(f, data) {
  const v = data[f.k] == null ? '' : data[f.k];
  const id = 'f-' + f.k;
  const cls = 'f' + (f.half ? ' half' : '') + (f.only ? ' only-' + f.only : '');
  let input;
  if (f.type === 'textarea') {
    input = '<textarea id="' + id + '" name="' + f.k + '" rows="' + (f.rows || 4) + '" placeholder="' + esc(f.ph || '') + '">' + esc(v) + '</textarea>';
  } else if (f.type === 'chips') {
    input = '<div class="chips" role="radiogroup">' + f.options.map(o =>
      '<label class="chip"><input type="radio" name="' + f.k + '" value="' + esc(o) + '"' + (o === v ? ' checked' : '') + '>' +
      '<span>' + (CAT_ICON[o] || '') + ' ' + esc(o) + '</span></label>').join('') + '</div>';
  } else if (f.type === 'photos') {
    input = '<div class="photo-pick" id="photo-pick"></div>' +
      '<input type="file" id="photo-input" accept="image/*" multiple hidden>';
  } else if (f.type === 'geo') {
    input = '<div class="geo-row"><button type="button" class="chip-btn" data-geo>📍 現在地を付ける</button>' +
      '<span id="geo-text">' + (data.lat ? esc(Number(data.lat).toFixed(5) + ', ' + Number(data.lng).toFixed(5)) : '未設定') + '</span>' +
      (data.lat ? '<button type="button" class="chip-btn" data-geo-clear>外す</button>' : '') + '</div>' +
      '<input type="hidden" name="lat" value="' + esc(data.lat || '') + '"><input type="hidden" name="lng" value="' + esc(data.lng || '') + '">' +
      '<p class="f-help">市町村名は、サーバーと同期したときに自動で付きます。手入力もできます。</p>';
  } else {
    input = '<input id="' + id + '" name="' + f.k + '" type="' + (f.type || 'text') + '" value="' + esc(v) + '"' +
      ' placeholder="' + esc(f.ph || '') + '"' + (f.list ? ' list="' + f.list + '"' : '') +
      (f.inputmode ? ' inputmode="' + f.inputmode + '"' : '') + (f.type === 'number' ? ' step="any"' : '') +
      ' autocomplete="off">';
  }
  const label = (f.type === 'chips' || f.type === 'photos' || f.type === 'geo')
    ? '<span class="f-label">' + esc(f.label) + (f.req ? ' <em>*</em>' : '') + '</span>'
    : '<label class="f-label" for="' + id + '">' + esc(f.label) + (f.req ? ' <em>*</em>' : '') + '</label>';
  return '<div class="' + cls + '">' + label + input + '</div>';
}

function fillDatalists() {
  const packCats = new Set(S.items.filter(i => i.type === 'packing' && i.category).map(i => i.category));
  document.getElementById('dl-pack').innerHTML = Array.from(packCats).map(c => '<option value="' + esc(c) + '">').join('');
  const spots = new Set(S.items.filter(i => i.type === 'log' && i.spot).map(i => i.spot));
  document.getElementById('dl-spot').innerHTML = Array.from(spots).map(c => '<option value="' + esc(c) + '">').join('');
}

function openSheet(innerHtml) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = innerHtml;
  document.body.appendChild(ov);
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  ov.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
  return { ov, close };
}

function openForm(kind, data) {
  data = Object.assign({}, data || {});
  const def = FORMS[kind];
  const isNew = !data.id;
  fillDatalists();
  const { ov, close } = openSheet('<form class="sheet" novalidate>' +
    '<div class="sheet-head"><button type="button" class="link-btn" data-close>キャンセル</button>' +
    '<strong>' + def.title + (isNew ? 'を追加' : 'を編集') + '</strong>' +
    '<button type="submit" class="link-btn strong">保存</button></div>' +
    '<div class="fields">' + def.fields.map(f => fieldHtml(f, data)).join('') + '</div>' +
    (isNew ? '' : '<button type="button" class="btn danger" data-del>削除</button>') +
    '</form>');
  const form = ov.querySelector('form');
  const saveBtn = form.querySelector('[type=submit]');

  // 費用：カテゴリが「交通」のときだけ出発地・到着地を出す
  const updateOnly = () => {
    const cat = (form.querySelector('[name=category]:checked') || {}).value;
    form.querySelectorAll('.only-transport').forEach(el => { el.hidden = cat !== '交通'; });
  };
  form.addEventListener('change', e => { if (e.target.name === 'category') updateOnly(); });
  updateOnly();

  // 記録：写真
  const photoState = { keep: (data.photoIds || []).slice(), added: [] };
  const pick = form.querySelector('#photo-pick');
  const renderPick = () => {
    if (!pick) return;
    const keep = photoState.keep.map(id => {
      const p = S.photos.get(id);
      return '<div class="ph">' + (p && p.blob ? '<img src="' + photoUrl(p) + '" alt="">' : '<span class="ph-missing">📷</span>') +
        '<button type="button" data-rm-keep="' + esc(id) + '" aria-label="写真を外す">×</button></div>';
    });
    const added = photoState.added.map((a, n) =>
      '<div class="ph"><img src="' + a.url + '" alt=""><button type="button" data-rm-add="' + n + '" aria-label="写真を外す">×</button></div>');
    pick.innerHTML = keep.join('') + added.join('') +
      (photoState.keep.length + photoState.added.length < 8 ? '<button type="button" class="photo-add" data-add-photo>＋<br>写真</button>' : '');
  };
  if (pick) {
    renderPick();
    const input = form.querySelector('#photo-input');
    pick.addEventListener('click', e => {
      if (e.target.closest('[data-add-photo]')) input.click();
      const rk = e.target.closest('[data-rm-keep]');
      if (rk) { photoState.keep = photoState.keep.filter(id => id !== rk.dataset.rmKeep); renderPick(); }
      const ra = e.target.closest('[data-rm-add]');
      if (ra) {
        const a = photoState.added.splice(+ra.dataset.rmAdd, 1)[0];
        if (a) URL.revokeObjectURL(a.url);
        renderPick();
      }
    });
    input.addEventListener('change', () => {
      Array.from(input.files || []).slice(0, 8).forEach(file => {
        photoState.added.push({ file, url: URL.createObjectURL(file) });
      });
      input.value = '';
      renderPick();
    });
  }

  // 記録：現在地
  const geoBtn = form.querySelector('[data-geo]');
  if (geoBtn) {
    if (isNew && navigator.geolocation) setTimeout(() => getGeo(form, true), 300);
    geoBtn.addEventListener('click', () => getGeo(form, false));
    const clr = form.querySelector('[data-geo-clear]');
    if (clr) clr.addEventListener('click', () => {
      form.lat.value = ''; form.lng.value = '';
      form.querySelector('#geo-text').textContent = '未設定';
    });
  }

  if (isNew && (kind === 'packing' || kind === 'note' || kind === 'expense')) {
    setTimeout(() => { const el = form.querySelector('[name=title]'); if (el) el.focus(); }, 250);
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(form);
    const out = {};
    def.fields.forEach(f => {
      if (f.type === 'photos' || f.type === 'geo') return;
      out[f.k] = String(fd.get(f.k) || '').trim();
    });
    if (kind === 'log') {
      out.lat = String(fd.get('lat') || '');
      out.lng = String(fd.get('lng') || '');
      if (!out.memo && !photoState.keep.length && !photoState.added.length && !out.spot) {
        toast('写真かひとことを入れてください', true);
        return;
      }
    }
    const missing = def.fields.find(f => f.req && !out[f.k]);
    if (missing) {
      toast(missing.label + 'を入力してください', true);
      const el = form.querySelector('[name="' + missing.k + '"]');
      if (el && el.focus) el.focus();
      return;
    }
    if (kind === 'trip' && out.startDate && out.endDate && out.endDate < out.startDate) {
      toast('帰着日は出発日以降にしてください', true);
      return;
    }
    if (kind === 'expense') {
      if (!isFinite(Number(out.amount))) { toast('金額を数字で入力してください', true); return; }
      out.currency = (out.currency || 'JPY').toUpperCase();
      out.category = out.category || 'その他';
      if (out.category !== '交通') { out.from = ''; out.to = ''; }
    }
    saveBtn.disabled = true;
    try {
      if (kind === 'trip') {
        const t = await db.save('trips', Object.assign({ id: data.id }, out));
        close();
        afterWrite();
        if (isNew) go('#/trip/' + encodeURIComponent(t.id) + '/schedule');
        else await refresh();
      } else {
        const id = data.id || uuid();
        if (kind === 'log') {
          const newIds = [];
          for (const a of photoState.added) {
            const { blob, width, height } = await resizePhoto(a.file);
            const pid = uuid();
            await db.savePhoto({ id: pid, itemId: id, tripId: S.trip.id, blob, width, height });
            newIds.push(pid);
            URL.revokeObjectURL(a.url);
          }
          out.photoIds = photoState.keep.concat(newIds);
          // 場所が変わり、市町村が自動で付いたままなら、同期時に付け直してもらう
          const moved = out.lat && (out.lat !== String(data.lat || '') || out.lng !== String(data.lng || ''));
          if (moved && out.city === (data.city || '') && (data.geocoded === '1' || !data.city)) {
            out.city = ''; out.pref = ''; out.geocoded = '';
          }
        }
        await db.save('items', Object.assign({ id, type: kind, tripId: S.trip.id }, out));
        close();
        afterWrite();
        await refresh();
        if (isNew) toast(kind === 'log' ? '記録しました' : '追加しました');
      }
    } catch (err) {
      console.error(err);
      toast('保存できませんでした：' + (err.message || err), true);
      saveBtn.disabled = false;
    }
  });

  const del = form.querySelector('[data-del]');
  if (del) {
    del.addEventListener('click', async () => {
      if (!del.classList.contains('armed')) {
        del.classList.add('armed');
        del.textContent = kind === 'trip' ? 'もう一度押すと、この旅行の記録をすべて削除します' : 'もう一度押すと削除します';
        return;
      }
      del.disabled = true;
      try {
        if (kind === 'trip') {
          await db.deleteTrip(data.id);
          close(); afterWrite(); go('#/');
        } else {
          await db.remove('items', data.id);
          close(); afterWrite(); await refresh();
        }
        toast('削除しました');
      } catch (err) {
        toast('削除できませんでした', true);
        del.disabled = false;
      }
    });
  }
}

function getGeo(form, quiet) {
  const text = form.querySelector('#geo-text');
  if (!navigator.geolocation) { if (!quiet) toast('この端末では現在地を取得できません', true); return; }
  text.textContent = '現在地を取得中…';
  navigator.geolocation.getCurrentPosition(pos => {
    if (!form.isConnected) return;
    form.lat.value = pos.coords.latitude.toFixed(6);
    form.lng.value = pos.coords.longitude.toFixed(6);
    text.textContent = pos.coords.latitude.toFixed(5) + ', ' + pos.coords.longitude.toFixed(5) +
      '（誤差 約' + Math.round(pos.coords.accuracy) + 'm）';
  }, err => {
    if (!form.isConnected) return;
    text.textContent = form.lat.value ? text.textContent : '未設定';
    if (!quiet) toast(err.code === 1 ? '位置情報の利用が許可されていません' : '現在地を取得できませんでした', true);
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
}

/* ---------- ハイライト画像 ---------- */

async function openHighlight() {
  const logs = S.items.filter(i => i.type === 'log').sort((a, b) => cmp(a.date, b.date) || byTime(a, b));
  const expenses = S.items.filter(i => i.type === 'expense');
  const photoBlobs = [];
  for (const l of logs) for (const id of l.photoIds || []) {
    const p = S.photos.get(id);
    if (p && p.blob) photoBlobs.push(p.blob);
  }
  // 写真が多いときは、旅の流れが伝わるよう均等に4枚選ぶ
  const chosen = photoBlobs.length <= 4 ? photoBlobs
    : [0, 1, 2, 3].map(n => photoBlobs[Math.round(n * (photoBlobs.length - 1) / 3)]);
  const cities = new Set(logs.map(l => l.city).filter(Boolean));
  const jpy = expenses.filter(e => (e.currency || 'JPY') === 'JPY').reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const stats = [{ label: '記録', value: logs.length + '件' }];
  if (cities.size) stats.push({ label: '訪れた市町村', value: cities.size });
  if (jpy) stats.push({ label: '旅の費用', value: money(jpy, 'JPY') });

  const { ov, close } = openSheet('<div class="sheet">' +
    '<div class="sheet-head"><button type="button" class="link-btn" data-close>閉じる</button><strong>ハイライト画像</strong><span style="min-width:72px"></span></div>' +
    '<div class="fields"><div class="f"><label class="f-label" for="hl-comment">ひとこと（画像に入ります）</label>' +
    '<input id="hl-comment" maxlength="60" placeholder="例：潮風とぬれ煎餅の一日" autocomplete="off"></div></div>' +
    '<p class="f-help">写真は記録から最大4枚を自動で選びます（' + photoBlobs.length + '枚中）。</p>' +
    '<div style="margin-top:12px"><img class="preview-img" id="hl-img" alt="ハイライト画像のプレビュー"></div>' +
    '<div class="btn-row"><button class="btn primary" data-hl-share>共有する</button><button class="btn" data-hl-save>保存する</button></div>' +
    '</div>');
  const img = ov.querySelector('#hl-img');
  let blob = null, url = '';
  const build = async () => {
    blob = await makeHighlight(S.trip, chosen, { comment: ov.querySelector('#hl-comment').value.trim(), stats });
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(blob);
    img.src = url;
  };
  await build();
  ov.querySelector('#hl-comment').addEventListener('input', debounce(build, 400));
  const filename = 'sozorotsuzuri-' + (S.trip.startDate || todayStr()) + '.png';
  ov.querySelector('[data-hl-save]').addEventListener('click', () => downloadBlob(blob, filename));
  ov.querySelector('[data-hl-share]').addEventListener('click', async () => {
    const file = new File([blob], filename, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: S.trip.title, text: S.trip.title + ' #そぞろつづり' }); } catch (e) { /* キャンセル */ }
    } else {
      downloadBlob(blob, filename);
      toast('共有に対応していないため、画像を保存しました');
    }
  });
  ov.querySelector('[data-close]').addEventListener('click', () => { if (url) URL.revokeObjectURL(url); });
  void close;
}

/* ================================================================== */
/* 操作                                                                */
/* ================================================================== */

const scheduleSync = debounce(() => { sync.syncNow().catch(() => {}); }, 1500);
let persistAsked = false;

function afterWrite() {
  sync.refreshStatus();
  scheduleSync();
  if (!persistAsked && navigator.storage && navigator.storage.persist) {
    persistAsked = true;
    navigator.storage.persist().then(updatePersistState).catch(() => {});
  }
}

async function updatePersistState() {
  try {
    if (navigator.storage && navigator.storage.persisted) {
      persistState = (await navigator.storage.persisted()) ? '保護されています' : '保護されていません（ホーム画面への追加がおすすめ）';
    } else persistState = 'この端末では確認できません';
  } catch (e) { persistState = '確認できません'; }
  if (S.view === 'settings') render();
}

async function toggleDone(id) {
  const it = S.items.find(i => i.id === id);
  if (!it) return;
  await db.save('items', { id, done: isDone(it) ? 0 : 1 });
  afterWrite();
  await refresh();
}

async function uncheckAll() {
  for (const i of S.items.filter(x => x.type === 'packing' && isDone(x))) await db.save('items', { id: i.id, done: 0 });
  afterWrite();
  await refresh();
}

async function addTemplate() {
  const existing = new Set(S.items.filter(i => i.type === 'packing').map(i => i.title));
  let n = 0;
  for (const [category, titles] of PACKING_TEMPLATE) {
    for (const title of titles) {
      if (existing.has(title)) continue;
      await db.save('items', { type: 'packing', tripId: S.trip.id, title, category, done: 0 });
      n++;
    }
  }
  afterWrite();
  await refresh();
  toast(n ? n + '件追加しました' : 'すべて追加済みです');
}

async function fetchPhotoById(pid) {
  if (!(await sync.isConfigured())) { toast('この写真はサーバーにあります。設定でサーバーを登録してください', true); return; }
  try {
    toast('写真を読み込み中…');
    await sync.fetchPhoto(pid);
    await refresh();
  } catch (e) {
    toast('写真を読み込めませんでした：' + e.message, true);
  }
}

async function doSync() {
  if (!(await sync.isConfigured())) { go('#/settings'); return; }
  if (!navigator.onLine) { toast('オフラインです。電波が戻ったら自動で送ります'); return; }
  try {
    const r = await sync.syncNow();
    toast(r && r.changed ? '同期しました（' + r.changed + '件更新）' : '同期しました');
  } catch (e) {
    toast('同期できませんでした：' + e.message, true);
  }
}

async function seedDemo() {
  const t = await db.save('trips', {
    title: '銚子 ぬれ煎餅さんぽ（見本）', destination: '銚子', startDate: '2026-10-17', endDate: '2026-10-18',
    memo: 'これは見本の旅です。自由に編集・削除してください。',
  });
  const add = o => db.save('items', Object.assign({ tripId: t.id }, o));
  await add({ type: 'schedule', date: '2026-10-17', time: '09:10', title: '特急で銚子へ', place: '銚子駅', memo: '座席：5号車' });
  await add({ type: 'schedule', date: '2026-10-17', time: '11:30', title: '銚子電鉄で犬吠へ', place: '犬吠駅' });
  await add({ type: 'schedule', date: '2026-10-17', time: '13:00', title: '犬吠埼灯台', place: '犬吠埼灯台' });
  await add({ type: 'schedule', date: '2026-10-17', time: '18:00', title: '宿にチェックイン', place: '犬吠埼' });
  await add({ type: 'schedule', date: '2026-10-18', time: '10:00', title: '外川の町並みを散歩', place: '外川駅' });
  await add({ type: 'log', date: '2026-10-17', time: '11:52', memo: '車窓から海がちらっと見えた。ゆっくり走るのがいい。', spot: '銚子電鉄', pref: '千葉県', city: '銚子市', lat: '35.7083', lng: '140.8497', geocoded: '1', photoIds: [] });
  await add({ type: 'log', date: '2026-10-17', time: '13:20', memo: '灯台の上は風が強い。水平線が少し丸く見える。', spot: '犬吠埼灯台', pref: '千葉県', city: '銚子市', lat: '35.7075', lng: '140.8686', geocoded: '1', photoIds: [] });
  await add({ type: 'log', date: '2026-10-18', time: '10:40', memo: '外川の坂道。猫が2匹。', spot: '外川の町並み', pref: '千葉県', city: '銚子市', lat: '35.6972', lng: '140.8557', geocoded: '1', photoIds: [] });
  await add({ type: 'expense', date: '2026-10-17', title: '特急券・乗車券', amount: '4000', currency: 'JPY', category: '交通', from: '東京', to: '銚子', city: '銚子市', memo: '見本の金額' });
  await add({ type: 'expense', date: '2026-10-17', title: '銚子電鉄 乗車券', amount: '700', currency: 'JPY', category: '交通', from: '銚子', to: '犬吠', city: '銚子市', memo: '見本の金額' });
  await add({ type: 'expense', date: '2026-10-17', title: 'ぬれ煎餅', amount: '1200', currency: 'JPY', category: '買い物', city: '銚子市' });
  await add({ type: 'expense', date: '2026-10-17', title: '海鮮丼', amount: '1800', currency: 'JPY', category: '食事', city: '銚子市' });
  await add({ type: 'expense', date: '2026-10-17', title: '宿泊', amount: '12000', currency: 'JPY', category: '宿泊', city: '銚子市' });
  await add({ type: 'expense', date: '2026-10-17', title: '灯台の入場料', amount: '300', currency: 'JPY', category: '観光', city: '銚子市', memo: '見本の金額' });
  await add({ type: 'note', title: '宿の情報（見本）', memo: '〇〇旅館\n予約番号 ABC-1234\nチェックイン 15:00〜' });
  for (const [category, titles] of PACKING_TEMPLATE.slice(0, 2)) {
    for (const title of titles) await add({ type: 'packing', title, category, done: category === '貴重品' ? 1 : 0 });
  }
  afterWrite();
  go('#/trip/' + encodeURIComponent(t.id) + '/schedule');
}

async function exportData() {
  const data = await db.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  downloadBlob(blob, 'sozorotsuzuri-backup-' + todayStr() + '.json');
}

async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    const r = await db.importAll(data);
    afterWrite();
    toast('読み込みました（旅行' + r.trips + '件・記録など' + r.items + '件）');
  } catch (e) {
    toast('読み込めませんでした：' + e.message, true);
  }
}

/* ---------- クリック操作（まとめて受け取る） ---------- */

document.addEventListener('click', e => {
  if (e.target.closest('a') || e.target.closest('.overlay')) return;
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const id = el.dataset.id;
  switch (el.dataset.act) {
    case 'new-trip': openForm('trip', {}); break;
    case 'open-trip': go('#/trip/' + encodeURIComponent(id) + '/schedule'); break;
    case 'home': go('#/'); break;
    case 'settings': go('#/settings'); break;
    case 'edit-trip': openForm('trip', S.trip); break;
    case 'tab':
      history.replaceState(null, '', '#/trip/' + encodeURIComponent(S.trip.id) + '/' + el.dataset.tab);
      S.tab = el.dataset.tab;
      render(); window.scrollTo(0, 0);
      if (S.tab === 'schedule') scrollToToday();
      break;
    case 'add': openForm(S.tab, defaultsFor(S.tab, el.dataset)); break;
    case 'edit': {
      const it = S.items.find(i => i.id === id);
      if (it) openForm(it.type, it);
      break;
    }
    case 'toggle': toggleDone(id); break;
    case 'template': addTemplate(); break;
    case 'uncheck-all': uncheckAll(); break;
    case 'highlight': openHighlight(); break;
    case 'fetch-photo': fetchPhotoById(el.dataset.pid); break;
    case 'sync': doSync(); break;
    case 'sync-now': doSync(); break;
    case 'seed': seedDemo(); break;
    case 'export': exportData(); break;
    case 'import': document.getElementById('import-file').click(); break;
  }
});

document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role=button][data-act]')) {
    e.preventDefault();
    e.target.click();
  }
});

document.addEventListener('change', e => {
  if (e.target.id === 'import-file' && e.target.files[0]) {
    importData(e.target.files[0]);
    e.target.value = '';
  }
});

document.addEventListener('submit', async e => {
  if (e.target.id !== 'server-form') return;
  e.preventDefault();
  const fd = new FormData(e.target);
  const apiUrl = String(fd.get('apiUrl') || '').trim();
  const apiKey = String(fd.get('apiKey') || '').trim();
  if (apiUrl && !/^https:\/\/script\.google(usercontent)?\.com\//.test(apiUrl)) {
    toast('GASのウェブアプリのURL（https://script.google.com/…）を入力してください', true);
    return;
  }
  await db.setMeta('apiUrl', apiUrl);
  await db.setMeta('apiKey', apiKey);
  settingsCache = { apiUrl, apiKey };
  if (!apiUrl || !apiKey) { await sync.refreshStatus(); toast('サーバーの設定を外しました'); return; }
  try {
    toast('接続テスト中…');
    await sync.ping();
    await sync.refreshStatus();
    toast('接続できました。同期します');
    await doSync();
  } catch (err) {
    toast('接続できませんでした：' + err.message, true);
    await sync.refreshStatus();
  }
});

/* ================================================================== */
/* 起動                                                                */
/* ================================================================== */

sync.onStatus(s => {
  const changed = s.changed;
  S.sync = s;
  if (changed && S.view !== 'settings' && !document.querySelector('.overlay')) refresh();
  else if (!document.querySelector('.overlay')) {
    // 状態表示だけ差し替える（入力中の画面を描き直さない）
    const chip = document.querySelector('.sync-chip');
    if (chip && S.view !== 'settings') chip.outerHTML = syncChip();
    else if (S.view === 'settings') render();
  }
});

window.addEventListener('hashchange', route);
window.addEventListener('online', () => { sync.refreshStatus(); sync.syncNow().catch(() => {}); });
window.addEventListener('offline', () => sync.refreshStatus());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') sync.syncNow().catch(() => {});
});

async function start() {
  settingsCache = await sync.getSettings();
  await sync.refreshStatus();
  updatePersistState();
  // 旅行中の旅が1つだけあり、最初に開いたのが一覧なら、そのまま開く
  if (!location.hash || location.hash === '#/' || location.hash === '#') {
    const trips = await db.listTrips();
    const ongoing = trips.filter(t => tripStatus(t).kind === 'ongoing');
    if (ongoing.length === 1) history.replaceState(null, '', '#/trip/' + encodeURIComponent(ongoing[0].id) + '/log');
  }
  await route();
  sync.syncNow().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('service worker', err));
  }
}

start().catch(err => {
  console.error(err);
  app.innerHTML = '<div class="splash">起動できませんでした。<br><small>' + esc(err.message || err) + '</small></div>';
});
