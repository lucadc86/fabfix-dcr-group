// auth-guard.js
// Includi questo script come <script type="module" src="/auth-guard.js"></script>
// su ogni pagina riservata allo staff. Reindirizza al login se non autenticato.

import { auth } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

const LOGIN_PAGE = '/login.html';
const TIMEOUT_MS = 3000;

new Promise((resolve) => {
  let done = false;
  const finish = (user) => {
    if (done) return;
    done = true;
    try { unsub && unsub(); } catch {}
    resolve(user);
  };
  let unsub = null;
  try {
    unsub = onAuthStateChanged(auth, (user) => finish(user));
  } catch {
    finish(null);
    return;
  }
  setTimeout(() => finish(null), TIMEOUT_MS);
}).then((user) => {
  if (!user) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(`${LOGIN_PAGE}?next=${next}`);
  }
});
