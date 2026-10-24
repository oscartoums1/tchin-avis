/* ============================================================
   Tchin — briques communes aux pages « commande » (invités) et
   « bar » (équipe) : lecture du lien, appels à la base, petites
   aides d'affichage. Tout est rangé sous `window.Tchin`.
   Charger config.js AVANT ce fichier.
   ============================================================ */
(function () {
  "use strict";

  /* ---------- Le lien : #<mode>=<payload>[.<clé>] ----------
     payload = base64url de « 1|<partyId>|<nom>|<aaaa-mm-jj>|<c1>~<c2>…[|<signature>] »
     (le même format que les menus imprimés depuis l'app ; la signature de
     l'hôte, facultative, ferme la marche). */
  function decodePayload(modes) {
    const m = location.hash.match(/^#([a-z])=([A-Za-z0-9_-]+)(?:\.([A-Za-z0-9_-]{16,128}))?$/);
    if (!m || !modes.includes(m[1])) return null;
    try {
      const b64 = m[2].replace(/-/g, "+").replace(/_/g, "/");
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const parts = new TextDecoder().decode(bytes).split("|");
      if (parts[0] !== "1" || parts.length < 5) return null;
      const cocktails = parts[4].split("~").map(s => s.trim()).filter(Boolean);
      if (!parts[1] || cocktails.length === 0) return null;
      return {
        mode: m[1], id: parts[1], name: parts[2], date: parts[3],
        cocktails, key: m[3] || null,
        signature: (parts[5] || "").trim().slice(0, 40),
      };
    } catch { return null; }
  }

  /* ---------- Configuration (surchargeable en local pour les tests) ---------- */
  function config() {
    try {
      const override = JSON.parse(localStorage.getItem("tchin:config") || "null");
      if (override && override.SUPABASE_URL) return override;
    } catch {}
    return typeof TCHIN_CONFIG === "object" ? TCHIN_CONFIG : {};
  }
  function hasBackend() {
    const c = config();
    return Boolean(c.SUPABASE_URL && c.SUPABASE_ANON_KEY);
  }

  /* ---------- Appel d'une fonction de la base ----------
     Lève une Error dont `.message` est le code métier renvoyé par la base
     (« bar_ferme », « rupture »…), « pas_installe » si le script SQL n'a pas
     été exécuté, « reseau » si on n'a pas pu joindre la base. */
  async function rpc(fn, args) {
    const c = config();
    let response;
    try {
      response = await fetch(`${c.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: {
          apikey: c.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${c.SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
        cache: "no-store",
      });
    } catch {
      throw new Error("reseau");
    }
    let data = null;
    try { data = await response.json(); } catch {}
    if (!response.ok) {
      if (response.status === 404 && data && data.code === "PGRST202") throw new Error("pas_installe");
      throw new Error((data && data.message) || `http_${response.status}`);
    }
    return data;
  }

  /* ---------- Horloge : on se cale sur l'heure de la base ---------- */
  let skew = 0;
  function syncClock(serverNow) {
    const t = Date.parse(serverNow);
    if (!Number.isNaN(t)) skew = t - Date.now();
  }
  function minutesSince(iso) {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return 0;
    return Math.max(0, Math.floor((Date.now() + skew - t) / 60000));
  }
  function since(iso) {
    const m = minutesSince(iso);
    if (m < 1) return "à l'instant";
    if (m < 60) return `il y a ${m} min`;
    const h = Math.floor(m / 60);
    return `il y a ${h} h${String(m % 60).padStart(2, "0")}`;
  }

  /* ---------- Petites aides ---------- */
  const $ = id => document.getElementById(id);
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  function frenchDate(iso) {
    const [y, m, d] = (iso || "").split("-").map(Number);
    if (!y || !m || !d) return "";
    const text = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("fr-FR",
      { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  function cleanName(raw) {
    const name = String(raw || "").trim().replace(/\s+/g, " ");
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : "";
  }
  function numero(index) { return String(index + 1).padStart(2, "0"); }
  function randomToken() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  }
  function plural(n, one, many) { return `${n} ${n > 1 ? many : one}`; }

  /* Mémoire locale par soirée : tchin:<partyId>:<clé>. */
  function store(partyId) {
    const key = kind => `tchin:${partyId}:${kind}`;
    return {
      get(kind, fallback) {
        try { return JSON.parse(localStorage.getItem(key(kind))) ?? fallback; }
        catch { return fallback; }
      },
      set(kind, value) {
        try { localStorage.setItem(key(kind), JSON.stringify(value)); } catch {}
      },
    };
  }

  /* ---------- La signature de l'hôte (mêmes formules que l'app) ---------- */
  function barTitle(name) {
    const first = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").charAt(0).toLowerCase();
    return `Le bar ${"aeiouyh".includes(first) ? "d'" : "de "}${name}`;
  }
  const CREDIT_LEAD = "Cocktails, carte et service de commande imaginés par";

  /* ---------- Les doses (gobelet doseur), comme dans l'app ---------- */
  /* « 2 », « 1½ », « ½ », « ¾ » — arrondi au quart. */
  function doseNumber(value) {
    const rounded = Math.round(value * 4) / 4;
    const whole = Math.floor(rounded + 1e-9);
    const fraction = { 1: "¼", 2: "½", 3: "¾" }[Math.round((rounded - whole) * 4)];
    if (fraction) return whole === 0 ? fraction : `${whole}${fraction}`;
    return String(whole);
  }
  function doseText(value) { return `${doseNumber(value)} dose${value >= 2 ? "s" : ""}`; }
  /* Une quantité libre ne se multiplie que si elle commence par un nombre
     entier (« 2 traits » → « 6 traits ») ; « à compléter » ou « 2,5 cl »
     restent tels quels. */
  function scaledFreeText(quantity, glasses) {
    if (glasses <= 1) return quantity;
    const m = quantity.match(/^(\d+)(?:(\s*à\s*)(\d+))?(?=\s|,(?!\d)|$)/);
    if (!m) return quantity;
    const head = m[3] !== undefined
      ? `${Number(m[1]) * glasses}${m[2]}${Number(m[3]) * glasses}`
      : `${Number(m[1]) * glasses}`;
    return head + quantity.slice(m[0].length);
  }
  /* Une quantité libre qui ne se multiplie pas mais vaut pour UN verre
     (« ½ canette », « un trait », « 1/2, en quartiers ») : à préciser
     « par verre » quand on en prépare plusieurs. */
  function perGlassOnly(quantity) {
    const text = String(quantity || "").trim();
    if (scaledFreeText(text, 2) !== text) return false;
    return /^(\d|[½¼¾⅓⅔]|une?\s)/i.test(text);
  }
  function amount(line, glasses) {
    return typeof line.dose === "number"
      ? doseText(line.dose * glasses)
      : scaledFreeText(line.texte || "", glasses);
  }

  const STATUTS = {
    en_attente: "En attente",
    en_preparation: "En préparation",
    servie: "Servie",
    annulee: "Annulée",
  };

  window.Tchin = {
    decodePayload, config, hasBackend, rpc, syncClock, minutesSince, since,
    $, el, frenchDate, cleanName, numero, randomToken, plural, store, STATUTS,
    barTitle, CREDIT_LEAD, doseNumber, doseText, scaledFreeText, perGlassOnly, amount,
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)"),
  };
})();
