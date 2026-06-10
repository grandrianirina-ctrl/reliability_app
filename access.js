// ============================================================
// access.js — Reliability Suite Pro
// Gestion des accès par plan + query params
// Usage dans relia.html :
//   import { checkPageAccess, hasAccess, PLANS } from './access.js'
//   const { plan, authorized } = await checkPageAccess()
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  'https://kquwgqcxauymzkgfcxpm.supabase.co',
  'sb_publishable_SSPUlrqY7jwjPzsw-K3Wrg_cQjsWHrx'
);

// ── Plans ─────────────────────────────────────────────────────
export const PLANS = {
  trial:         { label:'Trial 3h',      maxUsers:1,   durationHrs:3,    color:'#f59e0b' },
  essentiel:     { label:'Essentiel',     maxUsers:1,   durationHrs:null, color:'#0ea5e9' },
  professionnel: { label:'Professionnel', maxUsers:1,   durationHrs:null, color:'#10b981' },
  entreprise:    { label:'Entreprise',    maxUsers:10,  durationHrs:null, color:'#8b5cf6' },
  ultimate:      { label:'Ultimate',      maxUsers:999, durationHrs:null, color:'#f43f5e' },
};

// ── Prix Paddle ───────────────────────────────────────────────
export const PADDLE_PRICES = {
  essentiel_monthly:     'pri_01ktp3xx307qepx6f6xk2sqzpp',
  essentiel_annual:      'pri_01ktp46y44cs7ayt5h7cxt0qgb',
  professionnel_monthly: 'pri_01ktnhwg7zwyvrhearx3nxacbr',
  professionnel_annual:  'pri_01ktnkerfqfnp2sqnvv2k4t9yw',
  entreprise_monthly:    'pri_01ktnkndn91851hx3hd8znxp2s',
};

// ── Types d'accès (query param: type=xxx) ─────────────────────
// Correspond aux features de relia.html
export const ACCESS_TYPES = {
  // type=life_data → accessible dès trial
  life_data:            ['trial','essentiel','professionnel','entreprise','ultimate'],
  reliability_metrics:  ['trial','essentiel','professionnel','entreprise','ultimate'],
  probability_plots:    ['trial','essentiel','professionnel','entreprise','ultimate'],
  confidence_bounds:    ['trial','essentiel','professionnel','entreprise','ultimate'],
  advanced_reporting:   ['essentiel','entreprise','ultimate'],
  degradation:          ['professionnel','entreprise','ultimate'],
  preventive_maint:     ['entreprise','ultimate'],
  spare_parts:          ['entreprise','ultimate'],
  multi_asset:          ['ultimate'],
  reliability_growth:   ['ultimate'],
  portfolio_multisite:  ['ultimate'],
  // type=full_package → accès complet
  full_package:         ['entreprise','ultimate'],
  // type=analysis_only → tout sauf maintenance/stocks
  analysis_only:        ['essentiel','professionnel','entreprise','ultimate'],
};

// ── Vérification d'accès simple ───────────────────────────────
/**
 * @param {string} userPlan   ex: 'essentiel'
 * @param {string} accessType ex: 'degradation'
 * @returns {boolean}
 */
export function hasAccess(userPlan, accessType) {
  if (!userPlan || !accessType) return false;
  return ACCESS_TYPES[accessType]?.includes(userPlan) ?? false;
}

// ── Vérification Trial ────────────────────────────────────────
export function checkTrial(trialStartedAt) {
  const elapsed = (Date.now() - new Date(trialStartedAt)) / 3600000;
  const hoursLeft = Math.max(0, 3 - elapsed);
  return {
    valid:      elapsed < 3,
    hoursLeft:  hoursLeft.toFixed(1),
    minutesLeft: Math.floor(hoursLeft * 60),
    pct:        Math.max(0, (hoursLeft / 3) * 100).toFixed(0)
  };
}

// ── Plan minimum requis ───────────────────────────────────────
export function requiredPlan(accessType) {
  const order = ['trial','essentiel','professionnel','entreprise','ultimate'];
  return order.find(p => ACCESS_TYPES[accessType]?.includes(p)) || 'ultimate';
}

// ══════════════════════════════════════════════════════════════
// FONCTION PRINCIPALE : checkPageAccess()
// À appeler au chargement de relia.html
//
// Lit les query params :
//   ?access=entreprise&type=full_package
//   ?access=trial&type=life_data
//
// Vérifie :
//   1. L'utilisateur est connecté (Supabase)
//   2. Son plan réel en base correspond au param 'access'
//   3. Son plan donne accès au type demandé
//   4. Si trial : pas expiré
//
// Retourne :
//   { authorized, plan, type, user, profile, redirect }
// ══════════════════════════════════════════════════════════════
export async function checkPageAccess() {
  const params  = new URLSearchParams(window.location.search);
  const reqPlan = params.get('access') || null;  // ex: 'entreprise'
  const reqType = params.get('type')   || null;  // ex: 'full_package'

  // 1. Auth check
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return { authorized: false, redirect: 'login.html', reason: 'not_logged_in' };
  }

  const user = session.user;

  // 2. Récupérer le profil
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, trial_started_at')
    .eq('id', user.id)
    .single();

  const realPlan = profile?.plan || 'trial';

  // 3. Vérifier trial expiré
  if (realPlan === 'trial') {
    const trial = checkTrial(profile?.trial_started_at || new Date().toISOString());
    if (!trial.valid) {
      return {
        authorized: false,
        redirect: `payment.html?reason=trial_expired`,
        reason: 'trial_expired',
        plan: realPlan,
        user,
        profile,
        trial
      };
    }
  }

  // 4. Vérifier cohérence query param vs plan réel
  // Si ?access= fourni, vérifier que le plan réel >= plan demandé
  if (reqPlan && reqPlan !== realPlan) {
    const order = ['trial','essentiel','professionnel','entreprise','ultimate'];
    const realIdx = order.indexOf(realPlan);
    const reqIdx  = order.indexOf(reqPlan);
    if (realIdx < reqIdx) {
      // Plan réel insuffisant → paiement
      return {
        authorized: false,
        redirect: `payment.html?reason=upgrade_required&required=${reqPlan}&type=${reqType||''}`,
        reason: 'upgrade_required',
        requiredPlan: reqPlan,
        plan: realPlan,
        user,
        profile
      };
    }
  }

  // 5. Vérifier accès au type de feature
  if (reqType && !hasAccess(realPlan, reqType)) {
    const minPlan = requiredPlan(reqType);
    return {
      authorized: false,
      redirect: `payment.html?reason=feature_locked&required=${minPlan}&type=${reqType}`,
      reason: 'feature_locked',
      requiredPlan: minPlan,
      plan: realPlan,
      user,
      profile
    };
  }

  // ✅ Accès autorisé
  return {
    authorized: true,
    plan: realPlan,
    type: reqType,
    user,
    profile,
    trial: realPlan === 'trial' ? checkTrial(profile?.trial_started_at) : null
  };
}

// ── Helpers de navigation ─────────────────────────────────────

/**
 * Ouvre relia.html avec les bons params selon le plan
 * @param {string} plan   ex: 'entreprise'
 * @param {string} type   ex: 'full_package'
 */
export function openApp(plan, type) {
  window.location.href = `relia.html?access=${plan}&type=${type || defaultType(plan)}`;
}

/**
 * Type par défaut selon le plan
 */
export function defaultType(plan) {
  switch(plan) {
    case 'trial':         return 'life_data';
    case 'essentiel':     return 'analysis_only';
    case 'professionnel': return 'degradation';
    case 'entreprise':    return 'full_package';
    case 'ultimate':      return 'full_package';
    default:              return 'life_data';
  }
}

/**
 * Redirige vers payment.html avec contexte
 */
export function redirectToPayment(requiredPlan, type) {
  window.location.href = `payment.html?reason=upgrade_required&required=${requiredPlan}&type=${type||''}`;
}

// ── Exposition globale (sans import) ─────────────────────────
if (typeof window !== 'undefined') {
  window.RSP = {
    PLANS, PADDLE_PRICES, ACCESS_TYPES,
    hasAccess, checkTrial, requiredPlan,
    checkPageAccess, openApp, defaultType, redirectToPayment
  };
}
