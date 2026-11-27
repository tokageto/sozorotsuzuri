// GAS の各サービス（スプレッドシート・ドライブ・地図など）の簡易な模擬。tests/gas-test.html から使う

const props = {};
const PropertiesService = { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) };
let uuidN = 0;
const Utilities = {
  getUuid: () => 'u' + (++uuidN) + '-xxxx',
  base64Decode: s => Array.from(atob(s)).map(c => c.charCodeAt(0)),
  base64Encode: b => btoa(String.fromCharCode(...b)),
  newBlob: (bytes, mime, name) => ({ bytes, mime, name }),
};
function makeSheet(name) {
  const grid = []; let maxRows = 1000;
  const sh = {
    name,
    getRange(r, c, nr = 1, nc = 1) {
      return {
        setValues(v) { for (let i = 0; i < nr; i++) { grid[r - 1 + i] = grid[r - 1 + i] || []; for (let j = 0; j < nc; j++) grid[r - 1 + i][c - 1 + j] = v[i][j]; } return this; },
        getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(((grid[r - 1 + i] || [])[c - 1 + j]) ?? ''); out.push(row); } return out; },
        setFontWeight() { return this; }, setNumberFormat() { return this; },
      };
    },
    getLastRow() { let n = 0; grid.forEach((row, i) => { if (row && row.some(v => v !== '' && v != null)) n = i + 1; }); return n; },
    getMaxRows() { return maxRows; }, insertRowsAfter(a, n) { maxRows += n; },
    setFrozenRows() {}, appendRow(v) { grid[this.getLastRow()] = v.slice(); },
    _grid: grid,
  };
  return sh;
}
const sheets = {};
const ss = {
  getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = makeSheet(n)),
  getSheets: () => Object.values(sheets), deleteSheet: s => { delete sheets[s.name]; },
  getUrl: () => 'https://docs.google.com/mock', getId: () => 'SSID',
};
const SpreadsheetApp = { create: () => { sheets['Sheet1'] = makeSheet('Sheet1'); return ss; }, openById: () => ss };
const LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
const files = {};
const folder = { getId: () => 'FOLDER', getUrl: () => 'mock', createFile: b => { const id = 'F' + Object.keys(files).length; files[id] = b; return { getId: () => id }; } };
const DriveApp = { createFolder: () => folder, getFolderById: () => folder, getFileById: id => ({ getBlob: () => ({ getBytes: () => files[id].bytes }) }) };
const Maps = { newGeocoder: () => ({ setLanguage() { return this; }, setRegion() { return this; },
  reverseGeocode: () => ({ status: 'OK', results: [{ address_components: [
    { long_name: '銚子市', types: ['locality', 'political'] },
    { long_name: '千葉県', types: ['administrative_area_level_1', 'political'] }] }] }) }) };
const ContentService = { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType() { return { body: JSON.parse(s) }; } }) };
const Logger = { log: m => log('LOG ' + m) };
const out = [];
function log(m) { out.push(m); }
