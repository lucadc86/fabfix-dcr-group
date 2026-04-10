import { auth } from './firebase.js';
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

const form   = document.getElementById('loginForm');
const btn    = document.getElementById('loginBtn');
const errMsg = document.getElementById('errMsg');

function showError(msg) {
  errMsg.textContent = msg;
  errMsg.style.display = 'block';
}

// Se l'utente è già autenticato, rimanda alla home
onAuthStateChanged(auth, (user) => {
  if (user) {
    let next = new URLSearchParams(location.search).get('next') || '/index.html';
    // Sicurezza: accettiamo solo percorsi relativi dello stesso sito
    if (!next.startsWith('/') || next.startsWith('//')) next = '/index.html';
    window.location.replace(next);
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errMsg.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Accesso in corso…';

  const email    = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  try {
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged gestirà il redirect
  } catch (err) {
    let msg = 'Accesso non riuscito. Controlla email e password.';
    if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' ||
        err.code === 'auth/invalid-credential') {
      msg = 'Email o password non corretti.';
    } else if (err.code === 'auth/too-many-requests') {
      msg = 'Troppi tentativi. Attendi qualche minuto e riprova.';
    } else if (err.code === 'auth/network-request-failed') {
      msg = 'Errore di rete. Controlla la connessione.';
    }
    showError(msg);
    btn.disabled = false;
    btn.textContent = 'Accedi';
  }
});
