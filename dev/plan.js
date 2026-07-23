// ============================================================
// plan.js — Reliability Suite Pro
// Shared verification module — imported by dashboard.html AND
// all three analysis apps (Life_Data_Analysis.html,
// Reliability_Growth_Analysis.html, Degradation_Analysis.html).
//
// Package and expiration are read LIVE from the database by
// user id — never passed as URL parameters. Each caller supplies
// the user id (dashboard.html has it from the authenticated
// Supabase session; the analysis apps receive it as a plain,
// unencoded ?id= URL parameter since it's already an opaque,
// unique database identifier).
//
// Multi-session enforcement (registerSession/validateSession) is
// kept here, defined and exported, but intentionally NOT called
// by anything yet — out of scope for the current integration.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  'https://kquwgqcxauymzkgfcxpm.supabase.co',
  'sb_publishable_SSPUlrqY7jwjPzsw-K3Wrg_cQjsWHrx'
);

/* Must match the analysis files' own VALID array exactly — the
   database is expected to store these English tier names directly,
   with no translation step anywhere in this pipeline. */
const VALID_PLANS = ['trial', 'essential', 'professional', 'ultimate'];
const SESSION_KEY = 'rsp_session_token';

// ── Generates a unique session token (multi-session — not currently used) ──
async function generateSessionToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Registers the session (disables others) — not currently used ──
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

// ── Validates the current session — not currently used ──
async function validateSession(userId) {
  const token = localStorage.getItem(SESSION_KEY);
  if (!token) return false;

  const { data, error } = await supabase.rpc('validate_session', {
    p_user_id: userId,
    p_token:   token
  });

  return !error && data === true;
}

// ── Periodically checks the session — not currently used ──
async function watchSession(userId, intervalMs = 60000) {
  const check = async () => {
    const valid = await validateSession(userId);
    if (!valid) {
      alert('Your session was opened on another device.');
      await supabase.auth.signOut();
      localStorage.removeItem(SESSION_KEY);
      window.location.href = 'index.html?login=1';
    }
  };
  setInterval(check, intervalMs);
}

/* ── Retrieves the server-verified plan ──
   Returns one of VALID_PLANS if the plan is currently active, or
   null if the plan is invalid, expired, or the RPC call failed.
   This is the single source of truth for "is this user allowed
   in right now" — callers should never fall back to a client-side
   plan value if this returns null. */
async function getPlan(userId) {
  const { data, error } = await supabase.rpc('verify_user_plan', {
    p_user_id: userId
  });
  if (error || !data) return null;
  if (!VALID_PLANS.includes(data)) return null;
  return data;
}

/* ── Retrieves the plan's expiration date ──
   Returns a timestamptz ISO string, or null if the plan has no
   fixed expiration (unlimited) or the RPC call failed. */
async function getPlanExpiration(userId) {
  const { data, error } = await supabase.rpc('get_plan_expiration', {
    p_user_id: userId
  });
  if (error) return null;
  return data; // timestamptz ISO string, ou null
}

/* ── Convenience: both values in one round-trip ──
   The typical shape every caller actually needs — verified plan
   tier plus its expiration, fetched together. plan === null means
   "not allowed in" regardless of what expiresAt came back as. */
async function getPlanAndExpiration(userId) {
  const [planResult, expResult] = await Promise.all([
    supabase.rpc('verify_user_plan', { p_user_id: userId }),
    supabase.rpc('get_plan_expiration', { p_user_id: userId })
  ]);
  const rawPlan = planResult.error ? null : planResult.data;
  const plan = (rawPlan && VALID_PLANS.includes(rawPlan)) ? rawPlan : null;
  const expiresAt = (plan && !expResult.error) ? expResult.data : null;
  return { plan, expiresAt };
}

/* ── Sign out ──
   Thin wrapper so callers (the analysis apps' logout button) don't need
   their own Supabase client just for this one call. */
async function signOut() {
  await supabase.auth.signOut();
}

/* ── Fetches live Paddle prices ──
   Public read — RLS allows anon access to paddle_prices rows where
   is_active = true, which is what lets index.html and payment.html
   show real prices and pick the right Paddle Price ID for checkout
   before the visitor is even logged in.

   Used by index.html, payment.html and dashboard.html so the displayed
   amount and the priceId sent to Paddle.Checkout.open() both come from
   the same place (the paddle_prices table, managed from admin.html)
   instead of being hardcoded separately in every file.

   Returns a map keyed "<plan>_monthly" / "<plan>_annual", e.g.
   { essential_monthly: { priceId, amount, currency }, ... },
   or null if the fetch fails — callers should fall back to their own
   last-known values rather than break the page on a null result. */
async function getActivePrices() {
  const { data, error } = await supabase
    .from('paddle_prices')
    .select('plan, billing_cycle, amount, currency, paddle_price_id')
    .eq('is_active', true);
  if (error || !data) return null;

  const map = {};
  for (const p of data) {
    const cycleKey = p.billing_cycle === 'yearly' ? 'annual' : 'monthly';
    map[`${p.plan}_${cycleKey}`] = {
      priceId:  p.paddle_price_id,
      amount:   Number(p.amount),
      currency: p.currency || 'USD',
    };
  }
  return map;
}

export {
  getPlan,
  getPlanExpiration,
  getPlanAndExpiration,
  registerSession,
  validateSession,
  watchSession,
  signOut,
  getActivePrices
};
