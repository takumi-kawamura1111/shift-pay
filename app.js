'use strict';

// ===== 保存データ =====
const STORAGE_KEY = 'shift-pay-v1';

const DEFAULT_SETTINGS = {
  lessonHourly: 1500,  // 授業の時給（コマ給はこれを1コマの時間で換算）
  komaMinutes: 80,     // 1コマの時間
  officeHourly: 1100,  // 事務の時給
  meetingMode: 'fixed', // 'fixed' = 1回ごと / 'hourly' = 時給
  meetingRate: 1000,
  meetingHourly: 1100,
  commute: 0,          // 1日あたりの交通費
  yearTarget: 1300000,
};

const state = load();
let viewYear, viewMonth; // viewMonth は 1〜12
let editingId = null;

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      return {
        settings: { ...DEFAULT_SETTINGS, ...data.settings },
        entries: Array.isArray(data.entries) ? data.entries : [],
      };
    }
  } catch (e) {
    console.error(e);
  }
  return { settings: { ...DEFAULT_SETTINGS }, entries: [] };
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    alert('保存できませんでした。プライベートブラウズを解除してください。');
  }
}

// バックアップ日時などの補助情報（書き出しファイルには含めない）
const META_KEY = 'shift-pay-meta';
const meta = loadMeta();

function loadMeta() {
  try {
    return JSON.parse(localStorage.getItem(META_KEY)) || {};
  } catch (_) {
    return {};
  }
}

function saveMeta() {
  try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (_) { /* 保存不可の環境 */ }
}

// ===== 計算 =====
// 時間給は1件ごとに円未満切り捨て
const timePay = (min, hourly) => Math.floor((num(min) * num(hourly)) / 60);

function calcEntry(e, s = state.settings) {
  // コマも授業時間も時給で換算（1日分をまとめて円未満切り捨て）
  const lesson = timePay(num(e.koma) * num(s.komaMinutes) + num(e.lessonMin), s.lessonHourly);
  const office = timePay(e.officeMin, s.officeHourly);
  const meeting = s.meetingMode === 'hourly'
    ? timePay(e.meetingMin, s.meetingHourly)
    : num(e.meetingCount) * num(s.meetingRate);
  const commute = e.commute
    ? (e.commuteAmount === '' || e.commuteAmount == null ? num(s.commute) : num(e.commuteAmount))
    : 0;
  const other = num(e.other);
  return { lesson, office, meeting, commute, other, total: lesson + office + meeting + commute + other };
}

function workMinutes(e, s = state.settings) {
  const meetingMin = s.meetingMode === 'hourly' ? num(e.meetingMin) : 0;
  return num(e.koma) * num(s.komaMinutes) + num(e.lessonMin) + num(e.officeMin) + meetingMin;
}

function sumEntries(list) {
  const t = { lesson: 0, office: 0, meeting: 0, commute: 0, other: 0, total: 0, koma: 0, minutes: 0, days: 0 };
  const days = new Set();
  for (const e of list) {
    const c = calcEntry(e);
    for (const k of ['lesson', 'office', 'meeting', 'commute', 'other', 'total']) t[k] += c[k];
    t.koma += num(e.koma);
    t.minutes += workMinutes(e);
    days.add(e.date);
  }
  t.days = days.size;
  return t;
}

// ===== ユーティリティ =====
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
const yen = (n) => '¥' + Math.round(n).toLocaleString('ja-JP');
const pad = (n) => String(n).padStart(2, '0');
const monthKey = (y, m) => `${y}-${pad(m)}`;
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const $ = (sel) => document.querySelector(sel);
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

function fmtMinutes(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m}分`;
  return m ? `${h}時間${m}分` : `${h}時間`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ===== 画面描画 =====
function render() {
  const s = state.settings;
  const key = monthKey(viewYear, viewMonth);
  const list = state.entries
    .filter((e) => (e.date || '').startsWith(key))
    .sort((a, b) => a.date.localeCompare(b.date));
  const t = sumEntries(list);

  $('#monthLabel').textContent = `${viewYear}年${viewMonth}月`;
  $('#totalAmount').textContent = yen(t.total);
  $('#totalSub').textContent = `出勤 ${t.days}日 ・ ${t.koma}コマ ・ ${fmtMinutes(t.minutes)}`;

  const meetingLabel = s.meetingMode === 'hourly' ? '会議給<small>時給</small>' : '会議給';
  const rows = [
    ['授業給', t.lesson],
    ['事務給', t.office],
    [meetingLabel, t.meeting],
    ['交通費', t.commute],
    ['その他手当', t.other],
  ];
  $('#breakdown').innerHTML = rows
    .map(([label, v]) => `<div><dt>${label}</dt><dd>${yen(v)}</dd></div>`)
    .join('');

  // 年間累計（交通費を含む）
  const yearList = state.entries.filter((e) => (e.date || '').startsWith(`${viewYear}-`));
  const y = sumEntries(yearList);
  const yearTotal = y.total;
  const target = num(s.yearTarget);
  $('#yearTitle').textContent = `${viewYear}年の累計（交通費込み）`;
  $('#yearAmount').textContent = yen(yearTotal);
  const bar = $('#yearBar');
  bar.classList.remove('warn', 'over');
  if (target) {
    const ratio = yearTotal / target;
    $('#yearTarget').textContent = `目標 ${yen(target)}`;
    bar.style.width = Math.min(100, ratio * 100) + '%';
    if (ratio >= 1) bar.classList.add('over');
    else if (ratio >= 0.85) bar.classList.add('warn');
    $('#yearNote').textContent = ratio >= 1
      ? `目標を ${yen(yearTotal - target)} 超えています`
      : `残り ${yen(target - yearTotal)}（${Math.floor(ratio * 100)}%）`;
  } else {
    $('#yearTarget').textContent = '';
    bar.style.width = '0';
    $('#yearNote').textContent = '設定で年間目標を入れると進み具合を表示します';
  }

  // 勤務一覧
  $('#emptyMsg').classList.toggle('hidden', list.length > 0);
  $('#entries').innerHTML = list.map((e) => entryRow(e, s)).join('');
  renderNotice();
}

function entryRow(e, s) {
  const d = new Date(e.date + 'T00:00:00');
  const wd = d.getDay();
  const wdClass = wd === 0 ? 'sun' : wd === 6 ? 'sat' : '';
  const chips = [];
  if (num(e.koma)) chips.push(`${num(e.koma)}コマ`);
  if (num(e.lessonMin)) chips.push(`授業${fmtMinutes(num(e.lessonMin))}`);
  if (num(e.officeMin)) chips.push(`事務${fmtMinutes(num(e.officeMin))}`);
  if (s.meetingMode === 'hourly' ? num(e.meetingMin) : num(e.meetingCount)) {
    chips.push(s.meetingMode === 'hourly' ? `会議${fmtMinutes(num(e.meetingMin))}` : `会議${num(e.meetingCount)}回`);
  }
  if (e.commute) chips.push('交通費');
  if (num(e.other)) chips.push('手当');
  return `
    <li data-id="${e.id}">
      <div class="entry-date"><b>${d.getDate()}</b><span class="${wdClass}">${WEEK[wd]}</span></div>
      <div class="entry-info">
        <div class="chips">${chips.map((c) => `<span class="chip">${c}</span>`).join('') || '<span class="muted">—</span>'}${e.source === 'foresta' ? '<span class="chip src">出勤簿</span>' : ''}</div>
        ${e.memo ? `<div class="entry-memo">${escapeHtml(e.memo)}</div>` : ''}
      </div>
      <div class="entry-pay">${yen(calcEntry(e).total)}</div>
    </li>`;
}

// ===== 勤務入力ダイアログ =====
const entryDialog = $('#entryDialog');
const entryForm = $('#entryForm');

function defaultDate() {
  const now = new Date();
  if (now.getFullYear() === viewYear && now.getMonth() + 1 === viewMonth) return todayStr();
  return `${monthKey(viewYear, viewMonth)}-01`;
}

function openEntry(entry) {
  editingId = entry ? entry.id : null;
  const s = state.settings;
  const e = entry || {
    date: defaultDate(), koma: 0, lessonMin: '', officeMin: '', meetingCount: 0, meetingMin: '',
    commute: num(s.commute) > 0, commuteAmount: '', other: '', memo: '',
  };
  const f = entryForm.elements;
  f.date.value = e.date;
  f.koma.value = num(e.koma);
  f.lessonMin.value = num(e.lessonMin) || '';
  f.officeMin.value = num(e.officeMin) || '';
  f.meetingCount.value = num(e.meetingCount);
  f.meetingMin.value = num(e.meetingMin) || '';
  f.commute.checked = !!e.commute;
  f.commuteAmount.value = e.commuteAmount ?? '';
  f.commuteAmount.placeholder = `既定額 ${yen(num(s.commute))}`;
  f.other.value = num(e.other) || '';
  f.memo.value = e.memo || '';

  const hourly = s.meetingMode === 'hourly';
  $('#meetingCountField').classList.toggle('hidden', hourly);
  $('#meetingMinField').classList.toggle('hidden', !hourly);
  $('#entryTitle').textContent = entry ? '勤務を編集' : '勤務を追加';
  $('#deleteEntry').classList.toggle('hidden', !entry);
  $('#duplicateEntry').classList.toggle('hidden', !entry);
  syncCommuteField();
  updatePreview();
  entryDialog.showModal();
}

function readEntryForm() {
  const f = entryForm.elements;
  return {
    date: f.date.value,
    koma: num(f.koma.value),
    lessonMin: num(f.lessonMin.value),
    officeMin: num(f.officeMin.value),
    meetingCount: num(f.meetingCount.value),
    meetingMin: num(f.meetingMin.value),
    commute: f.commute.checked,
    commuteAmount: f.commuteAmount.value === '' ? '' : num(f.commuteAmount.value),
    other: num(f.other.value),
    memo: f.memo.value.trim(),
  };
}

function syncCommuteField() {
  entryForm.elements.commuteAmount.classList.toggle('hidden', !entryForm.elements.commute.checked);
}

function updatePreview() {
  const c = calcEntry(readEntryForm());
  const parts = [
    ['授業', c.lesson], ['事務', c.office], ['会議', c.meeting], ['交通費', c.commute], ['手当', c.other],
  ].filter(([, v]) => v > 0).map(([k, v]) => `${k} ${yen(v)}`);
  $('#entryPreview').innerHTML = `この日の給与 <b>${yen(c.total)}</b>` +
    (parts.length ? `<div class="muted small">${parts.join(' ／ ')}</div>` : '');
}

entryForm.addEventListener('input', () => { syncCommuteField(); updatePreview(); });

entryForm.addEventListener('submit', (ev) => {
  const data = readEntryForm();
  if (!data.date) { ev.preventDefault(); return; }
  if (editingId) {
    const i = state.entries.findIndex((e) => e.id === editingId);
    if (i >= 0) state.entries[i] = { ...state.entries[i], ...data };
  } else {
    state.entries.push({ id: uid(), ...data });
  }
  save();
  // 保存した日付の月を表示する
  const [y, m] = data.date.split('-').map(Number);
  viewYear = y; viewMonth = m;
  render();
});

$('#deleteEntry').addEventListener('click', () => {
  if (!editingId || !confirm('この勤務記録を削除しますか？')) return;
  state.entries = state.entries.filter((e) => e.id !== editingId);
  save();
  entryDialog.close();
  render();
});

$('#duplicateEntry').addEventListener('click', () => {
  editingId = null;
  $('#entryTitle').textContent = 'コピーして追加';
  $('#deleteEntry').classList.add('hidden');
  $('#duplicateEntry').classList.add('hidden');
  const dateInput = entryForm.elements.date;
  dateInput.focus();
  if (dateInput.showPicker) { try { dateInput.showPicker(); } catch (_) { /* 非対応端末 */ } }
});

// ステッパー（＋/−ボタン）
document.querySelectorAll('.stepper').forEach((st) => {
  const input = st.querySelector('input');
  st.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      input.value = Math.max(0, num(input.value) + Number(b.dataset.step));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
});

// ===== 設定ダイアログ =====
const settingsDialog = $('#settingsDialog');
const settingsForm = $('#settingsForm');
const NUM_SETTINGS = ['komaMinutes', 'lessonHourly', 'officeHourly', 'meetingRate', 'meetingHourly', 'commute', 'yearTarget'];

function openSettings() {
  const f = settingsForm.elements;
  for (const k of NUM_SETTINGS) f[k].value = state.settings[k];
  f.meetingMode.value = state.settings.meetingMode;
  syncMeetingMode();
  updateKomaRatePreview();
  renderBackupInfo();
  settingsDialog.showModal();
}

function syncMeetingMode() {
  const hourly = settingsForm.elements.meetingMode.value === 'hourly';
  $('#meetingRateField').classList.toggle('hidden', hourly);
  $('#meetingHourlyField').classList.toggle('hidden', !hourly);
}

function updateKomaRatePreview() {
  const f = settingsForm.elements;
  const rate = (num(f.lessonHourly.value) * num(f.komaMinutes.value)) / 60;
  const shown = Number.isInteger(rate) ? rate.toLocaleString('ja-JP')
    : rate.toLocaleString('ja-JP', { maximumFractionDigits: 2 });
  $('#komaRatePreview').textContent = `→ 1コマあたり ¥${shown}`;
}

settingsForm.addEventListener('change', syncMeetingMode);
settingsForm.addEventListener('input', updateKomaRatePreview);
settingsForm.addEventListener('submit', () => {
  const f = settingsForm.elements;
  for (const k of NUM_SETTINGS) state.settings[k] = num(f[k].value);
  state.settings.meetingMode = f.meetingMode.value;
  save();
  render();
});

// ===== バックアップ =====
const BACKUP_INTERVAL_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const daysSince = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS);

function markBackedUp() {
  meta.lastBackup = new Date().toISOString();
  delete meta.snoozeUntil;
  saveMeta();
  renderBackupInfo();
  renderNotice();
}

function renderBackupInfo() {
  const el = $('#backupInfo');
  if (!meta.lastBackup) {
    el.textContent = 'まだ書き出していません';
    return;
  }
  const d = new Date(meta.lastBackup);
  const days = daysSince(meta.lastBackup);
  el.textContent = `前回の書き出し：${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}` +
    (days > 0 ? `（${days}日前）` : '（今日）');
}

function downloadFile(file) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// iPhoneでは共有シートから「ファイル」やiCloud Driveに保存できる
async function exportData() {
  const file = new File([JSON.stringify(state, null, 2)], `shift-pay-${todayStr()}.json`, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      markBackedUp();
    } catch (e) {
      if (e.name !== 'AbortError') {
        downloadFile(file);
        markBackedUp();
      }
    }
    return;
  }
  downloadFile(file);
  markBackedUp();
}

$('#exportData').addEventListener('click', exportData);

// ===== フォレスタ出勤簿から取り込み =====
const BOOKMARKLET = "javascript:(function(){var s=document.createElement('script');" +
  "s.src='https://takumi-kawamura1111.github.io/shift-pay/foresta.js?t='+Date.now();" +
  'document.body.appendChild(s);})();';

$('#copyBookmarklet').addEventListener('click', async () => {
  const area = $('#bookmarkletCode');
  area.value = BOOKMARKLET;
  try {
    await navigator.clipboard.writeText(BOOKMARKLET);
    alert('コピーしました。ブックマークのURL欄に貼り付けてください。');
  } catch (_) {
    // コピーできない環境では、表示した文字を手で選択してもらう
    area.classList.remove('hidden');
    area.focus();
    area.select();
  }
});

// 出勤簿の1日分 → 勤務記録
function forestaEntry(day) {
  const komaMin = num(state.settings.komaMinutes);
  const lesson = num(day.l);
  return {
    id: uid(),
    date: day.d,
    koma: komaMin ? Math.floor(lesson / komaMin) : 0,
    lessonMin: komaMin ? lesson % komaMin : lesson,
    officeMin: num(day.b) + num(day.j) + num(day.e), // 業務・準備・片付・夕礼
    meetingCount: num(day.m) > 0 ? 1 : 0,
    meetingMin: num(day.m),
    commute: num(day.c) > 0,
    commuteAmount: num(day.c) > 0 ? num(day.c) : '',
    other: 0,
    memo: '',
    source: 'foresta',
  };
}

function importFromHash() {
  const m = location.hash.match(/^#import=(.+)$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  importForesta(decodeURIComponent(m[1]));
}

// 出勤簿からコピーしたデータ（取り込み用URLでも可）を取り込む
function importForesta(code) {
  const raw = String(code).trim().replace(/^.*#import=/, '');
  let payload;
  try {
    payload = JSON.parse(atob(decodeURIComponent(raw)));
    if (payload.src !== 'foresta' || !/^\d{4}-\d{2}$/.test(payload.month) || !Array.isArray(payload.days)) {
      throw new Error('形式が違います');
    }
  } catch (e) {
    alert('出勤簿のデータを読み込めませんでした：' + e.message);
    return;
  }

  const { month, days } = payload;
  const valid = days.filter((d) => typeof d.d === 'string' && d.d.startsWith(month));
  const imported = valid.map(forestaEntry);
  const [y, mo] = month.split('-').map(Number);
  const total = imported.reduce((s, e) => s + calcEntry(e).total, 0);

  if (!confirm(`フォレスタ出勤簿から${y}年${mo}月の${imported.length}日分を取り込みます。\n` +
    `給与見込み：${yen(total)}\n\n前回この月に取り込んだ分は置き換えます。`)) return;

  // 同じ日に手入力した記録があれば、二重にならないよう消すか確認する
  const dates = new Set(imported.map((e) => e.date));
  const manualSameDay = state.entries.filter((e) => e.source !== 'foresta' && dates.has(e.date));
  const removeManual = manualSameDay.length > 0 &&
    confirm(`同じ日に手入力した記録が${manualSameDay.length}件あります。二重にならないよう削除しますか？\n` +
      '（「キャンセル」で残します）');

  state.entries = state.entries.filter((e) => {
    if (!(e.date || '').startsWith(month)) return true;
    if (e.source === 'foresta') return false;
    return !(removeManual && dates.has(e.date));
  });
  state.entries.push(...imported);
  save();
  viewYear = y;
  viewMonth = mo;
  render();
}

window.addEventListener('hashchange', importFromHash);

// ホーム画面のアプリはブラウザと保存場所が別なので、コピー＆貼り付けでも取り込めるようにする
$('#pasteForesta').addEventListener('click', async () => {
  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch (_) {
    text = prompt('出勤簿でコピーしたデータを貼り付けてください') || '';
  }
  if (!text.trim()) return;
  settingsDialog.close();
  importForesta(text);
});

// ===== 画面上部のお知らせ =====
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

function backupDue() {
  if (meta.snoozeUntil && Date.now() < meta.snoozeUntil) return false;
  if (!meta.lastBackup) return state.entries.length >= 5;
  return state.entries.length > 0 && daysSince(meta.lastBackup) >= BACKUP_INTERVAL_DAYS;
}

let noticeKind = null;

function renderNotice() {
  const box = $('#notice');
  noticeKind = null;
  if (backupDue()) {
    noticeKind = 'backup';
    $('#noticeText').textContent = meta.lastBackup
      ? `前回のバックアップから${daysSince(meta.lastBackup)}日たちました。データが消えたときのために書き出しておきましょう。`
      : 'データはこの端末にだけ保存されています。消えたときのために書き出しておきましょう。';
    $('#noticeAction').textContent = '今すぐ書き出す';
  } else if (isIOS && !isStandalone && !meta.installTipDismissed) {
    noticeKind = 'install';
    $('#noticeText').textContent =
      'iPhoneでは、Safariで開いて 共有ボタン →「ホーム画面に追加」から使うとデータが消えにくくなります。';
    $('#noticeAction').textContent = 'わかった';
  }
  box.classList.toggle('hidden', !noticeKind);
}

$('#noticeAction').addEventListener('click', () => {
  if (noticeKind === 'backup') {
    exportData();
  } else {
    meta.installTipDismissed = true;
    saveMeta();
    renderNotice();
  }
});

$('#noticeClose').addEventListener('click', () => {
  if (noticeKind === 'backup') {
    meta.snoozeUntil = Date.now() + 3 * DAY_MS; // 3日後にまた表示
  } else {
    meta.installTipDismissed = true;
  }
  saveMeta();
  renderNotice();
});

$('#importData').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.entries)) throw new Error('形式が違います');
    if (!confirm(`${data.entries.length}件の勤務記録を読み込みます。今のデータは上書きされます。よろしいですか？`)) return;
    state.settings = { ...DEFAULT_SETTINGS, ...data.settings };
    state.entries = data.entries;
    save();
    markBackedUp(); // 読み込んだファイルがそのままバックアップになる
    settingsDialog.close();
    render();
  } catch (e) {
    alert('読み込めませんでした：' + e.message);
  }
});

// ===== 共通イベント =====
document.querySelectorAll('[data-close]').forEach((b) =>
  b.addEventListener('click', () => b.closest('dialog').close()));

// 背景タップで閉じる
for (const d of [entryDialog, settingsDialog]) {
  d.addEventListener('click', (ev) => { if (ev.target === d) d.close(); });
}

function shiftMonth(delta) {
  viewMonth += delta;
  if (viewMonth < 1) { viewMonth = 12; viewYear--; }
  if (viewMonth > 12) { viewMonth = 1; viewYear++; }
  render();
}

$('#prevMonth').addEventListener('click', () => shiftMonth(-1));
$('#nextMonth').addEventListener('click', () => shiftMonth(1));
$('#monthLabel').addEventListener('click', () => {
  const now = new Date();
  viewYear = now.getFullYear();
  viewMonth = now.getMonth() + 1;
  render();
});
$('#openSettings').addEventListener('click', openSettings);
$('#addEntry').addEventListener('click', () => openEntry(null));
$('#entries').addEventListener('click', (ev) => {
  const li = ev.target.closest('li[data-id]');
  if (li) openEntry(state.entries.find((e) => e.id === li.dataset.id));
});

// ===== 起動 =====
(function init() {
  const now = new Date();
  viewYear = now.getFullYear();
  viewMonth = now.getMonth() + 1;
  render();
  importFromHash();
  // 初回は設定から
  let firstRun = false;
  try { firstRun = !localStorage.getItem(STORAGE_KEY); } catch (_) { /* 保存不可の環境 */ }
  if (firstRun) openSettings();

  // ブラウザに「このデータを消さないで」と頼む（容量不足時の自動削除を防ぐ）
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(console.error);
  }
})();
