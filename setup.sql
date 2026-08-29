-- ============================================================
-- Tchin — la table des avis de soirée.
-- À exécuter UNE FOIS dans Supabase : SQL Editor → New query →
-- coller ce fichier → Run.
-- ============================================================

create table if not exists public.avis (
  id uuid primary key default gen_random_uuid(),
  -- L'identifiant de la soirée (l'UUID de la Party dans l'app, sans tirets).
  party_id text not null,
  party_name text not null default '',
  guest_name text not null,
  cocktail text not null,
  rating smallint not null check (rating between 1 and 10),
  comment text not null default '',
  created_at timestamptz not null default now()
);

-- Un invité = un avis par cocktail et par soirée. Ré-envoyer met à jour
-- (le site poste avec « resolution=merge-duplicates »).
create unique index if not exists avis_unique
  on public.avis (party_id, guest_name, cocktail);

create index if not exists avis_party_idx on public.avis (party_id);

-- RLS : les invités (clé anon) peuvent déposer et lire les avis,
-- rien d'autre — ni modifier ni supprimer.
alter table public.avis enable row level security;

drop policy if exists "avis_insert_anon" on public.avis;
create policy "avis_insert_anon" on public.avis
  for insert to anon with check (true);

drop policy if exists "avis_update_anon" on public.avis;
create policy "avis_update_anon" on public.avis
  for update to anon using (true) with check (true);
  -- nécessaire pour le « merge-duplicates » (mise à jour de son propre avis)

drop policy if exists "avis_select_anon" on public.avis;
create policy "avis_select_anon" on public.avis
  for select to anon using (true);
