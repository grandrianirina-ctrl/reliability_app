// ============================================================
// auth.js — Module central d'authentification Supabase
// Reliability Suite Pro
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://kquwgqcxauymzkgfcxpm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_SSPUlrqY7jwjPzsw-K3Wrg_cQjsWHrx';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Fingerprint appareil (anti double essai) ───────────────
export async function getDeviceFingerprint() {
  const components = [
    navigator.userAgent,
    navigator.language,
    screen.width + 'x' + screen.height,
    screen.colorDepth,
    new Date().getTimezoneOffset(),
    navigator.hardwareConcurrency || '',
    navigator.platform || ''
  ];
  const raw = components.join('|');
  const encoder = new TextEncoder();
  const data = encoder.encode(raw);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Vérifier si l'appareil a déjà utilisé un essai ─────────
export async function isDeviceTrialUsed(fingerprint) {
  // Vérifier localStorage d'abord (rapide)
  if (localStorage.getItem('rsp_trial_used') === fingerprint) return true;

  // Vérifier en base Supabase
  const { data } = await supabase
    .from('device_trials')
    .select('fingerprint')
    .eq('fingerprint', fingerprint)
    .single();

  return !!data;
}

// ─── Enregistrer l'essai sur cet appareil ────────────────────
export async function markDeviceTrialUsed(fingerprint, email) {
  localStorage.setItem('rsp_trial_used', fingerprint);
  await supabase.from('device_trials').insert({ fingerprint, email });
}

// ─── Créer le profil utilisateur après inscription ───────────
export async function createUserProfile(userId, email, fingerprint) {
  const now = new Date().toISOString();
  await supabase.from('profiles').insert({
    id: userId,
    email,
    trial_started_at: now,
    trial_used: true,
    device_fingerprint: fingerprint,
    plan: 'trial'
  });
}

// ─── Vérifier si l'essai est encore valide (24h) ─────────────
export async function checkTrialStatus(userId) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('trial_started_at, plan')
    .eq('id', userId)
    .single();

  if (!profile) return { valid: false, reason: 'no_profile' };
  if (profile.plan === 'pro' || profile.plan === 'enterprise') return { valid: true, plan: profile.plan };

  const started = new Date(profile.trial_started_at);
  const now = new Date();
  const hoursElapsed = (now - started) / (1000 * 60 * 60);

  if (hoursElapsed > 24) {
    return { valid: false, reason: 'expired', hoursElapsed };
  }

  const hoursLeft = Math.max(0, 24 - hoursElapsed);
  return { valid: true, plan: 'trial', hoursLeft };
}

// ─── Récupérer l'utilisateur courant ─────────────────────────
export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// ─── Déconnexion ─────────────────────────────────────────────
export async function logout() {
  await supabase.auth.signOut();
  window.location.href = 'login.html';
}
