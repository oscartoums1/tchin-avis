-- ============================================================
-- Tchin — le bar en direct : les commandes des invités.
--
-- À exécuter UNE FOIS dans Supabase : SQL Editor → New query →
-- coller TOUT ce fichier → Run. Ré-exécutable sans risque.
-- Ne touche pas à la table des avis (setup.sql).
--
-- Principe de sécurité : la clé « anon » (publique, dans le site)
-- n'a AUCUN accès direct aux tables. Tout passe par les fonctions
-- ci-dessous, qui vérifient :
--   - pour l'hôte : la clé secrète de la soirée (connue de l'app) ;
--   - pour l'invité : le jeton aléatoire de son téléphone.
-- Seuls des empreintes SHA-256 de ces secrets sont stockées.
--
-- La dernière requête vérifie l'installation de bout en bout et
-- affiche « Bar en direct installé et vérifié ✓ ».
-- ============================================================

-- ---------- Tables ----------

create table if not exists public.soirees (
  party_id   text primary key,
  nom        text not null default '',
  cle_hash   text not null,
  ouvert     boolean not null default true,
  message    text not null default '',
  -- ["Table 1", "Terrasse", …] : les lieux proposés aux invités.
  lieux      jsonb not null default '[]'::jsonb,
  -- ["Mojito", …] : les cocktails momentanément indisponibles.
  ruptures   jsonb not null default '[]'::jsonb,
  -- [{"nom": "Mojito", "detail": "Rhum, menthe…", "sans_alcool": false}, …]
  carte      jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.commandes (
  id              uuid primary key default gen_random_uuid(),
  party_id        text not null,
  numero          integer not null,
  invite          text not null,
  lieu            text not null,
  cocktail        text not null,
  quantite        smallint not null default 1 check (quantite between 1 and 4),
  note            text not null default '',
  statut          text not null default 'en_attente'
                  check (statut in ('en_attente', 'en_preparation', 'servie', 'annulee')),
  jeton_hash      text not null,
  created_at      timestamptz not null default now(),
  prepa_at        timestamptz,
  servie_at       timestamptz,
  note_cocktail   smallint check (note_cocktail between 1 and 5),
  note_rapidite   smallint check (note_rapidite between 1 and 5),
  note_service    smallint check (note_service between 1 and 5),
  note_experience smallint check (note_experience between 1 and 5),
  commentaire     text not null default '',
  notee_at        timestamptz,
  unique (party_id, numero)
);

create index if not exists commandes_party_idx on public.commandes (party_id, created_at);

-- Aucun accès direct pour les clés publiques : RLS sans policy + droits retirés.
alter table public.soirees enable row level security;
alter table public.commandes enable row level security;
revoke all on public.soirees from anon, authenticated;
revoke all on public.commandes from anon, authenticated;

-- ---------- Outils internes (non exposés) ----------

create or replace function public.tchin_hash(p text) returns text
language sql immutable
set search_path = public
as $$
  select encode(sha256(convert_to(coalesce(p, ''), 'UTF8')), 'hex')
$$;

create or replace function public.tchin_verifier_cle(p_party text, p_cle text) returns void
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.soirees
    where party_id = p_party and cle_hash = public.tchin_hash(p_cle)
  ) then
    raise exception 'cle_refusee';
  end if;
end
$$;

revoke execute on function public.tchin_hash(text) from public, anon, authenticated;
revoke execute on function public.tchin_verifier_cle(text, text) from public, anon, authenticated;

-- ---------- Lecture publique d'une soirée (invités) ----------

-- La configuration visible des invités + l'état de la file d'attente.
create or replace function public.soiree_publique(p_party text) returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'existe',   s.party_id is not null,
    'ouvert',   coalesce(s.ouvert, true),
    'message',  coalesce(s.message, ''),
    'lieux',    coalesce(s.lieux, '[]'::jsonb),
    'ruptures', coalesce(s.ruptures, '[]'::jsonb),
    'carte',    coalesce(s.carte, '[]'::jsonb),
    'file', (
      select count(*) from public.commandes c
      where c.party_id = p_party and c.statut in ('en_attente', 'en_preparation')
    ),
    -- Temps moyen (minutes) entre commande et service, sur les 8 derniers servis.
    'attente_min', (
      select round(extract(epoch from avg(d.servie_at - d.created_at)) / 60)
      from (
        select c.servie_at, c.created_at from public.commandes c
        where c.party_id = p_party and c.statut = 'servie' and c.servie_at is not null
        order by c.servie_at desc
        limit 8
      ) d
    ),
    'maintenant', now()
  )
  from (select 1) as un
  left join public.soirees s on s.party_id = p_party
$$;

-- ---------- Hôte : enregistrer / régler sa soirée ----------

-- Revendique la soirée avec la clé de l'app (la première fois), puis
-- met à jour son nom et sa carte. Refuse une autre clé ensuite.
create or replace function public.soiree_enregistrer(
  p_party text, p_cle text, p_nom text default null, p_carte jsonb default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_hash text := public.tchin_hash(p_cle);
begin
  if p_party is null or p_party !~ '^[a-z0-9-]{8,64}$' then
    raise exception 'soiree_invalide';
  end if;
  if p_cle is null or length(p_cle) < 16 then
    raise exception 'cle_invalide';
  end if;

  insert into public.soirees (party_id, nom, cle_hash)
  values (p_party, left(coalesce(p_nom, ''), 80), v_hash)
  on conflict (party_id) do nothing;

  update public.soirees set
    nom = left(coalesce(p_nom, nom), 80),
    carte = case when jsonb_typeof(p_carte) = 'array' then p_carte else carte end,
    updated_at = now()
  where party_id = p_party and cle_hash = v_hash;

  if not found then
    raise exception 'cle_refusee';
  end if;
  return public.soiree_publique(p_party);
end
$$;

-- Ouvrir / fermer le bar, message aux invités, lieux, ruptures.
-- Un paramètre absent (null) laisse le réglage tel quel.
create or replace function public.soiree_regler(
  p_party text, p_cle text,
  p_ouvert boolean default null,
  p_message text default null,
  p_lieux jsonb default null,
  p_ruptures jsonb default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  perform public.tchin_verifier_cle(p_party, p_cle);
  update public.soirees set
    ouvert = coalesce(p_ouvert, ouvert),
    message = left(coalesce(p_message, message), 200),
    lieux = case when jsonb_typeof(p_lieux) = 'array' then p_lieux else lieux end,
    ruptures = case when jsonb_typeof(p_ruptures) = 'array' then p_ruptures else ruptures end,
    updated_at = now()
  where party_id = p_party;
  return public.soiree_publique(p_party);
end
$$;

-- ---------- Invité : commander, suivre, annuler, noter ----------

create or replace function public.commander(
  p_party text, p_jeton text, p_invite text, p_lieu text, p_cocktail text,
  p_quantite integer default 1, p_note text default ''
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_soiree public.soirees;
  v_hash text := public.tchin_hash(p_jeton);
  v_invite text := left(btrim(coalesce(p_invite, '')), 40);
  v_lieu text := left(btrim(coalesce(p_lieu, '')), 60);
  v_cocktail text := left(btrim(coalesce(p_cocktail, '')), 80);
  v_numero integer;
  v_id uuid;
begin
  if p_party is null or p_party !~ '^[a-z0-9-]{8,64}$' then
    raise exception 'soiree_invalide';
  end if;
  if p_jeton is null or length(p_jeton) < 16 then raise exception 'jeton_invalide'; end if;
  if v_invite = '' then raise exception 'prenom_manquant'; end if;
  if v_lieu = '' then raise exception 'lieu_manquant'; end if;
  if v_cocktail = '' then raise exception 'cocktail_manquant'; end if;
  if p_quantite is null or p_quantite not between 1 and 4 then
    raise exception 'quantite_invalide';
  end if;

  select * into v_soiree from public.soirees where party_id = p_party;
  if found then
    if not v_soiree.ouvert then raise exception 'bar_ferme'; end if;
    if exists (
      select 1 from jsonb_array_elements_text(v_soiree.ruptures) r
      where lower(r) = lower(v_cocktail)
    ) then
      raise exception 'rupture';
    end if;
  end if;

  -- Garde-fou : pas plus de 5 commandes en cours par téléphone.
  if (
    select count(*) from public.commandes
    where party_id = p_party and jeton_hash = v_hash
      and statut in ('en_attente', 'en_preparation')
  ) >= 5 then
    raise exception 'trop_de_commandes';
  end if;

  -- Numéro court et croissant par soirée (« la 12 est prête ! »).
  perform pg_advisory_xact_lock(hashtext('tchin:' || p_party));
  select coalesce(max(numero), 0) + 1 into v_numero
  from public.commandes where party_id = p_party;

  insert into public.commandes
    (party_id, numero, invite, lieu, cocktail, quantite, note, jeton_hash)
  values
    (p_party, v_numero, v_invite, v_lieu, v_cocktail, p_quantite,
     left(btrim(coalesce(p_note, '')), 140), v_hash)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'numero', v_numero);
end
$$;

-- Les commandes de CE téléphone (jeton), avec leur place dans la file.
create or replace function public.mes_commandes(p_party text, p_jeton text) returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'soiree', public.soiree_publique(p_party),
    'commandes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'numero', c.numero, 'cocktail', c.cocktail,
        'quantite', c.quantite, 'lieu', c.lieu, 'note', c.note, 'statut', c.statut,
        'created_at', c.created_at, 'prepa_at', c.prepa_at, 'servie_at', c.servie_at,
        'notee', c.notee_at is not null,
        'devant', case when c.statut = 'en_attente' then (
          select count(*) from public.commandes o
          where o.party_id = c.party_id
            and o.statut in ('en_attente', 'en_preparation')
            and o.created_at < c.created_at
        ) else 0 end
      ) order by c.created_at desc)
      from public.commandes c
      where c.party_id = p_party and c.jeton_hash = public.tchin_hash(p_jeton)
    ), '[]'::jsonb)
  )
$$;

-- L'invité annule tant que le barman n'a pas commencé.
create or replace function public.commande_annuler(p_id uuid, p_jeton text) returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  update public.commandes set statut = 'annulee'
  where id = p_id and jeton_hash = public.tchin_hash(p_jeton) and statut = 'en_attente';
  if not found then raise exception 'annulation_impossible'; end if;
  return jsonb_build_object('ok', true);
end
$$;

-- L'avis de l'invité (1 à 5 par critère, au moins un). Noter vaut
-- « je l'ai reçu » : la commande passe servie si on avait oublié de le dire.
create or replace function public.commande_noter(
  p_id uuid, p_jeton text,
  p_cocktail integer default null, p_rapidite integer default null,
  p_service integer default null, p_experience integer default null,
  p_commentaire text default ''
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  if coalesce(p_cocktail, p_rapidite, p_service, p_experience) is null then
    raise exception 'note_manquante';
  end if;
  if exists (
    select 1 from unnest(array[p_cocktail, p_rapidite, p_service, p_experience]) as n
    where n is not null and n not between 1 and 5
  ) then
    raise exception 'note_invalide';
  end if;

  update public.commandes set
    note_cocktail = p_cocktail,
    note_rapidite = p_rapidite,
    note_service = p_service,
    note_experience = p_experience,
    commentaire = left(btrim(coalesce(p_commentaire, '')), 280),
    notee_at = now(),
    statut = 'servie',
    servie_at = coalesce(servie_at, now())
  where id = p_id and jeton_hash = public.tchin_hash(p_jeton) and statut <> 'annulee';
  if not found then raise exception 'commande_introuvable'; end if;
  return jsonb_build_object('ok', true);
end
$$;

-- ---------- Hôte : le bar ----------

-- Toutes les commandes de la soirée + sa configuration.
create or replace function public.bar_commandes(p_party text, p_cle text) returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform public.tchin_verifier_cle(p_party, p_cle);
  return jsonb_build_object(
    'soiree', public.soiree_publique(p_party),
    'commandes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'numero', c.numero, 'invite', c.invite, 'lieu', c.lieu,
        'cocktail', c.cocktail, 'quantite', c.quantite, 'note', c.note,
        'statut', c.statut, 'created_at', c.created_at,
        'prepa_at', c.prepa_at, 'servie_at', c.servie_at,
        'note_cocktail', c.note_cocktail, 'note_rapidite', c.note_rapidite,
        'note_service', c.note_service, 'note_experience', c.note_experience,
        'commentaire', c.commentaire, 'notee_at', c.notee_at
      ) order by c.created_at)
      from public.commandes c
      where c.party_id = p_party
    ), '[]'::jsonb)
  );
end
$$;

-- Faire avancer (ou reculer, ou annuler) une commande.
create or replace function public.commande_statut(
  p_party text, p_cle text, p_id uuid, p_statut text
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  perform public.tchin_verifier_cle(p_party, p_cle);
  if p_statut is null or p_statut not in ('en_attente', 'en_preparation', 'servie', 'annulee') then
    raise exception 'statut_invalide';
  end if;
  update public.commandes set
    statut = p_statut,
    prepa_at = case
      when p_statut = 'en_attente' then null
      when p_statut = 'en_preparation' then coalesce(prepa_at, now())
      else prepa_at
    end,
    servie_at = case when p_statut = 'servie' then coalesce(servie_at, now()) else null end
  where id = p_id and party_id = p_party;
  if not found then raise exception 'commande_introuvable'; end if;
  return jsonb_build_object('ok', true);
end
$$;

-- Retirer l'avis d'une commande (un essai, un avis déplacé) : la commande
-- reste servie, l'invité pourra noter à nouveau.
create or replace function public.commande_effacer_avis(
  p_party text, p_cle text, p_id uuid
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  perform public.tchin_verifier_cle(p_party, p_cle);
  update public.commandes set
    note_cocktail = null,
    note_rapidite = null,
    note_service = null,
    note_experience = null,
    commentaire = '',
    notee_at = null
  where id = p_id and party_id = p_party;
  if not found then raise exception 'commande_introuvable'; end if;
  return jsonb_build_object('ok', true);
end
$$;

-- Supprimer une commande pour de bon (un essai, un doublon) : elle disparaît
-- du bar, du bilan et du téléphone de l'invité.
create or replace function public.commande_supprimer(
  p_party text, p_cle text, p_id uuid
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  perform public.tchin_verifier_cle(p_party, p_cle);
  delete from public.commandes where id = p_id and party_id = p_party;
  if not found then raise exception 'commande_introuvable'; end if;
  return jsonb_build_object('ok', true);
end
$$;

-- Repartir de zéro (après les essais) : efface les commandes de la soirée.
create or replace function public.bar_reinitialiser(p_party text, p_cle text) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  perform public.tchin_verifier_cle(p_party, p_cle);
  delete from public.commandes where party_id = p_party;
  get diagnostics v_n = row_count;
  return jsonb_build_object('effacees', v_n);
end
$$;

-- ---------- Droits : seules ces fonctions sont ouvertes au public ----------

grant execute on function public.soiree_publique(text) to anon, authenticated;
grant execute on function public.soiree_enregistrer(text, text, text, jsonb) to anon, authenticated;
grant execute on function public.soiree_regler(text, text, boolean, text, jsonb, jsonb) to anon, authenticated;
grant execute on function public.commander(text, text, text, text, text, integer, text) to anon, authenticated;
grant execute on function public.mes_commandes(text, text) to anon, authenticated;
grant execute on function public.commande_annuler(uuid, text) to anon, authenticated;
grant execute on function public.commande_noter(uuid, text, integer, integer, integer, integer, text) to anon, authenticated;
grant execute on function public.bar_commandes(text, text) to anon, authenticated;
grant execute on function public.commande_statut(text, text, uuid, text) to anon, authenticated;
grant execute on function public.commande_effacer_avis(text, text, uuid) to anon, authenticated;
grant execute on function public.commande_supprimer(text, text, uuid) to anon, authenticated;
grant execute on function public.bar_reinitialiser(text, text) to anon, authenticated;

-- L'API voit tout de suite les nouvelles fonctions.
notify pgrst, 'reload schema';

-- ---------- Vérification de bout en bout (ne laisse aucune trace) ----------

do $$
declare
  v jsonb;
  v_id uuid;
  v_party text := 'autotest-' || substr(md5(random()::text), 1, 12);
  v_cle text := 'cle-autotest-0123456789';
  v_jeton text := 'jeton-autotest-0123456789';
begin
  perform public.soiree_enregistrer(v_party, v_cle, 'Autotest', '[{"nom": "Mojito"}]'::jsonb);
  perform public.soiree_regler(v_party, v_cle, null, null, '["Table 1"]'::jsonb, '["Bellini"]'::jsonb);

  v := public.commander(v_party, v_jeton, 'Testeur', 'Table 1', 'Mojito', 2, 'sans glace');
  v_id := (v ->> 'id')::uuid;
  if (v ->> 'numero')::int <> 1 then raise exception 'autotest : numéro de commande'; end if;

  begin
    perform public.commander(v_party, v_jeton, 'Testeur', 'Table 1', 'Bellini', 1, '');
    raise exception 'autotest : rupture ignorée';
  exception when others then
    if sqlerrm <> 'rupture' then raise; end if;
  end;

  v := public.mes_commandes(v_party, v_jeton);
  if jsonb_array_length(v -> 'commandes') <> 1 then raise exception 'autotest : suivi invité'; end if;

  perform public.commande_statut(v_party, v_cle, v_id, 'en_preparation');
  perform public.commande_statut(v_party, v_cle, v_id, 'servie');
  perform public.commande_noter(v_id, v_jeton, 5, 4, 5, 5, 'Parfait');

  v := public.bar_commandes(v_party, v_cle);
  if (v -> 'commandes' -> 0 ->> 'note_cocktail')::int <> 5 then raise exception 'autotest : avis'; end if;

  begin
    perform public.bar_commandes(v_party, 'mauvaise-cle-0123456789');
    raise exception 'autotest : une mauvaise clé est passée';
  exception when others then
    if sqlerrm <> 'cle_refusee' then raise; end if;
  end;

  perform public.commande_effacer_avis(v_party, v_cle, v_id);
  v := public.bar_commandes(v_party, v_cle);
  if v -> 'commandes' -> 0 ->> 'note_cocktail' is not null then raise exception 'autotest : avis retiré'; end if;

  perform public.commande_supprimer(v_party, v_cle, v_id);
  v := public.bar_commandes(v_party, v_cle);
  if jsonb_array_length(v -> 'commandes') <> 0 then raise exception 'autotest : commande supprimée'; end if;

  delete from public.commandes where party_id = v_party;
  delete from public.soirees where party_id = v_party;
end
$$;

select 'Bar en direct installé et vérifié ✓' as resultat;
