// フォレスタ出勤簿のカレンダー画面で実行し、表示中の月の勤務を給与見込みアプリへ送る。
// ブックマークレットから読み込まれる。出勤簿のデータは読むだけで、変更はしない。
(function () {
  'use strict';

  var APP_URL = 'https://takumi-kawamura1111.github.io/shift-pay/';
  var DAY_TIMEOUT_MS = 20000;

  if (location.hostname !== 'time.foresta.jp' || !document.getElementById('calendar')) {
    alert('フォレスタ出勤簿の「カレンダー」画面を開いてから実行してください。');
    return;
  }
  if (window.__shiftPayRunning) return;
  window.__shiftPayRunning = true;

  // ===== 表示 =====
  var box = document.createElement('div');
  box.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999', 'background:rgba(0,0,0,.5)',
    'display:flex', 'align-items:center', 'justify-content:center', 'padding:16px',
    'font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif',
  ].join(';');
  var panel = document.createElement('div');
  panel.style.cssText = 'background:#fff;color:#111;border-radius:16px;padding:20px;width:100%;max-width:420px;max-height:90vh;overflow:auto;font-size:15px;line-height:1.6';
  box.appendChild(panel);
  document.body.appendChild(box);

  function finish() {
    box.remove();
    window.__shiftPayRunning = false;
  }

  function showMessage(html, withClose) {
    panel.innerHTML = html + (withClose
      ? '<button type="button" data-close style="margin-top:16px;width:100%;padding:12px;border:1px solid #ccc;border-radius:10px;background:#f5f5f5;font-size:15px">閉じる</button>'
      : '');
    var btn = panel.querySelector('[data-close]');
    if (btn) btn.onclick = finish;
  }

  // ===== 表示中の月と出勤日 =====
  function currentMonth() {
    try {
      return window.jQuery('#calendar').fullCalendar('getDate').format('YYYY-MM');
    } catch (_) {
      var m = (document.querySelector('#calendar .fc-center h2') || {}).textContent || '';
      var r = m.match(/(\d{4})年(\d{1,2})月/);
      return r ? r[1] + '-' + ('0' + r[2]).slice(-2) : null;
    }
  }

  var month = currentMonth();
  if (!month) {
    showMessage('表示中の月を読み取れませんでした。', true);
    return;
  }

  var dates = [];
  document.querySelectorAll('#calendar a.fc-event[data-date]').forEach(function (a) {
    var d = a.getAttribute('data-date');
    if (d && d.indexOf(month) === 0 && a.textContent.indexOf('出勤') >= 0 && dates.indexOf(d) < 0) {
      dates.push(d);
    }
  });
  dates.sort();

  if (!dates.length) {
    showMessage('<b>' + month.replace('-', '年') + '月</b>の出勤記録が見つかりませんでした。', true);
    return;
  }

  // ===== 1日分の入力画面を裏で開いて、計算後の値を読む =====
  function readDay(date) {
    return new Promise(function (resolve, reject) {
      var frame = document.createElement('iframe');
      frame.style.cssText = 'position:absolute;width:1px;height:1px;left:-9999px;opacity:0';
      var timer = setTimeout(function () {
        frame.remove();
        reject(new Error('時間切れ'));
      }, DAY_TIMEOUT_MS);

      frame.onload = function () {
        // ページ側のスクリプトが授業時間などを計算し終わるのを少し待つ
        setTimeout(function () {
          try {
            var doc = frame.contentDocument;
            if (!doc || frame.contentWindow.location.pathname.indexOf(date) < 0) {
              throw new Error('ページを開けませんでした（ログインが切れた可能性があります）');
            }
            var text = function (sel) {
              var el = doc.querySelector(sel);
              return el ? parseInt(el.textContent, 10) || 0 : 0;
            };
            var val = function (sel) {
              var el = doc.querySelector(sel);
              return el ? parseInt(el.value, 10) || 0 : 0;
            };
            var day = {
              d: date,
              l: text('#school_hours'),            // 授業時間計（個別＋補講＋集団−遅刻）
              m: text('#meeting_total_time'),      // 会議
              b: text('#business_total_time'),     // 業務
              j: val('input[name="junbi"]') + val('input[name="katazuke"]'), // 準備＋片付
              e: val('input[name="evening_meeting"]'), // 夕礼
              c: val('input[name="carfare"]'),     // 交通費
            };
            clearTimeout(timer);
            frame.remove();
            resolve(day);
          } catch (err) {
            clearTimeout(timer);
            frame.remove();
            reject(err);
          }
        }, 800);
      };
      frame.src = '/teacher/record/' + date;
      document.body.appendChild(frame);
    });
  }

  function label(date) {
    var p = date.split('-');
    return Number(p[1]) + '/' + Number(p[2]);
  }

  async function run() {
    var days = [];
    var failed = [];
    for (var i = 0; i < dates.length; i++) {
      showMessage('<b>出勤簿を読み取り中…</b><br>' + label(dates[i]) + '（' + (i + 1) + ' / ' + dates.length + '日）');
      try {
        days.push(await readDay(dates[i]));
      } catch (err) {
        failed.push(label(dates[i]) + '：' + err.message);
      }
    }

    if (!days.length) {
      showMessage('読み取れませんでした。<br><small>' + failed.join('<br>') + '</small>', true);
      return;
    }

    var sum = function (k) { return days.reduce(function (s, d) { return s + d[k]; }, 0); };
    var payload = { v: 1, src: 'foresta', month: month, days: days };
    var code = btoa(JSON.stringify(payload));
    var url = APP_URL + '#import=' + encodeURIComponent(code);
    var yen = function (n) { return '¥' + n.toLocaleString('ja-JP'); };

    showMessage(
      '<div style="font-size:17px;font-weight:700;margin-bottom:8px">' + month.replace('-', '年') + '月の出勤簿</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:14px">' +
      [
        ['出勤日数', days.length + '日'],
        ['授業時間', sum('l') + '分'],
        ['会議', sum('m') + '分'],
        ['業務・準備・片付・夕礼', (sum('b') + sum('j') + sum('e')) + '分'],
        ['交通費', yen(sum('c'))],
      ].map(function (r) {
        return '<tr><td style="padding:6px 0;border-bottom:1px solid #eee;color:#666">' + r[0] +
          '</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;font-weight:600">' + r[1] + '</td></tr>';
      }).join('') +
      '</table>' +
      (failed.length ? '<p style="color:#c00;font-size:13px">読み取れなかった日：<br>' + failed.join('<br>') + '</p>' : '') +
      '<button type="button" data-copy style="display:block;width:100%;margin-top:16px;padding:14px;border:none;border-radius:10px;background:#2563eb;color:#fff;font-size:16px;font-weight:700">データをコピー</button>' +
      '<p style="font-size:12px;color:#666;margin:6px 0 0">コピーしたら、給与見込みアプリ（ホーム画面）の 設定 →「コピーしたデータを取り込む」を押してください。</p>' +
      '<a href="' + url + '" style="display:block;margin-top:12px;font-size:14px;text-align:center;color:#2563eb">このブラウザで給与見込みアプリを開いて取り込む</a>',
      true
    );

    panel.querySelector('[data-copy]').onclick = function () {
      var btn = this;
      var done = function () { btn.textContent = 'コピーしました ✓'; btn.style.background = '#16a34a'; };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(done, function () { fallbackCopy(code) && done(); });
      } else if (fallbackCopy(code)) {
        done();
      }
    };
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { /* 非対応 */ }
    ta.remove();
    if (!ok) prompt('このデータをコピーしてください', text);
    return ok;
  }

  run();
})();
