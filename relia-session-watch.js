// ============================================================
// relia-session-watch.js
// Colle ce script dans relia.html pour surveiller la session
// If someone logs in elsewhere → automatic logout
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

  // Check whether the session is still active
  const { data: isValid } = await supabase.rpc('validate_session', {
    p_user_id: session.user.id,
    p_token:   token
  });

  if (!isValid) {
    // Session revoked → log out
    await supabase.auth.signOut();
    localStorage.removeItem(SESSION_KEY);
    alert('⚠️ Your session was opened on another device. You have been logged out.');
    window.location.href = 'login.html';
  }
}

// Check every 2 minutes
checkSession(); // immediate check on load
setInterval(checkSession, 120000);
