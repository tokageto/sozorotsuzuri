// 写真の縮小と表示用URLの管理

const MAX_SIDE = 1600;   // 長辺の最大ピクセル数（要件定義 4. 非機能要件）
const QUALITY = 0.82;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした')); };
    img.src = url;
  });
}

/** 写真を長辺1600pxのJPEGに縮小する。向き（EXIF）はブラウザが自動で補正する */
export async function resizePhoto(file, maxSide = MAX_SIDE) {
  let source;
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    source = await loadImage(file);
  }
  const w = source.width, h = source.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.round(w * scale), ch = Math.round(h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  canvas.getContext('2d').drawImage(source, 0, 0, cw, ch);
  if (source.close) source.close();
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', QUALITY));
  return { blob, width: cw, height: ch };
}

/* 表示用の一時URL（画面を描き直すたびに作り直さないようにキャッシュする） */
const urls = new Map();
export function photoUrl(photo) {
  if (!photo || !photo.blob) return '';
  let u = urls.get(photo.id);
  if (!u) {
    u = URL.createObjectURL(photo.blob);
    urls.set(photo.id, u);
  }
  return u;
}

export function forgetPhotoUrl(id) {
  const u = urls.get(id);
  if (u) { URL.revokeObjectURL(u); urls.delete(id); }
}
