const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { getUser, addAuditLog } = require('./db');

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
      secure: false,
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
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.redirect('/');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.role === 'admin') {
    return next();
  }
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  res.redirect('/');
}

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
}

router.post('/login', express.urlencoded({ extended: false }), async (req, res) => {
  const { username, password } = req.body;
  const ip = getClientIp(req);

  if (!username || !password) {
    return res.redirect('/?error=1');
  }

  const user = getUser(username);

  if (!user) {
    addAuditLog(username, 'login_failed', { reason: 'unknown user' }, ip);
    return res.redirect('/?error=1');
  }

  const validPass = await bcrypt.compare(password, user.password_hash);

  if (!validPass) {
    addAuditLog(username, 'login_failed', { reason: 'wrong password' }, ip);
    return res.redirect('/?error=1');
  }

  req.session.authenticated = true;
  req.session.username = user.username;
  req.session.role = user.role;
  req.session.sudoAllowed = user.sudo_allowed === 1;
  req.session.userId = user.id;

  addAuditLog(username, 'login', null, ip);

  return res.redirect('/terminal');
});

router.get('/logout', (req, res) => {
  const username = req.session?.username || 'unknown';
  const ip = getClientIp(req);

  addAuditLog(username, 'logout', null, ip);

  req.session.destroy(() => {
    res.redirect('/');
  });
});

router.get('/api/me', requireAuth, (req, res) => {
  res.json({
    username: req.session.username,
    role: req.session.role,
    sudoAllowed: req.session.sudoAllowed,
  });
});

module.exports = { router, setupSession, requireAuth, requireAdmin, getSessionStore, getClientIp };
