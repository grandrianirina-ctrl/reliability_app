// ============================================================
// relia-session-watch.js
// Colle ce script dans relia.html pour surveiller la session
// Si quelqu'un se connecte ailleurs → déconnexion automatique
//
// USAGE dans relia.html (juste avant </body>) :
// <script type="module" src="./relia-session-watch.js"></script>
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  'https://kquwgqcxauymzkgfcxpm.supabase.co',
  'sb_publishable_SSPUlrqY7jwjPzsw-K3Wrg_cQjsWHrx'
);

const SESSION_KEY = 'rsp_session_token';

async function checkSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    return;
  }

  const token = localStorage.getItem(SESSION_KEY);
  if (!token) {
    window.location.href = 'login.html';
    return;
  }

  // Vérifier si la session est encore active
  const { data: isValid } = await supabase.rpc('validate_session', {
    p_user_id: session.user.id,
    p_token:   token
  });

  if (!isValid) {
    // Session révoquée → déconnecter
    await supabase.auth.signOut();
    localStorage.removeItem(SESSION_KEY);
    alert('⚠️ Votre session a été ouverte sur un autre appareil. Vous avez été déconnecté.');
    window.location.href = 'login.html';
  }
}

// Vérifier toutes les 2 minutes
checkSession(); // vérification immédiate au chargement
setInterval(checkSession, 120000);
