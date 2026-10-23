// Réplique locale minimale de Supabase (PostgREST) sur un VRAI Postgres
// (PGlite = PostgreSQL 17 en WASM). Sert à tester commandes.sql, le site et
// l'app sans toucher à la base de production.
//
//   node supabase_local.mjs <setup.sql> <commandes.sql> [port]
//
// Fidélité visée : rôle `anon` + privilèges par défaut façon Supabase,
// RPC par arguments nommés, transaction par requête (lecture seule pour les
// fonctions STABLE), erreurs au format PostgREST ({code, message}) avec les
// mêmes statuts HTTP (400 pour raise exception, 404 PGRST202 si la fonction
// n'existe pas, 401 si permission refusée).
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import http from "node:http";

const [setupPath, commandesPath, portArg] = process.argv.slice(2);
const port = Number(portArg || 8799);
const db = new PGlite();

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`);
if (setupPath) await db.exec(readFileSync(setupPath, "utf8"));
if (commandesPath) {
  // Deux fois : le script doit être ré-exécutable sans erreur.
  for (const pass of [1, 2]) {
    const results = await db.exec(readFileSync(commandesPath, "utf8"));
    const last = results[results.length - 1];
    console.log(`commandes.sql passe ${pass} :`, JSON.stringify(last.rows));
  }
}

// PGlite n'a qu'une connexion : on sérialise les requêtes.
let queue = Promise.resolve();
const serial = fn => (queue = queue.then(fn, fn));

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type, prefer, range",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Expose-Headers": "content-range",
};

function send(res, status, body, extra = {}) {
  const data = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, { ...cors, "Content-Type": "application/json", ...extra });
  res.end(data);
}

function pgError(res, e) {
  const code = e.code || "XX000";
  const status = code === "P0001" ? 400
    : code === "42501" ? 401
    : code === "42883" ? 404
    : 400;
  send(res, status, { code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null });
}

async function rpc(name, args) {
  const procs = await db.query(
    `select p.oid, p.proargnames as names, p.provolatile as vol,
            array(select format_type(t, null) from unnest(p.proargtypes) t) as types
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = $1`, [name]);
  const keys = Object.keys(args);
  const proc = procs.rows.find(p => keys.every(k => (p.names || []).includes(k)));
  if (!proc) {
    const err = new Error(`Could not find the function public.${name}(${keys.join(", ")}) in the schema cache`);
    err.code = "PGRST202";
    err.http = 404;
    throw err;
  }
  const params = [];
  const named = keys.map((k, i) => {
    const type = proc.types[proc.names.indexOf(k)];
    const v = args[k];
    // Types natifs JS pour les booléens/nombres (le sérialiseur PGlite les
    // exige), JSON texte pour jsonb, texte pour le reste.
    params.push(
      v === null || v === undefined ? null
      : (type === "jsonb" || type === "json") ? JSON.stringify(v)
      : (type === "boolean" || type === "integer" || type === "smallint") ? v
      : String(v)
    );
    return `${k} => $${i + 1}::${type}`;
  });
  return db.transaction(async tx => {
    if (proc.vol !== "v") await tx.exec("set transaction read only");
    await tx.exec("set local role anon");
    const r = await tx.query(`select public."${name}"(${named.join(", ")}) as r`, params);
    return r.rows[0].r;
  });
}

async function selectAvis(url) {
  const party = (url.searchParams.get("party_id") || "").replace(/^eq\./, "");
  const cols = (url.searchParams.get("select") || "*")
    .split(",").map(c => c.trim()).filter(c => /^[a-z_]+$/.test(c) || c === "*");
  return db.transaction(async tx => {
    await tx.exec("set local role anon");
    const r = await tx.query(`select ${cols.join(", ")} from public.avis where party_id = $1 order by created_at`, [party]);
    return r.rows;
  });
}

async function selectTable(table) {
  return db.transaction(async tx => {
    await tx.exec("set local role anon");
    const r = await tx.query(`select * from public."${table}"`);
    return r.rows;
  });
}

http.createServer((req, res) => {
  let body = "";
  req.on("data", c => { body += c; });
  req.on("end", () => serial(async () => {
    const url = new URL(req.url, "http://local");
    if (req.method === "OPTIONS") return send(res, 204);
    try {
      const m = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
      if (m && req.method === "POST") {
        const args = body ? JSON.parse(body) : {};
        const result = await rpc(m[1], args);
        console.log(`RPC ${m[1]} → ok`);
        return send(res, 200, result);
      }
      const t = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
      if (t && req.method === "GET") {
        const rows = t[1] === "avis" ? await selectAvis(url) : await selectTable(t[1]);
        return send(res, 200, rows);
      }
      return send(res, 404, { code: "PGRST000", message: "route inconnue" });
    } catch (e) {
      console.log(`ERREUR ${url.pathname} → ${e.code} ${e.message}`);
      if (e.http) return send(res, e.http, { code: e.code, message: e.message });
      return pgError(res, e);
    }
  }));
}).listen(port, "127.0.0.1", () => console.log(`supabase local prêt sur :${port}`));

// Accès SQL direct pour les tests (inspection, horloge).
http.createServer((req, res) => {
  let body = "";
  req.on("data", c => { body += c; });
  req.on("end", () => serial(async () => {
    try {
      const r = await db.query(body);
      send(res, 200, r.rows);
    } catch (e) { pgError(res, e); }
  }));
}).listen(port + 1, "127.0.0.1");
