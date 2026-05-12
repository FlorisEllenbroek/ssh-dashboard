const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');

const router = express.Router();

let sessionStore;

function setupSession(app) {
  const store = new session.MemoryStore();
  sessionStore = store;

  app.use(session({
    store,
    secret: process.env.SESSION_SECRET || 'change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24, // 24 hours
    },
  }));
}

function getSessionStore() {
  return sessionStore;
}

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  res.redirect('/');
}

// Parse session from cookie for WebSocket upgrade requests
function getSessionFromRequest(req, sessionStore, sessionSecret) {
  return new Promise((resolve) => {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return resolve(null);

    const sid = parseCookie(cookieHeader, 'connect.sid', sessionSecret);
    if (!sid) return resolve(null);

    if (sessionStore) {
      sessionStore.get(sid, (err, sess) => {
        if (err || !sess) return resolve(null);
        resolve(sess);
      });
    } else {
      resolve(null);
    }
  });
}

function parseCookie(cookieHeader, name, secret) {
  const cookies = cookieHeader.split(';').reduce((acc, c) => {
    const [k, ...v] = c.trim().split('=');
    acc[k] = decodeURIComponent(v.join('='));
    return acc;
  }, {});

  const raw = cookies[name];
  if (!raw) return null;

  // express-session signs cookies as s:<sid>.<signature>
  if (raw.startsWith('s:')) {
    return raw.slice(2).split('.')[0];
  }
  return raw;
}

router.post('/login', express.urlencoded({ extended: false }), async (req, res) => {
  const { username, password } = req.body;

  const validUser = username === process.env.USERNAME;
  const validPass = await bcrypt.compare(password || '', process.env.PASSWORD_HASH || '');

  if (validUser && validPass) {
    req.session.authenticated = true;
    req.session.username = username;
    return res.redirect('/terminal');
  }

  res.redirect('/?error=1');
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

module.exports = { router, setupSession, requireAuth, getSessionFromRequest, getSessionStore };
