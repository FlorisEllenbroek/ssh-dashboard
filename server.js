require('dotenv').config();

const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const si = require('systeminformation');
const { initDatabase, addAuditLog } = require('./db');
const { router: authRouter, setupSession, requireAuth, requireAdmin, getSessionStore } = require('./auth');
const usersRouter = require('./routes/users');
const auditRouter = require('./routes/audit');

const app = express();
const server = http.createServer(app);

// Session setup
setupSession(app);

// Auth routes
app.use(authRouter);

// API routes
app.use('/api/users', usersRouter);
app.use('/api/audit-logs', auditRouter);

// Static files
app.use(express.static('public'));

// Protect dashboard
app.get('/terminal', requireAuth, (req, res) => {
  res.sendFile(__dirname + '/public/terminal.html');
});

// Protect admin page
app.get('/admin', requireAuth, requireAdmin, (req, res) => {
  res.sendFile(__dirname + '/public/admin.html');
});

// System info API
app.get('/api/system', requireAuth, async (req, res) => {
  try {
    const [cpu, cpuLoad, mem, disk, osInfo, time] = await Promise.all([
      si.cpu(),
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.osInfo(),
      si.time(),
    ]);

    res.json({
      cpu: {
        model: `${cpu.manufacturer} ${cpu.brand}`,
        cores: cpu.cores,
        load: Math.round(cpuLoad.currentLoad * 100) / 100,
      },
      memory: {
        total: mem.total,
        used: mem.used,
        percent: Math.round((mem.used / mem.total) * 10000) / 100,
      },
      disk: disk.map(d => ({
        mount: d.mount,
        total: d.size,
        used: d.used,
        percent: Math.round(d.use * 100) / 100,
      })),
      uptime: time.uptime,
      hostname: osInfo.hostname,
      os: `${osInfo.distro} ${osInfo.release}`,
    });
  } catch (err) {
    console.error('System info error:', err);
    res.status(500).json({ error: 'Failed to get system info' });
  }
});

// WebSocket terminal
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/ws/terminal') {
    socket.destroy();
    return;
  }

  // Parse session cookie
  const cookieHeader = req.headers.cookie || '';
  const sidMatch = cookieHeader.match(/connect\.sid=([^;]+)/);

  if (!sidMatch) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  const rawValue = decodeURIComponent(sidMatch[1]);
  const sid = rawValue.startsWith('s:') ? rawValue.slice(2).split('.')[0] : rawValue;

  const store = getSessionStore();
  store.get(sid, (err, sess) => {
    if (err || !sess || !sess.authenticated) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    // Attach session data to request for use in connection handler
    req.sessionData = {
      username: sess.username,
      role: sess.role,
      sudoAllowed: sess.sudoAllowed,
    };
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });
});

wss.on('connection', (ws, req) => {
  const { username, role, sudoAllowed } = req.sessionData;
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;

  addAuditLog(username, 'terminal_open', null, ip);

  const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: process.env.HOME || process.env.USERPROFILE,
    env: process.env,
  });

  // Command buffer for logging
  let commandBuffer = '';

  ptyProcess.onData((data) => {
    try {
      ws.send(data);
    } catch (e) {
      // client disconnected
    }
  });

  ws.on('message', (msg) => {
    const data = msg.toString();

    // Handle resize messages (prefixed with \x01)
    if (data.startsWith('\x01')) {
      try {
        const size = JSON.parse(data.slice(1));
        ptyProcess.resize(size.cols, size.rows);
      } catch (e) {
        // ignore invalid resize
      }
      return;
    }

    // Buffer keystrokes for command logging
    for (const ch of data) {
      if (ch === '\r' || ch === '\n') {
        const cmd = commandBuffer.trim();
        if (cmd) {
          // Sudo restriction check
          if (!sudoAllowed && /^sudo\s/.test(cmd)) {
            addAuditLog(username, 'command', { command: cmd, blocked: true, reason: 'sudo not allowed' }, ip);
            ws.send('\r\n\x1b[31m[Access Denied] You do not have sudo privileges.\x1b[0m\r\n');
            ptyProcess.write('\x03');
            commandBuffer = '';
            return;
          }
          addAuditLog(username, 'command', { command: cmd }, ip);
        }
        commandBuffer = '';
      } else if (ch === '\x7f' || ch === '\b') {
        commandBuffer = commandBuffer.slice(0, -1);
      } else if (ch.charCodeAt(0) >= 32) {
        commandBuffer += ch;
      }
    }

    ptyProcess.write(data);
  });

  ws.on('close', () => {
    addAuditLog(username, 'terminal_close', null, ip);
    ptyProcess.kill();
  });

  ptyProcess.onExit(() => {
    try {
      ws.close();
    } catch (e) {
      // already closed
    }
  });
});

// Initialize database then start server
const PORT = process.env.PORT || 3000;

initDatabase().then(() => {
  server.listen(PORT, () => {
    console.log(`Dashboard running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
