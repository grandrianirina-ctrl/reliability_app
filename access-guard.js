// ============================================================
// access-guard.js
// À coller au début de relia.html (dans un <script type="module">)
//
// USAGE dans relia.html :
// ============================================================
//
// <script type="module">
//   import { checkPageAccess, hasAccess } from './access.js';
//
//   // 1. Vérifier l'accès au chargement
//   const access = await checkPageAccess();
//
//   if (!access.authorized) {
//     window.location.href = access.redirect;
//     return;
//   }
//
//   // 2. Accès OK → initialiser l'app avec les infos
//   const { plan, type, user, profile, trial } = access;
//
//   // 3. Afficher/masquer les modules selon le plan
//   if (hasAccess(plan, 'degradation')) {
//     document.getElementById('tab-degradation').style.display = 'block';
//   }
//   if (hasAccess(plan, 'preventive_maint')) {
//     document.getElementById('tab-maintenance').style.display = 'block';
//   }
//   if (hasAccess(plan, 'spare_parts')) {
//     document.getElementById('tab-stocks').style.display = 'block';
//   }
//   if (hasAccess(plan, 'multi_asset')) {
//     document.getElementById('tab-fleet').style.display = 'block';
//   }
//
//   // 4. Afficher le timer trial si applicable
//   if (plan === 'trial' && trial) {
//     showTrialTimer(trial.hoursLeft, trial.pct);
//   }
// </script>
//
// ============================================================
// LIENS DE NAVIGATION DEPUIS DASHBOARD → RELIA.HTML
// ============================================================
//
// Depuis le dashboard, les boutons utilisent :
//
//   trial:
//     relia.html?access=trial&type=life_data
//
//   essentiel:
//     relia.html?access=essentiel&type=analysis_only
//
//   professionnel:
//     relia.html?access=professionnel&type=degradation
//
//   entreprise:
//     relia.html?access=entreprise&type=full_package
//
//   ultimate:
//     relia.html?access=ultimate&type=full_package
//
// ============================================================
// EXEMPLE DE MODULE VERROUILLÉ DANS RELIA.HTML
// ============================================================
//
//  function lockModule(moduleId, requiredPlan) {
//    const el = document.getElementById(moduleId);
//    if (!el) return;
//    el.style.position = 'relative';
//    el.style.pointerEvents = 'none';
//    el.style.opacity = '0.4';
//    const overlay = document.createElement('div');
//    overlay.style.cssText = `
//      position:absolute;inset:0;display:flex;align-items:center;
//      justify-content:center;background:rgba(10,14,26,.7);
//      border-radius:inherit;cursor:pointer;z-index:10;
//    `;
//    overlay.innerHTML = `
//      <div style="text-align:center;padding:20px">
//        <div style="font-size:28px;margin-bottom:8px">🔒</div>
//        <div style="font-size:13px;font-weight:700;color:#f0f4ff">
//          Plan ${requiredPlan} requis
//        </div>
//        <button onclick="window.location.href='payment.html?required=${requiredPlan}'"
//          style="margin-top:12px;padding:8px 18px;background:#0ea5e9;border:none;
//          border-radius:7px;color:white;font-weight:700;cursor:pointer">
//          Upgrader →
//        </button>
//      </div>`;
//    el.style.pointerEvents = 'none';
//    el.parentElement.style.position = 'relative';
//    el.parentElement.appendChild(overlay);
//    overlay.addEventListener('click', () => {
//      window.location.href = `payment.html?reason=feature_locked&required=${requiredPlan}`;
//    });
//  }
//
// ============================================================
// RÉSUMÉ DES QUERY PARAMS UTILISÉS
// ============================================================
//
//  Vers relia.html :
//    ?access=<plan>&type=<feature_type>
//    ex: relia.html?access=entreprise&type=full_package
//
//  Vers payment.html :
//    ?reason=trial_expired
//    ?reason=upgrade_required&required=<plan>&type=<type>
//    ?reason=feature_locked&required=<plan>&type=<type>
//    ?success=1&plan=<plan>   ← retour Paddle après paiement
//
//  Vers login.html :
//    (redirection simple, pas de params nécessaires)
//
// ============================================================

export default {};
