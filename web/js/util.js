// 共通ユーティリティ

export const OWNER_ID = 'me';

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const nowIso = () => new Date().toISOString();

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const pad = n => String(n).padStart(2, '0');
export const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export const hm = d => pad(d.getHours()) + ':' + pad(d.getMinutes());
export const todayStr = () => ymd(new Date());

export function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

const WD = '日月火水木金土';
export function fmtDate(s, withYear) {
  const d = parseYmd(s);
  if (!d) return '';
  return (withYear ? d.getFullYear() + '/' : '') + (d.getMonth() + 1) + '/' + d.getDate() + '(' + WD[d.getDay()] + ')';
}

export const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
export const cmp = (a, b) => String(a || '').localeCompare(String(b || ''));

export function tripStatus(t) {
  const today = todayStr();
  if (!t.startDate) return { kind: 'upcoming', label: '日程未定' };
  const end = t.endDate || t.startDate;
  if (today < t.startDate) {
    const n = daysBetween(today, t.startDate);
    return { kind: 'upcoming', label: n === 1 ? '明日出発' : 'あと' + n + '日' };
  }
  if (today <= end) return { kind: 'ongoing', label: '旅行中・' + (daysBetween(t.startDate, today) + 1) + '日目' };
  return { kind: 'past', label: '思い出' };
}

export function fmtRange(t) {
  if (!t.startDate) return '日程未定';
  const s = fmtDate(t.startDate, true);
  if (!t.endDate || t.endDate === t.startDate) return s + '（日帰り）';
  const n = daysBetween(t.startDate, t.endDate);
  const sameYear = t.endDate.slice(0, 4) === t.startDate.slice(0, 4);
  return s + ' 〜 ' + fmtDate(t.endDate, !sameYear) + '（' + n + '泊' + (n + 1) + '日）';
}

export function money(amount, cur) {
  cur = (cur || 'JPY').toUpperCase();
  const n = Number(amount) || 0;
  try {
    return new Intl.NumberFormat('ja-JP', {
      style: 'currency', currency: cur,
      maximumFractionDigits: cur === 'JPY' || cur === 'KRW' ? 0 : 2,
    }).format(n);
  } catch (e) {
    return n.toLocaleString('ja-JP') + ' ' + cur;
  }
}

export const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : '');
export const mapSearchUrl = q => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);

/** Googleマップの経路検索（公共交通）。origin を省略すると現在地から */
export function routeUrl(destination, origin) {
  const p = new URLSearchParams({ api: '1', destination, travelmode: 'transit' });
  if (origin) p.set('origin', origin);
  return 'https://www.google.com/maps/dir/?' + p.toString();
}

let toastTimer = null;
export function toast(msg, isErr) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.toggle('err', !!isErr);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), isErr ? 4500 : 2200);
}

export function debounce(fn, ms) {
  let t = null;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function base64ToBlob(b64, mime) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime || 'image/jpeg' });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
