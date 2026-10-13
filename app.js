'use strict';

// ===== 保存データ =====
const STORAGE_KEY = 'shift-pay-calc-v1';
const OLD_STORAGE_KEY = 'shift-pay-v1'; // 以前の版（勤務記録つき）の設定を引き継ぐ

const DEFAULT_SETTINGS = {
  lessonHourly: 1500, // 授業の時給
  komaMinutes: 80,    // 1コマの時間
  commute: 0,         // 1日あたりの交通費
  meeting: 0,         // 会議給
  meetingUnit: 'month', // 'day' = 出勤1日ごと / 'month' = 1か月ごと
  office: 0,          // 事務給
  officeUnit: 'day',
};

const state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      return {
        settings: { ...DEFAULT_SETTINGS, ...data.settings },
        days: num(data.days),
        koma: num(data.koma),
        configured: true,
      };
    }
    const old = JSON.parse(localStorage.getItem(OLD_STORAGE_KEY) || 'null');
    if (old && old.settings) {
      const { lessonHourly, komaMinutes, commute } = old.settings;
      return {
        settings: { ...DEFAULT_SETTINGS, lessonHourly, komaMinutes, commute },
        days: 0,
        koma: 0,
        configured: false,
      };
    }
  } catch (e) {
    console.error(e);
  }
  return { settings: { ...DEFAULT_SETTINGS }, days: 0, koma: 0, configured: false };
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      settings: state.settings, days: state.days, koma: state.koma,
    }));
  } catch (_) { /* 保存できない環境でも計算はできる */ }
}

// ===== 計算 =====
function calc(days, koma, s = state.settings) {
  const lesson = Math.floor((num(koma) * num(s.komaMinutes) * num(s.lessonHourly)) / 60);
  const commute = num(days) * num(s.commute);
  // 月額は出勤した月だけ数える
  const perUnit = (amount, unit) => (unit === 'day' ? num(days) * num(amount) : (num(days) > 0 ? num(amount) : 0));
  const meeting = perUnit(s.meeting, s.meetingUnit);
  const office = perUnit(s.office, s.officeUnit);
  return { lesson, meeting, office, commute, total: lesson + meeting + office + commute };
}

// ===== ユーティリティ =====
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
const yen = (n) => '¥' + Math.round(n).toLocaleString('ja-JP');
const $ = (sel) => document.querySelector(sel);

function fmtMinutes(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m}分`;
  return m ? `${h}時間${m}分` : `${h}時間`;
}

// ===== 画面 =====
function render() {
  const s = state.settings;
  const c = calc(state.days, state.koma);
  $('#totalAmount').textContent = yen(c.total);
  $('#totalSub').textContent =
    `出勤 ${state.days}日 ・ ${state.koma}コマ（授業 ${fmtMinutes(state.koma * num(s.komaMinutes))}）`;

  const unitLabel = (unit) => (unit === 'day' ? '1日ごと' : '月額');
  const rows = [
    ['授業給', c.lesson],
    [`会議給<small>${unitLabel(s.meetingUnit)}</small>`, c.meeting],
    [`事務給<small>${unitLabel(s.officeUnit)}</small>`, c.office],
    ['交通費', c.commute],
  ];
  $('#breakdown').innerHTML = rows
    .map(([label, v]) => `<div><dt>${label}</dt><dd>${yen(v)}</dd></div>`)
    .join('');
}

// 出勤日数・コマ数の入力
for (const id of ['days', 'koma']) {
  const input = $('#' + id);
  input.value = state[id];
  input.addEventListener('input', () => {
    state[id] = Math.floor(num(input.value));
    save();
    render();
  });
}

document.querySelectorAll('.stepper button').forEach((b) => {
  b.addEventListener('click', () => {
    const input = $('#' + b.dataset.target);
    input.value = Math.max(0, Math.floor(num(input.value)) + Number(b.dataset.step));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
});

// ===== 設定 =====
const settingsDialog = $('#settingsDialog');
const settingsForm = $('#settingsForm');
const NUM_SETTINGS = ['lessonHourly', 'komaMinutes', 'commute', 'meeting', 'office'];

function openSettings() {
  const f = settingsForm.elements;
  for (const k of NUM_SETTINGS) f[k].value = state.settings[k];
  f.meetingUnit.value = state.settings.meetingUnit;
  f.officeUnit.value = state.settings.officeUnit;
  updateKomaRatePreview();
  settingsDialog.showModal();
}

function updateKomaRatePreview() {
  const f = settingsForm.elements;
  const rate = (num(f.lessonHourly.value) * num(f.komaMinutes.value)) / 60;
  const shown = Number.isInteger(rate) ? rate.toLocaleString('ja-JP')
    : rate.toLocaleString('ja-JP', { maximumFractionDigits: 2 });
  $('#komaRatePreview').textContent = `→ 1コマあたり ¥${shown}`;
}

settingsForm.addEventListener('input', updateKomaRatePreview);
settingsForm.addEventListener('submit', () => {
  const f = settingsForm.elements;
  for (const k of NUM_SETTINGS) state.settings[k] = num(f[k].value);
  state.settings.meetingUnit = f.meetingUnit.value;
  state.settings.officeUnit = f.officeUnit.value;
  state.configured = true;
  save();
  render();
});

$('#openSettings').addEventListener('click', openSettings);
document.querySelectorAll('[data-close]').forEach((b) =>
  b.addEventListener('click', () => b.closest('dialog').close()));
settingsDialog.addEventListener('click', (ev) => { if (ev.target === settingsDialog) settingsDialog.close(); });

// ===== 起動 =====
render();
if (!state.configured) openSettings(); // 初回（または以前の版から移ったとき）は設定から

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(console.error);
}
