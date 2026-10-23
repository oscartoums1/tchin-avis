/* ============================================================
   CONFIGURATION — une seule source pour toutes les pages du site.
   URL du projet Supabase et clé « anon » : faite pour être publiée,
   la base ne lui ouvre que ce qui est prévu (RLS + fonctions).
   Sans configuration, les avis partent par message (index.html) ;
   les commandes, elles, ont besoin de la base.
   ============================================================ */
const TCHIN_CONFIG = {
  SUPABASE_URL: "https://mhpliinqivsdxnkdkopw.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ocGxpaW5xaXZzZHhua2Rrb3B3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwMTM1ODIsImV4cCI6MjEwMzU4OTU4Mn0.yk7wrJAZ5tN_8G_l3sznQgsCxMEAj0exmCNtZqEVgpQ",
};
