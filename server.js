require('dotenv').config();

const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const si = require('systeminformation');
const { router: authRouter, setupSession, requireAuth, getSessionStore } = require('./auth');

const app = express();
const server = http.createServer(app);

// Session setup
setupSession(app);

// Auth routes
app.use(authRouter);

// Static files
app.use(express.static('public'));

// Protect dashboard
app.get('/terminal', requireAuth, (req, res) => {
  res.sendFile(__dirname + '/public/terminal.html');
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
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });
});

wss.on('connection', (ws) => {
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: process.env.HOME || process.env.USERPROFILE,
    env: process.env,
  });

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

    ptyProcess.write(data);
  });

  ws.on('close', () => {
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Dashboard running on http://localhost:${PORT}`);
});
