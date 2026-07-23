// ════════════════════════════════════════════════════════════════
// session-guard.js
//
// Centralized session / expiration / idle-timer guard shared by the
// three analysis apps: Life_Data_Analysis.html, Reliability_Growth_
// Analysis.html, and Degradation_Analysis.html.
//
// Extracted verbatim from the three files' near-identical
// initSession() IIFEs (previously copy-pasted in each file). The
// ONLY thing that legitimately differs between the three tools —
// which package tier is required to access the file at all — is
// passed in via config.minTier. Everything else (idle timeout,
// real subscription/trial expiration, the expired/leave modals,
// the countdown badge, the beforeunload guard's tie-in) is single-
// sourced here.
//
// Usage, from the bottom of each analysis app's main <script> tag,
// in the exact spot the old initSession() IIFE used to run:
//
//   (async function initSessionGuard() {
//     const { initSession } = await import('./session-guard.js');
//     await initSession({ minTier: 'professional', onPackageApplied: applyPackage });
//   })();
//
// config:
//   minTier          — 'essential' | 'professional' | 'ultimate'.
//                       File-level access gate: a session below this
//                       tier is redirected to index.html before the
//                       tool renders. 'essential' effectively means
//                       "no gate" (every valid plan clears it).
//   onPackageApplied — the file's own applyPackage(pkg) callback —
//                       tool-specific tab/column/export visibility.
//                       Stays local to each file; this module only
//                       calls it once, at the same point the old
//                       inline code did.
//
// Depends on (must exist in the host page, same as before):
//   - #pkgInitOverlay, #sessionCountdown DOM elements
//   - window.lastPerTag (Map), set by the host file's own analysis
//     pipeline — used only to decide whether a user-initiated leave
//     needs a confirmation modal.
//   - ./plan.js (getPlanAndExpiration)
// ════════════════════════════════════════════════════════════════

const SESSION_DURATION_MS = 60 * 60 * 1000; // ← 1 h idle timeout, ALL packages including trial
const DEFAULT_TRIAL_EXPIRY_MS = 3 * 60 * 60 * 1000; // ← fallback only: used if a trial session somehow arrives with no real expiration (real trial length is 3h)
const SESSION_KEY = 'rs_session';
const VALID = ['essential', 'professional', 'ultimate', 'trial'];
const NO_REAL_EXPIRY = Number.MAX_SAFE_INTEGER;
const FILE_TIER_RANK = { essential: 0, professional: 1, ultimate: 2 };
const CANONICAL_TIERS = ['essential', 'professional', 'ultimate'];
const TIER_LABELS = { essential: 'Essential', professional: 'Professional', ultimate: 'Ultimate' };

// ── In-page renewal (Paddle) ──────────────────────────────────────
// Same token every other Paddle-integrated page in this app uses —
// public/client-safe, not a secret.
const PADDLE_TOKEN = 'live_4a6671ddf9b19f023a90ce0cb36';

// Fallback only — used if the live fetch from paddle_prices fails, so
// renewal still works even if that table is briefly unreachable. Real
// source of truth is always paddle_prices (admin.html's Prices tab).
const FALLBACK_PRICES = {
  essential_monthly:    { priceId: 'pri_01ktp3xx307qepx6f6xk2sqzpp', amount: 30,  currency: 'USD' },
  essential_annual:     { priceId: 'pri_01ktp46y44cs7ayt5h7cxt0qgb', amount: 300, currency: 'USD' },
  professional_monthly: { priceId: 'pri_01ktnhwg7zwyvrhearx3nxacbr', amount: 50,  currency: 'USD' },
  professional_annual:  { priceId: 'pri_01ktnkerfqfnp2sqnvv2k4t9yw', amount: 500, currency: 'USD' },
  ultimate_monthly:     { priceId: 'pri_01ktnkndn91851hx3hd8znxp2s', amount: 450, currency: 'USD' },
};
let PRICES = FALLBACK_PRICES;

async function loadLivePrices() {
  try {
    const { getActivePrices } = await import('./plan.js');
    const live = await getActivePrices();
    if (live && Object.keys(live).length) PRICES = { ...FALLBACK_PRICES, ...live };
  } catch (e) {
    console.error('Failed to load live prices, using fallback:', e.message);
  }
}
// Kicked off once, at module load — not per-session — so by the time
// any session actually reaches expiration (which takes real minutes),
// this has almost certainly already resolved and the renewal picker
// opens instantly instead of waiting on a network round-trip.
loadLivePrices();

let _paddleReady = null;
function ensurePaddleLoaded(onEvent) {
  if (window.Paddle) return Promise.resolve();
  if (_paddleReady) return _paddleReady;
  _paddleReady = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.paddle.com/paddle/v2/paddle.js';
    s.onload = () => {
      window.Paddle.Initialize({ token: PADDLE_TOKEN, eventCallback: onEvent });
      resolve();
    };
    s.onerror = () => reject(new Error('Failed to load Paddle.js'));
    document.head.appendChild(s);
  });
  return _paddleReady;
}

/* The database stores timestamps like "2026-07-06 05:00:00+00" — a
   space instead of 'T', and a short "+00" offset instead of "+00:00".
   Only the strict ISO 8601 extended form (with 'T') is guaranteed by
   spec to parse identically across browsers; the space/short-offset
   form works in some engines by lenient extension but isn't reliable
   everywhere. Normalize before parsing so this works consistently. */
function normalizeDbDatetime(raw) {
  if (!raw) return raw;
  let s = raw.trim();
  s = s.replace(' ', 'T');
  s = s.replace(/([+-]\d{2})$/, '$1:00');
  return s;
}

/* Keeps Tab/Shift+Tab cycling within a modal instead of escaping to
   page content hidden behind it. Computes the focusable list once
   at open time — intentionally only used on small, bounded-size
   dialogs (a handful of buttons/inputs). Self-contained copy of the
   host files' own _trapFocus() so this module has no dependency on
   host-page globals beyond what's documented above. */
function trapFocus(container) {
  const focusable = [...container.querySelectorAll('a[href],button,textarea,input,select,[tabindex]:not([tabindex="-1"])')]
    .filter(el => el.offsetParent !== null && !el.disabled);
  if (!focusable.length) return () => {};
  const first = focusable[0], last = focusable[focusable.length - 1];
  function handler(e) {
    if (e.key !== 'Tab') return;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  container.addEventListener('keydown', handler);
  return () => container.removeEventListener('keydown', handler);
}

export async function initSession(config) {
  const minTier = (config && config.minTier) || 'essential';
  const onPackageApplied = (config && config.onPackageApplied) || function () {};

  function goIndex(reason, force) {
    /* Automatic system exits (direct/timeout/expired) always proceed.
       User-initiated exits (force=false) show a confirmation modal first
       when analysis has already been computed. */
    function _doLeave() {
      /* Suppress the beforeunload guard only for expired — the user
         already made their choice in the "Trial Expired" modal, so the native
         "Leave site?" browser dialog must not appear on top of it.
         All other redirects (timeout, direct, user-initiated) leave
         beforeunload active so the browser dialog still fires normally. */
      window._beforeUnloadSuppressed = true; /* suppress native dialog for all app-triggered redirects */
      const _ov = document.getElementById('pkgInitOverlay');
      if (_ov) _ov.remove();
      sessionStorage.removeItem(SESSION_KEY);
      /* Idle timeout ('timeout') means the user is a known, identified
         account whose plan is perfectly fine — send them back to their
         dashboard, no different from any other normal visit.
         Real expiration ('expired') is different: the user just
         explicitly declined to renew (closed the expired dialog, the
         renewal picker, or backed out of checkout without paying).
         Sending them to dashboard.html would only show this exact same
         expired modal again there — a pointless loop, since renewal
         now happens right here in-page instead of on a separate
         dashboard/payment flow. index.html is the correct landing
         spot for someone who isn't purchasing right now. */
      const dest = (reason === 'timeout') ? 'dashboard.html' : 'index.html';
      window.location.href = dest + '?reason=' + reason;
    }

    const isAutomatic = (reason === 'direct' || reason === 'timeout' || reason === 'expired');
    const hasAnalysis = window.lastPerTag && window.lastPerTag.size > 0;

    if (isAutomatic || force || !hasAnalysis) {
      _doLeave();
      return;
    }

    /* Show leave-confirmation modal */
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:99998;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
    const box = document.createElement('div');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Leave page?');
    box.style.cssText = 'position:relative;background:var(--surface,#fff);border-radius:14px;padding:36px 40px;max-width:400px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.4);font-family:var(--font-sans,sans-serif)';
    box.innerHTML = `
      <div style="font-size:40px;margin-bottom:14px">⚠️</div>
      <h2 style="margin:0 0 10px;font-size:18px;font-weight:700;color:var(--text,#111)">Leave this page?</h2>
      <p style="margin:0 0 24px;font-size:13px;color:var(--text-2,#555);line-height:1.6">
        Your current analysis results will be lost.<br>You will be returned to the home page.
      </p>
      <div style="display:flex;gap:12px;justify-content:center">
        <button id="_leaveStayBtn" style="padding:10px 24px;background:var(--surface-2,#f1f5f9);color:var(--text,#111);border:1px solid var(--border,#ddd);border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">Stay</button>
        <button id="_leaveConfirmBtn" style="padding:10px 24px;background:#ef4444;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">Leave</button>
      </div>`;
    ov.appendChild(box);
    document.body.appendChild(ov);
    document.getElementById('_leaveStayBtn').focus();

    function cleanup() { ov.remove(); document.removeEventListener('keydown', _escKey); }
    function _escKey(e) { if (e.key === 'Escape') { cleanup(); } }
    document.addEventListener('keydown', _escKey);
    document.getElementById('_leaveStayBtn').addEventListener('click', cleanup);
    ov.addEventListener('click', e => { if (e.target === ov) cleanup(); });
    document.getElementById('_leaveConfirmBtn').addEventListener('click', () => {
      cleanup();
      _doLeave();
    });
  }

  /* Public entry point for any in-app button that navigates to index.html.
     Shows the leave-confirmation modal when analysis is computed. */
  window._userGoIndex = function (reason) { goIndex(reason || 'user', false); };

  function showExpiredDialog(expiredPkg) {
    const isTrial = (expiredPkg === 'trial');
    const tierLabel = TIER_LABELS[expiredPkg] || expiredPkg;
    const title = isTrial ? 'Trial Expired' : 'Subscription Expired';
    const body = isTrial
      ? `Your trial of <strong>ReliaSuite Ultimate</strong> has ended.<br>Purchase a licence to continue your reliability analysis.`
      : `Your <strong>ReliaSuite ${tierLabel}</strong> subscription has expired.<br>Renew to continue your reliability analysis.`;
    const btnText = isTrial ? 'Buy a Package' : 'Renew';

    /* Overlay */
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:99999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';

    const box = document.createElement('div');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', title);
    box.style.cssText = 'position:relative;background:var(--surface,#fff);border-radius:16px;padding:40px 48px;max-width:420px;width:90%;text-align:center;box-shadow:0 24px 64px rgba(0,0,0,.4);font-family:var(--font-sans,sans-serif)';
    box.innerHTML = `
      <button id="trialCloseBtn" class="chart-opts-close" title="Close (Esc)" style="position:absolute;top:8px;right:10px">✕</button>
      <div style="font-size:48px;margin-bottom:16px">⏱️</div>
      <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:var(--text,#111)">${title}</h2>
      <p style="margin:0 0 24px;font-size:14px;color:var(--text-2,#555);line-height:1.6">
        ${body}
      </p>
      <button id="trialBuyBtn" style="display:inline-block;padding:12px 32px;background:linear-gradient(135deg,#0f62fe,#4589ff);color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;letter-spacing:.02em">
        ${btnText}
      </button>
      <p style="margin:16px 0 0;font-size:11px;color:var(--text-3,#aaa)">Close this dialog to return to the home page.</p>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    document.getElementById('trialCloseBtn')?.focus();
    const untrap = trapFocus(box);

    /* Closing the dialog (X, Escape, or clicking the dark backdrop) is
       the ONLY thing that redirects to index.html now — no auto-timer.
       This keeps the modal on screen until the user makes a decision. */
    function closeAndRedirect() {
      overlay.remove();
      document.removeEventListener('keydown', escClose);
      untrap();
      goIndex('expired');
    }
    function escClose(e) {
      if (e.key === 'Escape') closeAndRedirect();
    }

    document.getElementById('trialBuyBtn').addEventListener('click', () => {
      // In-page renewal instead of navigating to payment.html — a full
      // page load would throw away any in-progress analysis (loaded
      // data, computed results). This closes the expired dialog and
      // opens the plan/cycle picker + Paddle checkout right here, same
      // pattern dashboard.html uses for trial-expiry/upgrade.
      overlay.remove();
      document.removeEventListener('keydown', escClose);
      untrap();
      showRenewalPicker(expiredPkg, isTrial);
    });
    document.getElementById('trialCloseBtn').addEventListener('click', closeAndRedirect);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeAndRedirect(); /* backdrop only, not the box */
    });
    document.addEventListener('keydown', escClose);
  }

  /* ── Plan + billing cycle picker ──────────────────────────────
     Offers the expired tier itself (a straight renewal) plus any
     higher tier (an upgrade instead) — unlike dashboard.html's own
     upgrade picker, which excludes the current tier, this one must
     include it since renewing the SAME plan is the primary reason
     someone lands here. Trial expiry offers all three, same as the
     old "Buy a Package" flow always did. */
  function showRenewalPicker(expiredPkg, isTrial) {
    const startIdx = isTrial ? 0 : Math.max(CANONICAL_TIERS.indexOf(expiredPkg), 0);
    const tiers = CANONICAL_TIERS.slice(startIdx);
    let cycle = 'monthly';

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:99999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
    const box = document.createElement('div');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Choose your plan');
    box.style.cssText = 'position:relative;background:var(--surface,#fff);border-radius:16px;padding:32px 36px;max-width:440px;width:90%;box-shadow:0 24px 64px rgba(0,0,0,.4);font-family:var(--font-sans,sans-serif)';

    function cardsHtml() {
      return tiers.map(tier => {
        const eff = (tier === 'ultimate') ? 'monthly' : cycle; // Ultimate has no annual price
        const entry = PRICES[tier + '_' + (eff === 'annual' ? 'annual' : 'monthly')];
        const amount = entry ? Math.round(eff === 'monthly' ? entry.amount : entry.amount / 12) : '—';
        return `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:var(--surface-2,#f8fafc);border:1px solid var(--border,#e2e8f0);border-radius:10px;margin-bottom:10px">
            <div>
              <div style="font-weight:700;font-size:14px;color:var(--text,#111)">${TIER_LABELS[tier]}</div>
              <div style="font-size:12px;color:var(--text-2,#666)">$${amount}/month</div>
              <a href="payment.html?plan=${tier}" target="_blank" rel="noopener" style="font-size:11px;color:#4589ff;text-decoration:none">More info →</a>
            </div>
            <button data-tier="${tier}" class="_renewChoose" style="padding:9px 18px;background:linear-gradient(135deg,#0f62fe,#4589ff);color:#fff;border:none;border-radius:7px;font-size:12.5px;font-weight:600;cursor:pointer">Choose</button>
          </div>`;
      }).join('');
    }

    box.innerHTML = `
      <button id="renewCloseBtn" class="chart-opts-close" title="Close (Esc)" style="position:absolute;top:8px;right:10px">✕</button>
      <h2 style="margin:0 0 4px;font-size:18px;font-weight:700;color:var(--text,#111)">Choose your plan</h2>
      <p style="margin:0 0 16px;font-size:12.5px;color:var(--text-2,#666)">Your analysis on this page is kept — nothing is lost.</p>
      <div style="display:flex;gap:6px;background:var(--surface-2,#f1f5f9);border-radius:8px;padding:4px;margin-bottom:16px">
        <button id="renewMonthlyBtn" style="flex:1;padding:8px 10px;border:none;border-radius:6px;font-size:12.5px;font-weight:600;cursor:pointer;background:#0f62fe;color:#fff">Monthly</button>
        <button id="renewAnnualBtn" style="flex:1;padding:8px 10px;border:none;border-radius:6px;font-size:12.5px;font-weight:600;cursor:pointer;background:transparent;color:var(--text-2,#666)">Annual <span style="color:#22c55e;font-size:10.5px">save ~17%</span></button>
      </div>
      <div id="renewCards">${cardsHtml()}</div>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    document.getElementById('renewCloseBtn')?.focus();
    const untrap = trapFocus(box);

    function close() {
      overlay.remove();
      document.removeEventListener('keydown', escClose);
      untrap();
    }
    function escClose(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', escClose);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.getElementById('renewCloseBtn').addEventListener('click', () => {
      close();
      showExpiredDialog(expiredPkg); // back to the expired dialog, not silently gone
    });

    function wireCards() {
      overlay.querySelectorAll('._renewChoose').forEach(btn => {
        btn.addEventListener('click', () => startCheckout(btn.dataset.tier, cycle, close));
      });
    }
    wireCards();

    function setCycle(c) {
      cycle = c;
      const on = 'background:#0f62fe;color:#fff', off = 'background:transparent;color:var(--text-2,#666)';
      document.getElementById('renewMonthlyBtn').style.cssText = 'flex:1;padding:8px 10px;border:none;border-radius:6px;font-size:12.5px;font-weight:600;cursor:pointer;' + (c === 'monthly' ? on : off);
      document.getElementById('renewAnnualBtn').style.cssText = 'flex:1;padding:8px 10px;border:none;border-radius:6px;font-size:12.5px;font-weight:600;cursor:pointer;' + (c === 'annual' ? on : off);
      document.getElementById('renewCards').innerHTML = cardsHtml();
      wireCards();
    }
    document.getElementById('renewMonthlyBtn').addEventListener('click', () => setCycle('monthly'));
    document.getElementById('renewAnnualBtn').addEventListener('click', () => setCycle('annual'));
  }

  /* ── Paddle checkout ── */
  async function startCheckout(tier, cycle, closePicker) {
    const effCycle = (tier === 'ultimate') ? 'monthly' : cycle;
    const priceEntry = PRICES[tier + '_' + (effCycle === 'annual' ? 'annual' : 'monthly')];
    if (!priceEntry || !priceEntry.priceId) {
      alert('This plan is not available for checkout right now. Please contact support.');
      return;
    }
    try {
      await ensurePaddleLoaded(handlePaddleEvent);
    } catch (e) {
      alert('Could not load the checkout. Please check your connection and try again.');
      return;
    }
    closePicker();
    Paddle.Checkout.open({
      items: [{ priceId: priceEntry.priceId, quantity: 1 }],
      settings: { theme: 'dark' },
      customData: { supabase_user_id: userId, plan: tier, billing_cycle: effCycle }
    });
  }

  function handlePaddleEvent(e) {
    if (e.name === 'checkout.completed') {
      const plan  = e.data?.customData?.plan;
      const cycle = e.data?.customData?.billing_cycle || 'monthly';
      onCheckoutCompleted(plan, cycle);
    } else if (e.name === 'checkout.closed') {
      // Cancelled without paying — nothing was purchased, so re-show
      // the expired dialog rather than leaving no modal on screen at
      // all with the app still in its expired state.
      const stillExpiredPkg = e.data?.customData?.plan || pkg;
      showExpiredDialog(stillExpiredPkg);
    }
  }

  async function onCheckoutCompleted(plan, cycle) {
    const newExpiresAt = new Date();
    if (cycle === 'annual') newExpiresAt.setFullYear(newExpiresAt.getFullYear() + 1);
    else newExpiresAt.setMonth(newExpiresAt.getMonth() + 1);

    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const supabase = createClient(
      'https://kquwgqcxauymzkgfcxpm.supabase.co',
      'sb_publishable_SSPUlrqY7jwjPzsw-K3Wrg_cQjsWHrx'
    );
    const { error } = await supabase.rpc('confirm_plan_purchase', {
      p_user_id: userId, p_plan: plan, p_expires_at: newExpiresAt.toISOString()
    });
    if (error) console.error('confirm_plan_purchase error:', error.message);

    showRenewalSuccess(plan, newExpiresAt);
  }

  /* ── Success confirmation — closes everything, unlocks the UI live
     (no reload), and hands control back to the tick() loop so idle/
     expiration monitoring resumes under the new plan. ── */
  function showRenewalSuccess(plan, newExpiresAt) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:99999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
    const box = document.createElement('div');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Renewal successful');
    box.style.cssText = 'position:relative;background:var(--surface,#fff);border-radius:16px;padding:40px 48px;max-width:420px;width:90%;text-align:center;box-shadow:0 24px 64px rgba(0,0,0,.4);font-family:var(--font-sans,sans-serif)';
    const dateStr = newExpiresAt.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    box.innerHTML = `
      <div style="font-size:48px;margin-bottom:16px">✅</div>
      <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:var(--text,#111)">You're all set</h2>
      <p style="margin:0 0 24px;font-size:14px;color:var(--text-2,#555);line-height:1.6">
        <strong>${TIER_LABELS[plan] || plan}</strong> is active until <strong>${dateStr}</strong>.<br>Your analysis on this page is exactly as you left it.
      </p>
      <button id="renewContinueBtn" style="display:inline-block;padding:12px 32px;background:linear-gradient(135deg,#0f62fe,#4589ff);color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;letter-spacing:.02em">Continue analyzing</button>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    const untrap = trapFocus(box);
    document.getElementById('renewContinueBtn')?.focus();
    document.getElementById('renewContinueBtn').addEventListener('click', () => {
      overlay.remove();
      untrap();
      resumeAfterRenewal(plan, newExpiresAt.getTime());
    });
  }

  /* ── The ONLY URL parameter between dashboard.html and this app is the
     user's id — already a unique, opaque database identifier, so it's
     sent plain, with no encoding. Package and expiration are never in
     the URL; they're read live from the database by that id, via the
     shared plan.js module (same one dashboard.html uses). ── */
  const params = new URLSearchParams(window.location.search);
  const userId = params.get('id');

  let pkg, expiresAt, subExpiresAt;

  if (!userId) {
    /* No id at all → genuine direct access. */
    goIndex('direct');
    return;
  }

  const { getPlanAndExpiration } = await import('./plan.js');
  const { plan, expiresAt: subExpiresAtRaw } = await getPlanAndExpiration(userId);

  if (!plan || !VALID.includes(plan)) {
    /* Invalid id, deleted user, RPC error, or a plan value plan.js
       doesn't recognize — treated the same as genuine direct access. */
    goIndex('direct');
    return;
  }

  pkg = plan;
  expiresAt = Date.now() + SESSION_DURATION_MS; /* idle timeout — same for every package, trial included */
  const subT = subExpiresAtRaw ? Date.parse(normalizeDbDatetime(subExpiresAtRaw)) : NaN;
  subExpiresAt = isFinite(subT)
    ? subT
    : (pkg === 'trial' ? Date.now() + DEFAULT_TRIAL_EXPIRY_MS : NO_REAL_EXPIRY);

  /* ── File-level access gate (v4 package matrix) ──
     A session below the tool's minTier is redirected back to
     index.html — the file never renders for it, even if it reaches
     this URL directly or via a stale bookmark. minTier:'essential'
     means no gate (every valid plan clears rank 0). */
  const effForGate = pkg === 'trial' ? 'ultimate' : pkg;
  if ((FILE_TIER_RANK[effForGate] ?? -1) < FILE_TIER_RANK[minTier]) {
    goIndex('upgrade_required');
    return;
  }

  window.RELIACAL_PACKAGE = pkg;
  onPackageApplied(pkg);
  /* Remove the package-init overlay now that the view is fully applied */
  const _pkgOverlay = document.getElementById('pkgInitOverlay');
  if (_pkgOverlay) _pkgOverlay.remove();

  /* ── Idle/activity timer — same for every package, trial included ──
     Throttled: mousemove/scroll can fire dozens of times per second,
     and there's no longer anything to persist to sessionStorage — a
     reload just re-queries the database fresh, computing a brand new
     idle window anyway. */
  let _lastResetTimerAt = 0;
  const RESET_TIMER_THROTTLE_MS = 5000;
  function resetTimer() {
    const now = Date.now();
    if (now - _lastResetTimerAt < RESET_TIMER_THROTTLE_MS) return;
    _lastResetTimerAt = now;
    expiresAt = now + SESSION_DURATION_MS;
  }

  ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click']
    .forEach(ev => window.addEventListener(ev, resetTimer, { passive: true }));

  /* Called once the renewal success modal is dismissed. Updates the
     SAME pkg/subExpiresAt/expiresAt variables tick() already reads
     from its closure (showExpiredDialog's own parameter is named
     expiredPkg specifically so it can't shadow pkg here), re-applies
     the new tier's UI live via onPackageApplied — no reload, so
     whatever the user was analyzing is untouched — and resumes the
     tick() loop, which stopped entirely the moment it first found the
     old subscription expired. */
  function resumeAfterRenewal(newPlan, newSubExpiresAtMs) {
    pkg = newPlan;
    subExpiresAt = newSubExpiresAtMs;
    expiresAt = Date.now() + SESSION_DURATION_MS;
    window.RELIACAL_PACKAGE = pkg;
    onPackageApplied(pkg);
    tick();
  }

  /* Tick every second — two independent clocks:
       subExpiresAt : real expiration date (subscription/trial). Absolute,
                      never resets. Takes priority — shows the modal and
                      lets the user decide when to leave.
       expiresAt    : idle/activity timeout. Resets on interaction above.
                      Fires a direct redirect, no modal — just "come back
                      when you're active again". */
  const badge = document.getElementById('sessionCountdown');
  function tick() {
    const now = Date.now();
    if (subExpiresAt - now <= 0) { showExpiredDialog(pkg); return; }
    if (expiresAt - now <= 0) { goIndex('timeout'); return; }

    if (badge) {
      /* Show the countdown to whichever clock will fire first — that's
         the one actually relevant to the user right now. */
      const remaining = Math.min(expiresAt, subExpiresAt) - now;
      const soonIsReal = subExpiresAt <= expiresAt;
      const m = Math.floor(remaining / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      badge.textContent = m + ':' + String(s).padStart(2, '0');
      /* Real expiration approaching: always red to signal urgency */
      badge.style.color = (soonIsReal || remaining < 30000) ? '#e74c3c' : '';
    }

    setTimeout(tick, 1000);
  }
  tick();
}
