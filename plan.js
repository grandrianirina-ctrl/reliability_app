// ============================================================
// plan.js — Reliability Suite Pro (VERSION SÉCURISÉE)
// 1. Vérifie le plan côté serveur (Supabase fonction)
// 2. Gère les sessions uniques (anti multi-sessions)
// 3. Redirige vers relia.html avec ?package=<plan_encodé>
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  'https://kquwgqcxauymzkgfcxpm.supabase.co',
  'sb_publishable_SSPUlrqY7jwjPzsw-K3Wrg_cQjsWHrx'
);

const VALID_PLANS = ['trial','essentiel','professionnel','entreprise','ultimate'];
const SESSION_KEY = 'rsp_session_token';

// ── Génère un token de session unique ────────────────────────
async function generateSessionToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ── Enregistre la session (désactive les autres) ─────────────
async function registerSession(userId) {
  let token = localStorage.getItem(SESSION_KEY);
  if (!token) {
    token = await generateSessionToken();
    localStorage.setItem(SESSION_KEY, token);
  }

  const deviceInfo = `${navigator.userAgent} | ${screen.width}x${screen.height}`;

  await supabase.rpc('register_session', {
    p_user_id:     userId,
    p_token:       token,
    p_device_info: deviceInfo,
    p_ip:          null
  });

  return token;
}

// ── Valide la session actuelle ────────────────────────────────
async function validateSession(userId) {
  const token = localStorage.getItem(SESSION_KEY);
  if (!token) return false;

  const { data, error } = await supabase.rpc('validate_session', {
    p_user_id: userId,
    p_token:   token
  });

  return !error && data === true;
}

// ── Récupère le plan via fonction serveur (sécurisé) ─────────
async function getPlan(userId) {
  const { data, error } = await supabase.rpc('verify_user_plan', {
    p_user_id: userId
  });
  if (error || !data) return null;
  if (!VALID_PLANS.includes(data)) return null;
  return data;
}

// ── Encode comme ton collègue ─────────────────────────────────
function encodeText(text) {
  return btoa(
    new TextEncoder().encode(text)
      .reduce((data, byte) => data + String.fromCharCode(byte), "")
  );
}

// ── Fonction principale ───────────────────────────────────────
async function openRelia() {
  // 1. Vérifier auth
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    return;
  }

  const userId = session.user.id;

  // 2. Enregistrer/valider la session (anti multi-sessions)
  const token    = await registerSession(userId);
  const isValid  = await validateSession(userId);

  if (!isValid) {
    // Session révoquée → déconnecter
    await supabase.auth.signOut();
    localStorage.removeItem(SESSION_KEY);
    alert('Votre session a été ouverte sur un autre appareil. Veuillez vous reconnecter.');
    window.location.href = 'login.html';
    return;
  }

  // 3. Récupérer le plan côté serveur
  const plan = await getPlan(userId);

  if (!plan) {
    // Plan expiré ou invalide
    window.location.href = 'payment.html?reason=trial_expired';
    return;
  }

  // 4. Encoder et ouvrir relia.html
  const encoded = encodeText(encodeURIComponent(plan));
  console.log(`✅ RSP Plan: ${plan}`);
  window.location.href = `relia.html?package=${encoded}`;
}

// ── Vérifie périodiquement la session dans relia.html ────────
export async function watchSession(userId, intervalMs = 60000) {
  const check = async () => {
    const valid = await validateSession(userId);
    if (!valid) {
      alert('Votre session a été ouverte sur un autre appareil.');
      await supabase.auth.signOut();
      localStorage.removeItem(SESSION_KEY);
      window.location.href = 'login.html';
    }
  };
  setInterval(check, intervalMs);
}

// ── Export pour usage externe ─────────────────────────────────
export { getPlan, openRelia, validateSession, registerSession };

// ── Lancement automatique ─────────────────────────────────────
openRelia();

// ── Global ────────────────────────────────────────────────────
window.openRelia  = openRelia;
window.getPlan    = getPlan;
