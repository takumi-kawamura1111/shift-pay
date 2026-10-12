// 給与見込みアプリ ⇄ Neon(Postgres) の中継役（Cloudflare Worker）
//
// Cloudflare の「Variables and Secrets」に次を設定する：
//   DATABASE_URL    … Neon の接続文字列（salary-tracker と同じもの）  [Secret]
//   APP_PASSPHRASE  … アプリに入力する合言葉                          [Secret]
//   ALLOWED_ORIGIN  … 省略可。既定は https://takumi-kawamura1111.github.io
//
// API
//   GET  /data   … 設定と勤務記録をすべて返す
//   POST /sync   … { settings?, entries[] } を保存し、保存後の全データを返す
//                  同じ記録は updatedAt が新しいほうを残す（削除は deleted: true）

const DEFAULT_ORIGIN = 'https://takumi-kawamura1111.github.io';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS shift_pay_entries (
     id         TEXT PRIMARY KEY,
     data       JSONB,
     deleted    BOOLEAN NOT NULL DEFAULT FALSE,
     updated_at TIMESTAMPTZ NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS shift_pay_settings (
     id         TEXT PRIMARY KEY,
     data       JSONB NOT NULL,
     updated_at TIMESTAMPTZ NOT NULL
   )`,
];

let schemaReady = false;

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || DEFAULT_ORIGIN;
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (!env.DATABASE_URL || !env.APP_PASSPHRASE) {
        return json({ error: 'サーバーの設定（DATABASE_URL / APP_PASSPHRASE）がありません' }, 500);
      }
      const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      if (!(await sameSecret(token, env.APP_PASSPHRASE))) {
        return json({ error: '合言葉が違います' }, 401);
      }

      await ensureSchema(env);
      const path = new URL(request.url).pathname;

      if (request.method === 'GET' && path === '/data') {
        return json(await readAll(env));
      }
      if (request.method === 'POST' && path === '/sync') {
        const body = await request.json();
        await writeChanges(env, body);
        return json(await readAll(env));
      }
      return json({ error: 'not found' }, 404);
    } catch (err) {
      return json({ error: String(err.message || err) }, 500);
    }
  },
};

// ===== Neon の HTTP 経由で SQL を実行 =====
async function sql(env, query, params = []) {
  const host = new URL(env.DATABASE_URL).hostname.replace(/^[^.]+\./, 'api.');
  const res = await fetch(`https://${host}/sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Neon-Connection-String': env.DATABASE_URL,
      'Neon-Raw-Text-Output': 'true', // 値はすべて文字列で受け取る
      'Neon-Array-Mode': 'false',
    },
    body: JSON.stringify({ query, params }),
  });
  const out = await res.json();
  if (!res.ok) throw new Error(out.message || `DB error ${res.status}`);
  return out.rows || [];
}

async function ensureSchema(env) {
  if (schemaReady) return;
  for (const q of SCHEMA) await sql(env, q);
  schemaReady = true;
}

async function readAll(env) {
  const [settingsRows, entryRows] = await Promise.all([
    sql(env, `SELECT data::text AS data, updated_at::text AS updated_at FROM shift_pay_settings WHERE id = 'default'`),
    sql(env, `SELECT id, data::text AS data, deleted::text AS deleted, updated_at::text AS updated_at FROM shift_pay_entries`),
  ]);
  const s = settingsRows[0];
  return {
    settings: s ? { data: JSON.parse(s.data), updatedAt: toIso(s.updated_at) } : null,
    entries: entryRows.map((r) => ({
      id: r.id,
      data: r.data ? JSON.parse(r.data) : null,
      deleted: r.deleted === 'true' || r.deleted === 't',
      updatedAt: toIso(r.updated_at),
    })),
  };
}

async function writeChanges(env, body) {
  const entries = Array.isArray(body.entries) ? body.entries : [];
  const valid = entries.filter((e) => e && typeof e.id === 'string' && e.id && isDate(e.updatedAt));
  if (valid.length) {
    await sql(env, `
      INSERT INTO shift_pay_entries (id, data, deleted, updated_at)
      SELECT x->>'id',
             CASE WHEN (x->>'deleted')::boolean THEN NULL ELSE x->'data' END,
             COALESCE((x->>'deleted')::boolean, FALSE),
             (x->>'updatedAt')::timestamptz
      FROM jsonb_array_elements($1::jsonb) AS x
      ON CONFLICT (id) DO UPDATE
        SET data = EXCLUDED.data, deleted = EXCLUDED.deleted, updated_at = EXCLUDED.updated_at
        WHERE EXCLUDED.updated_at > shift_pay_entries.updated_at`,
    [JSON.stringify(valid.map((e) => ({ id: e.id, data: e.data ?? null, deleted: !!e.deleted, updatedAt: e.updatedAt })))]);
  }

  const st = body.settings;
  if (st && st.data && typeof st.data === 'object' && isDate(st.updatedAt)) {
    await sql(env, `
      INSERT INTO shift_pay_settings (id, data, updated_at)
      VALUES ('default', $1::jsonb, $2::timestamptz)
      ON CONFLICT (id) DO UPDATE
        SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
        WHERE EXCLUDED.updated_at > shift_pay_settings.updated_at`,
    [JSON.stringify(st.data), st.updatedAt]);
  }
}

// ===== 小物 =====
function isDate(v) {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}

function toIso(pgTimestamp) {
  // "2026-10-13 00:05:23.123+00" → ISO 形式
  const d = new Date(String(pgTimestamp).replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  return Number.isNaN(d.getTime()) ? pgTimestamp : d.toISOString();
}

// 合言葉の比較（ハッシュ同士を一定時間で比較）
async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}
