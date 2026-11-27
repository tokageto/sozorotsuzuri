// ハイライト画像（X などに投稿する1枚画像）を作る
// 縦 1080x1350（4:5）。写真最大4枚＋旅のタイトル・期間・ひとこと・集計
// どの項目を入れるかは opts.show で選ぶ（個人の特定につながる項目は、呼び出し側で既定オフにする）

import { fmtRange, daysBetween } from './util.js';

/** 日付の出し方：none=出さない / nights=日数だけ / month=年月まで / full=日付まで */
export function dateText(trip, mode) {
  if (!trip.startDate || mode === 'none') return '';
  const end = trip.endDate || trip.startDate;
  const n = daysBetween(trip.startDate, end);
  const len = n > 0 ? n + '泊' + (n + 1) + '日' : '日帰り';
  if (mode === 'nights') return len;
  if (mode === 'month') {
    const [y1, m1] = trip.startDate.split('-').map(Number);
    const [y2, m2] = end.split('-').map(Number);
    let ym = y1 + '年' + m1 + '月';
    if (y1 !== y2) ym += '〜' + y2 + '年' + m2 + '月';
    else if (m1 !== m2) ym += '〜' + m2 + '月';
    return ym + '（' + len + '）';
  }
  return fmtRange(trip);
}

const W = 1080, H = 1350;

function loadBitmap(blob) {
  if (window.createImageBitmap) return createImageBitmap(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}

/** 画像を枠いっぱいに切り抜いて描く（object-fit: cover と同じ） */
function drawCover(ctx, img, x, y, w, h, r) {
  const s = Math.max(w / img.width, h / img.height);
  const sw = w / s, sh = h / s;
  const sx = (img.width - sw) / 2, sy = (img.height - sh) / 2;
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, maxWidth, maxLines) {
  const lines = [];
  let line = '';
  for (const ch of String(text || '')) {
    if (ch === '\n') { lines.push(line); line = ''; continue; }
    if (ctx.measureText(line + ch).width > maxWidth) { lines.push(line); line = ch; } else line += ch;
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && ctx.measureText(lines[maxLines - 1]).width > maxWidth - 30) {
    lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…';
  }
  return lines;
}

/**
 * @param {object} trip 旅行
 * @param {Blob[]} photos 写真（最大4枚使う）
 * @param {object} opts { comment, stats: [{label, value}], show: { title, destination, date } }
 * @returns {Promise<Blob>} PNG画像
 */
export async function makeHighlight(trip, photos, opts = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const show = Object.assign({ title: true, destination: true, date: 'nights' }, opts.show || {});
  const font = '"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif';
  const sans = '"Hiragino Sans","Noto Sans JP","Yu Gothic",sans-serif';

  // 背景（生成り色の紙）
  ctx.fillStyle = '#f4efe4';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#d9cfbb';
  ctx.lineWidth = 2;
  ctx.strokeRect(36, 36, W - 72, H - 72);

  // 写真
  const pad = 72, gap = 16;
  const areaX = pad, areaY = 96, areaW = W - pad * 2, areaH = 760;
  const bitmaps = [];
  for (const b of photos.slice(0, 4)) {
    try { bitmaps.push(await loadBitmap(b)); } catch (e) { /* 読めない写真は飛ばす */ }
  }
  const n = bitmaps.length;
  if (n === 0) {
    ctx.fillStyle = '#e6dcc8';
    roundRect(ctx, areaX, areaY, areaW, areaH, 24);
    ctx.fill();
    ctx.fillStyle = '#9a8f78';
    ctx.font = '600 44px ' + sans;
    ctx.textAlign = 'center';
    ctx.fillText('写真のない旅も、いい旅。', W / 2, areaY + areaH / 2);
  } else if (n === 1) {
    drawCover(ctx, bitmaps[0], areaX, areaY, areaW, areaH, 24);
  } else if (n === 2) {
    const w = (areaW - gap) / 2;
    drawCover(ctx, bitmaps[0], areaX, areaY, w, areaH, 24);
    drawCover(ctx, bitmaps[1], areaX + w + gap, areaY, w, areaH, 24);
  } else if (n === 3) {
    const w = (areaW - gap) / 2, h = (areaH - gap) / 2;
    drawCover(ctx, bitmaps[0], areaX, areaY, w, areaH, 24);
    drawCover(ctx, bitmaps[1], areaX + w + gap, areaY, w, h, 24);
    drawCover(ctx, bitmaps[2], areaX + w + gap, areaY + h + gap, w, h, 24);
  } else {
    const w = (areaW - gap) / 2, h = (areaH - gap) / 2;
    drawCover(ctx, bitmaps[0], areaX, areaY, w, h, 24);
    drawCover(ctx, bitmaps[1], areaX + w + gap, areaY, w, h, 24);
    drawCover(ctx, bitmaps[2], areaX, areaY + h + gap, w, h, 24);
    drawCover(ctx, bitmaps[3], areaX + w + gap, areaY + h + gap, w, h, 24);
  }

  // 文字
  ctx.textAlign = 'left';
  let y = areaY + areaH + 92;
  ctx.fillStyle = '#2b2620';
  ctx.font = '700 64px ' + font;
  if (show.title && trip.title) {
    wrapText(ctx, trip.title, areaW, 1).forEach(l => { ctx.fillText(l, pad, y); y += 72; });
  }

  const sub = [show.destination && trip.destination ? '📍 ' + trip.destination : '', dateText(trip, show.date)]
    .filter(Boolean).join('　');
  if (sub) {
    ctx.fillStyle = '#6b6152';
    ctx.font = '500 32px ' + sans;
    ctx.fillText(sub, pad, y);
    y += 60;
  }

  if (opts.comment) {
    ctx.fillStyle = '#3d362c';
    ctx.font = '500 36px ' + font;
    wrapText(ctx, opts.comment, areaW, 2).forEach(l => { ctx.fillText(l, pad, y); y += 50; });
  }

  // 集計（下部）
  const stats = (opts.stats || []).slice(0, 3);
  if (stats.length) {
    const sy = H - 150;
    const sw = areaW / stats.length;
    stats.forEach((s, i) => {
      const x = pad + sw * i;
      ctx.fillStyle = '#0f766e';
      ctx.font = '700 44px ' + sans;
      ctx.fillText(String(s.value), x, sy);
      ctx.fillStyle = '#7a705f';
      ctx.font = '500 26px ' + sans;
      ctx.fillText(s.label, x, sy + 40);
    });
  }

  // アプリ名
  ctx.fillStyle = '#a3977f';
  ctx.font = '500 24px ' + font;
  ctx.textAlign = 'right';
  ctx.fillText('そぞろつづり', W - pad, H - 60);

  return new Promise(res => canvas.toBlob(res, 'image/png'));
}
