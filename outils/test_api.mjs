// Tests de l'API des commandes, au niveau HTTP (comme le site et l'app).
//   node test_api.mjs [baseURL]
const BASE = process.argv[2] || "http://127.0.0.1:8799";
let failures = 0, passes = 0;

async function rpc(fn, args) {
  const r = await fetch(`${BASE}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: "x", Authorization: "Bearer x" },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, json };
}
function check(label, cond, extra) {
  if (cond) { passes++; console.log("  ✓", label); }
  else { failures++; console.log("  ✗", label, extra !== undefined ? JSON.stringify(extra) : ""); }
}
async function expectError(label, fn, args, message) {
  const r = await rpc(fn, args);
  check(`${label} → ${message}`, r.status === 400 && r.json?.message === message, r);
}

const P = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const KEY = "cle-hote-" + "f".repeat(40);
const T1 = "jeton-invite-1-" + "a".repeat(20);
const T2 = "jeton-invite-2-" + "b".repeat(20);

console.log("Soirée");
let r = await rpc("soiree_publique", { p_party: P });
check("soirée inconnue : ouverte par défaut, existe=false", r.status === 200 && r.json.ouvert === true && r.json.existe === false, r);
r = await rpc("soiree_enregistrer", { p_party: P, p_cle: KEY, p_nom: "Anniversaire de Maman",
  p_carte: [{ nom: "Mojito", detail: "Rhum, menthe, citron vert", sans_alcool: false }, { nom: "Virgin Mojito", detail: "Menthe, citron vert", sans_alcool: true }] });
check("enregistrement", r.status === 200 && r.json.existe === true && r.json.carte.length === 2, r);
r = await rpc("soiree_enregistrer", { p_party: P, p_cle: KEY, p_nom: "Anniversaire de Maman" });
check("ré-enregistrement même clé (carte conservée)", r.status === 200 && r.json.carte.length === 2, r);
await expectError("autre clé", "soiree_enregistrer", { p_party: P, p_cle: "x".repeat(20) }, "cle_refusee");
await expectError("party invalide", "soiree_enregistrer", { p_party: "AB'; drop table--", p_cle: KEY }, "soiree_invalide");
r = await rpc("soiree_regler", { p_party: P, p_cle: KEY, p_lieux: ["Table 1", "Table 2", "Terrasse"], p_message: "Bienvenue !" });
check("réglages lieux + message", r.status === 200 && r.json.lieux.length === 3 && r.json.message === "Bienvenue !", r);
await expectError("réglages mauvaise clé", "soiree_regler", { p_party: P, p_cle: "y".repeat(20), p_ouvert: false }, "cle_refusee");

console.log("Commander");
r = await rpc("commander", { p_party: P, p_jeton: T1, p_invite: "  Léa ", p_lieu: "Table 2", p_cocktail: "Mojito", p_quantite: 2, p_note: "Peu sucré" });
check("commande 1 → numéro 1", r.status === 200 && r.json.numero === 1 && r.json.id, r);
const o1 = r.json.id;
r = await rpc("commander", { p_party: P, p_jeton: T2, p_invite: "Marc", p_lieu: "Terrasse", p_cocktail: "Virgin Mojito" });
check("commande 2 (défauts quantité/note) → numéro 2", r.status === 200 && r.json.numero === 2, r);
const o2 = r.json.id;
await expectError("sans prénom", "commander", { p_party: P, p_jeton: T1, p_invite: "  ", p_lieu: "Table 1", p_cocktail: "Mojito" }, "prenom_manquant");
await expectError("sans lieu", "commander", { p_party: P, p_jeton: T1, p_invite: "Léa", p_lieu: "", p_cocktail: "Mojito" }, "lieu_manquant");
await expectError("quantité 9", "commander", { p_party: P, p_jeton: T1, p_invite: "Léa", p_lieu: "Table 1", p_cocktail: "Mojito", p_quantite: 9 }, "quantite_invalide");
await expectError("jeton court", "commander", { p_party: P, p_jeton: "abc", p_invite: "Léa", p_lieu: "Table 1", p_cocktail: "Mojito" }, "jeton_invalide");

await rpc("soiree_regler", { p_party: P, p_cle: KEY, p_ruptures: ["mojito"] });
await expectError("rupture (casse ignorée)", "commander", { p_party: P, p_jeton: T1, p_invite: "Léa", p_lieu: "Table 1", p_cocktail: "Mojito" }, "rupture");
await rpc("soiree_regler", { p_party: P, p_cle: KEY, p_ruptures: [] });
await rpc("soiree_regler", { p_party: P, p_cle: KEY, p_ouvert: false, p_message: "Pause gâteau 🎂" });
await expectError("bar fermé", "commander", { p_party: P, p_jeton: T1, p_invite: "Léa", p_lieu: "Table 1", p_cocktail: "Mojito" }, "bar_ferme");
r = await rpc("soiree_publique", { p_party: P });
check("public : fermé + message", r.json.ouvert === false && r.json.message === "Pause gâteau 🎂", r.json);
await rpc("soiree_regler", { p_party: P, p_cle: KEY, p_ouvert: true, p_message: "" });

console.log("Suivi invité");
r = await rpc("mes_commandes", { p_party: P, p_jeton: T2 });
check("Marc ne voit que sa commande, 1 devant lui", r.status === 200 && r.json.commandes.length === 1 && r.json.commandes[0].devant === 1 && !("invite" in r.json.commandes[0]), r.json);
check("file d'attente = 2", r.json.soiree.file === 2, r.json.soiree);
r = await rpc("mes_commandes", { p_party: P, p_jeton: "inconnu-" + "z".repeat(20) });
check("jeton inconnu : aucune commande", r.status === 200 && r.json.commandes.length === 0, r.json);

console.log("Annulation");
await expectError("Léa ne peut pas annuler la commande de Marc", "commande_annuler", { p_id: o2, p_jeton: T1 }, "annulation_impossible");
r = await rpc("commander", { p_party: P, p_jeton: T1, p_invite: "Léa", p_lieu: "Table 2", p_cocktail: "Virgin Mojito" });
const o3 = r.json.id;
check("commande 3 → numéro 3", r.json.numero === 3, r.json);
r = await rpc("commande_annuler", { p_id: o3, p_jeton: T1 });
check("Léa annule sa commande en attente", r.status === 200 && r.json.ok === true, r);

console.log("Bar (hôte)");
await expectError("statut mauvaise clé", "commande_statut", { p_party: P, p_cle: "z".repeat(20), p_id: o1, p_statut: "servie" }, "cle_refusee");
await expectError("statut inconnu", "commande_statut", { p_party: P, p_cle: KEY, p_id: o1, p_statut: "bue" }, "statut_invalide");
r = await rpc("commande_statut", { p_party: P, p_cle: KEY, p_id: o1, p_statut: "en_preparation" });
check("o1 → en préparation", r.status === 200, r);
await expectError("annuler une commande en préparation", "commande_annuler", { p_id: o1, p_jeton: T1 }, "annulation_impossible");
r = await rpc("mes_commandes", { p_party: P, p_jeton: T2 });
check("Marc : toujours 1 devant (o1 en préparation)", r.json.commandes[0].devant === 1, r.json.commandes[0]);
r = await rpc("commande_statut", { p_party: P, p_cle: KEY, p_id: o1, p_statut: "servie" });
r = await rpc("mes_commandes", { p_party: P, p_jeton: T2 });
check("Marc : plus personne devant", r.json.commandes[0].devant === 0, r.json.commandes[0]);
check("attente moyenne calculée (0 min)", r.json.soiree.attente_min === 0, r.json.soiree);

r = await rpc("bar_commandes", { p_party: P, p_cle: KEY });
check("bar : 3 commandes dans l'ordre, prénoms visibles", r.status === 200 && r.json.commandes.length === 3 && r.json.commandes.map(c => c.numero).join() === "1,2,3" && r.json.commandes[0].invite === "Léa", r.json.commandes?.map(c => [c.numero, c.invite, c.statut]));
const c1 = r.json.commandes[0];
check("o1 servie avec horodatages", c1.statut === "servie" && c1.prepa_at && c1.servie_at, c1);
check("o3 annulée", r.json.commandes[2].statut === "annulee", r.json.commandes[2]);
check("pas de jeton_hash exposé", !JSON.stringify(r.json).includes("jeton"), null);
await expectError("bar mauvaise clé", "bar_commandes", { p_party: P, p_cle: "w".repeat(20) }, "cle_refusee");

console.log("Avis");
await expectError("aucune note", "commande_noter", { p_id: o1, p_jeton: T1 }, "note_manquante");
await expectError("note 6", "commande_noter", { p_id: o1, p_jeton: T1, p_cocktail: 6 }, "note_invalide");
await expectError("Marc ne note pas la commande de Léa", "commande_noter", { p_id: o1, p_jeton: T2, p_cocktail: 1 }, "commande_introuvable");
await expectError("noter une commande annulée", "commande_noter", { p_id: o3, p_jeton: T1, p_cocktail: 4 }, "commande_introuvable");
r = await rpc("commande_noter", { p_id: o1, p_jeton: T1, p_cocktail: 5, p_rapidite: 4, p_service: 5, p_experience: 5, p_commentaire: "  Parfait ! " });
check("Léa note sa commande", r.status === 200, r);
r = await rpc("commande_noter", { p_id: o2, p_jeton: T2, p_cocktail: 3 });
check("Marc note sans être servi → passe servie (oubli du barman)", r.status === 200, r);
r = await rpc("bar_commandes", { p_party: P, p_cle: KEY });
check("avis visible côté bar", r.json.commandes[0].note_cocktail === 5 && r.json.commandes[0].commentaire === "Parfait !", r.json.commandes[0]);
check("o2 servie après avis", r.json.commandes[1].statut === "servie" && r.json.commandes[1].servie_at && r.json.commandes[1].note_rapidite === null, r.json.commandes[1]);
r = await rpc("mes_commandes", { p_party: P, p_jeton: T1 });
check("Léa : notee=true côté invité", r.json.commandes.find(c => c.id === o1).notee === true, r.json.commandes);

console.log("Retour en arrière & garde-fou");
r = await rpc("commande_statut", { p_party: P, p_cle: KEY, p_id: o1, p_statut: "en_attente" });
r = await rpc("bar_commandes", { p_party: P, p_cle: KEY });
check("retour en attente efface prepa/servie", r.json.commandes[0].prepa_at === null && r.json.commandes[0].servie_at === null, r.json.commandes[0]);
for (let i = 0; i < 5; i++) {
  await rpc("commander", { p_party: P, p_jeton: T2, p_invite: "Marc", p_lieu: "Bar", p_cocktail: "Mojito" });
}
await expectError("6e commande en cours pour le même téléphone", "commander", { p_party: P, p_jeton: T2, p_invite: "Marc", p_lieu: "Bar", p_cocktail: "Mojito" }, "trop_de_commandes");

console.log("Sécurité");
r = await rpc("tchin_verifier_cle", { p_party: P, p_cle: KEY });
check("outil interne tchin_verifier_cle non appelable", r.status === 401, r);
r = await rpc("tchin_hash", { p: "x" });
check("outil interne tchin_hash non appelable", r.status === 401, r);
r = await rpc("fonction_inexistante", {});
check("fonction inconnue → 404 PGRST202", r.status === 404 && r.json.code === "PGRST202", r);
for (const table of ["commandes", "soirees"]) {
  const g = await fetch(`${BASE}/rest/v1/${table}`);
  check(`lecture directe de ${table} refusée à anon`, g.status === 401, g.status);
}

console.log("Réinitialisation");
await expectError("reset mauvaise clé", "bar_reinitialiser", { p_party: P, p_cle: "q".repeat(20) }, "cle_refusee");
r = await rpc("bar_reinitialiser", { p_party: P, p_cle: KEY });
check("reset efface les commandes", r.status === 200 && r.json.effacees === 8, r);
r = await rpc("commander", { p_party: P, p_jeton: T1, p_invite: "Léa", p_lieu: "Table 1", p_cocktail: "Mojito" });
check("la numérotation repart à 1", r.json.numero === 1, r.json);
await rpc("bar_reinitialiser", { p_party: P, p_cle: KEY });

console.log(`\n${passes} réussis, ${failures} échoués`);
process.exit(failures ? 1 : 0);
