// ============================================================
// plan.js — Reliability Suite Pro
// Fichier unique : récupère le plan + redirige vers relia.html
//
// Résultat possible : "trial" | "essentiel" | "professionnel" 
//                     | "entreprise" | "ultimate" | null
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  'https://kquwgqcxauymzkgfcxpm.supabase.co',
  'sb_publishable_SSPUlrqY7jwjPzsw-K3Wrg_cQjsWHrx'
);

const VALID_PLANS = ['trial','essentiel','professionnel','entreprise','ultimate'];

// ── 1. Récupère le plan actif ─────────────────────────────────
async function getPlan() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, trial_started_at, plan_expires_at')
    .eq('id', session.user.id)
    .single();

  if (!profile) return null;
  const plan = profile.plan;
  if (!VALID_PLANS.includes(plan)) return null;

  // Trial → vérifier expiration 6 jours
  if (plan === 'trial') {
    const elapsed = (Date.now() - new Date(profile.trial_started_at)) / 86400000;
    return elapsed <= 6 ? 'trial' : null;
  }

  // Plan payant → vérifier expiration
  if (profile.plan_expires_at && Date.now() > new Date(profile.plan_expires_at)) {
    return null;
  }

  return plan;
}

// ── 2. Encode comme ton collègue ─────────────────────────────
function encodeText(text) {
  return btoa(
    new TextEncoder().encode(text)
      .reduce((data, byte) => data + String.fromCharCode(byte), "")
  );
}

// ── 3. Ouvre relia.html avec le plan encodé ──────────────────
async function openRelia() {
  const plan = await getPlan();

  // Non connecté ou expiré
  if (!plan) {
    window.location.href = 'login.html';
    return;
  }

  // Encoder et rediriger
  const encoded = encodeText(encodeURIComponent(plan));
  window.location.href = `relia.html?package=${encoded}`;
}

// ── Lancement automatique ─────────────────────────────────────
openRelia();

// ── Exposition globale ────────────────────────────────────────
window.getPlan    = getPlan;
window.openRelia  = openRelia;
