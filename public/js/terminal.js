(function () {
  const term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
    theme: {
      background: '#0d1117',
      foreground: '#c9d1d9',
      cursor: '#58a6ff',
      selectionBackground: '#264f78',
    },
  });

  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);

  const container = document.getElementById('terminal');
  term.open(container);
  fitAddon.fit();

  // WebSocket connection
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${window.location.host}/ws/terminal`);

  ws.onopen = function () {
    // Send initial size
    const size = { cols: term.cols, rows: term.rows };
    ws.send('\x01' + JSON.stringify(size));
  };

  ws.onmessage = function (event) {
    term.write(event.data);
  };

  ws.onclose = function () {
    term.write('\r\n\x1b[31m[Connection closed]\x1b[0m\r\n');
  };

  ws.onerror = function () {
    term.write('\r\n\x1b[31m[Connection error]\x1b[0m\r\n');
  };

  term.onData(function (data) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  // Handle resize
  window.addEventListener('resize', function () {
    fitAddon.fit();
    if (ws.readyState === WebSocket.OPEN) {
      const size = { cols: term.cols, rows: term.rows };
      ws.send('\x01' + JSON.stringify(size));
    }
  });

  // Also fit when the panel might change size
  new ResizeObserver(function () {
    fitAddon.fit();
    if (ws.readyState === WebSocket.OPEN) {
      const size = { cols: term.cols, rows: term.rows };
      ws.send('\x01' + JSON.stringify(size));
    }
  }).observe(container);
})();
