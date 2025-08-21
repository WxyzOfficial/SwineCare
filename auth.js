// auth.js
// Uses firebase compat SDK loaded from index.html

const auth = firebase.auth();
const db = firebase.firestore();
const rdb = firebase.database();
const messaging = firebase.messaging ? firebase.messaging() : null;

const el = id => document.getElementById(id);

// Utility: safe element binding (no crash if element missing)
function bind(id, handler) {
  const node = el(id);
  if (node) node.onclick = handler;
  return node;
}

// UI tabs
bind('tab-login', () => {
  el('login-form').classList.remove('hidden');
  el('register-form').classList.add('hidden');
  el('tab-login').classList.add('active');
  el('tab-register').classList.remove('active');
});
bind('tab-register', () => {
  el('register-form').classList.remove('hidden');
  el('login-form').classList.add('hidden');
  el('tab-register').classList.add('active');
  el('tab-login').classList.remove('active');
});

const showMsg = (m, ok = true) => {
  const msg = el('auth-msg');
  if (!msg) {
    console.log('AUTH MSG:', m);
    return;
  }
  msg.textContent = m;
  msg.style.color = ok ? '#2b2' : '#d33';
  // clear after some time
  setTimeout(() => { if (msg) msg.textContent = ''; }, 7000);
};

// Always persistent login (no remember me)
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(e => {
  console.warn('setPersistence failed:', e);
});

// Helper: register FCM token to Firestore (optional)
async function registerFcmToken(uid) {
  if (!messaging) return;
  try {
    // Some browsers require Notification permission
    if (Notification && Notification.permission !== 'granted') {
      try { await messaging.requestPermission(); } catch (permErr) { console.warn('FCM permission denied', permErr); }
    }
    const token = await messaging.getToken();
    if (token) {
      await db.collection('fcmTokens').doc(token).set({
        uid,
        token,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  } catch (err) {
    console.warn('FCM registration failed', err);
  }
}

// Centralized post-sign-in handler
async function handleUserSignIn(user) {
  if (!user) return;
  const udata = {
    name: user.displayName || '',
    email: user.email || '',
    role: 'FARMER',
    lastLogin: firebase.firestore.FieldValue.serverTimestamp()
  };
  try {
    await db.collection('users').doc(user.uid).set(udata, { merge: true });
  } catch (e) {
    console.warn('Could not write user doc', e);
  }
  // Register FCM optionally
  await registerFcmToken(user.uid);
  // Redirect to dashboard
  showMsg('Login successful — redirecting...');
  setTimeout(() => { location.href = 'dashboard.html'; }, 700);
}

/* ============================
   Handle redirect sign-in flow
   ============================ */
auth.getRedirectResult().then(result => {
  if (result && result.user) {
    // result.user will be defined when returning from signInWithRedirect
    console.log('Redirect sign-in result', result);
    handleUserSignIn(result.user);
  }
}).catch(err => {
  console.warn('getRedirectResult error', err);
});

/* ============================
   Register flow
   ============================ */
bind('btn-register', async () => {
  const btn = el('btn-register');
  if (btn) btn.disabled = true;
  try {
    const name = (el('reg-name')?.value || '').trim();
    const email = (el('reg-email')?.value || '').trim();
    const pass = (el('reg-pass')?.value || '');

    if (!email || !pass || pass.length < 6) {
      showMsg('Provide a valid email and password (min 6 chars).', false);
      return;
    }

    const cred = await auth.createUserWithEmailAndPassword(email, pass);
    // Save profile to Firestore
    await db.collection('users').doc(cred.user.uid).set({
      name,
      email,
      role: 'FARMER',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await handleUserSignIn(cred.user);
  } catch (err) {
    console.error('Register error', err);
    showMsg(err.message || 'Register failed', false);
  } finally {
    if (btn) btn.disabled = false;
  }
});

/* ============================
   Login flow
   ============================ */
bind('btn-login', async (e) => {
  if (e && typeof e.preventDefault === 'function') e.preventDefault();
  const btn = el('btn-login');
  if (btn) btn.disabled = true;
  try {
    const email = (el('login-email')?.value || '').trim();
    const pass = (el('login-pass')?.value || '');
    if (!email || !pass) {
      showMsg('Please enter email and password.', false);
      return;
    }
    const cred = await auth.signInWithEmailAndPassword(email, pass);
    await handleUserSignIn(cred.user);
  } catch (err) {
    console.error('Login error', err);
    showMsg(err.message || 'Login failed', false);
  } finally {
    if (btn) btn.disabled = false;
  }
});

/* ============================
   Google Sign-In (popup + fallback to redirect)
   ============================ */
bind('btn-google', async (e) => {
  if (e && typeof e.preventDefault === 'function') e.preventDefault();
  const btn = el('btn-google');
  if (btn) btn.disabled = true;

  const provider = new firebase.auth.GoogleAuthProvider();
  // optional: request additional scopes:
  // provider.addScope('profile'); provider.addScope('email');

  try {
    // Try popup first (better UX)
    const res = await auth.signInWithPopup(provider);
    if (res && res.user) {
      await handleUserSignIn(res.user);
      return;
    }
  } catch (err) {
    console.warn('signInWithPopup error:', err);
    // If popup was blocked or not allowed, fallback to redirect
    const fallbackCodes = [
      'auth/popup-blocked',
      'auth/cancelled-popup-request',
      'auth/popup-closed-by-user',
      'auth/web-storage-unsupported'
    ];
    if (err && err.code && fallbackCodes.includes(err.code)) {
      try {
        // Fallback to redirect flow
        await auth.signInWithRedirect(provider);
        // After redirect, getRedirectResult() (above) will handle the result
        showMsg('Redirecting to sign-in provider...');
        return;
      } catch (redirErr) {
        console.error('signInWithRedirect failed', redirErr);
        showMsg(redirErr.message || 'Google sign-in failed', false);
      }
    } else {
      showMsg(err.message || 'Google login failed', false);
    }
  } finally {
    if (btn) btn.disabled = false;
  }
});

/* ============================
   Forgot password
   ============================ */
bind('forgot-pw', async (e) => {
  if (e && typeof e.preventDefault === 'function') e.preventDefault();
  const btn = el('forgot-pw');
  if (btn) btn.disabled = true;
  try {
    // prefer email in the login input
    const typedEmail = (el('login-email')?.value || '').trim();
    const email = typedEmail || prompt('Enter your email for password reset:');
    if (!email) {
      showMsg('Email is required for password reset', false);
      return;
    }
    await auth.sendPasswordResetEmail(email);
    showMsg('Password reset email sent to ' + email, true);
  } catch (err) {
    console.error('Forgot password error', err);
    showMsg(err.message || 'Could not send reset email', false);
  } finally {
    if (btn) btn.disabled = false;
  }
});

/* ============================
   Redirect to dashboard if already logged in
   ============================ */
auth.onAuthStateChanged(user => {
  if (user) {
    // If user is already logged in and is on the auth page, go to dashboard
    if (location.pathname.endsWith('index.html') || location.pathname === '/' ) {
      // small delay so any UI messages are visible briefly
      setTimeout(() => { location.href = 'dashboard.html'; }, 150);
    }
  }
});
