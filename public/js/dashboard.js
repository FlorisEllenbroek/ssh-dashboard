(function () {
  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    var sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
  }

  function formatUptime(seconds) {
    var d = Math.floor(seconds / 86400);
    var h = Math.floor((seconds % 86400) / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var parts = [];
    if (d > 0) parts.push(d + 'd');
    if (h > 0) parts.push(h + 'h');
    parts.push(m + 'm');
    return parts.join(' ');
  }

  function setBar(barId, percent) {
    var bar = document.getElementById(barId);
    bar.style.width = percent + '%';
    bar.className = 'progress-fill';
    if (percent > 90) bar.classList.add('danger');
    else if (percent > 70) bar.classList.add('warning');
  }

  function updateDashboard() {
    fetch('/api/system')
      .then(function (r) {
        if (!r.ok) throw new Error('Unauthorized');
        return r.json();
      })
      .then(function (data) {
        document.getElementById('hostname').textContent = data.hostname;
        document.getElementById('os').textContent = data.os;
        document.getElementById('uptime').textContent = formatUptime(data.uptime);
        document.getElementById('cpu-model').textContent = data.cpu.model + ' (' + data.cpu.cores + ' cores)';
        document.getElementById('cpu-load').textContent = data.cpu.load + '%';
        setBar('cpu-bar', data.cpu.load);
        document.getElementById('mem-usage').textContent = data.memory.percent + '% (' + formatBytes(data.memory.used) + ' / ' + formatBytes(data.memory.total) + ')';
        setBar('mem-bar', data.memory.percent);

        var diskContainer = document.getElementById('disk-container');
        diskContainer.innerHTML = '';
        data.disk.forEach(function (d, i) {
          var item = document.createElement('div');
          item.className = 'info-item disk-item';
          item.innerHTML =
            '<span class="info-label">Disk ' + d.mount + '</span>' +
            '<div class="disk-label">' + formatBytes(d.used) + ' / ' + formatBytes(d.total) + '</div>' +
            '<div class="progress-bar"><div id="disk-bar-' + i + '" class="progress-fill"></div></div>' +
            '<span class="info-percent">' + d.percent + '%</span>';
          diskContainer.appendChild(item);
          setBar('disk-bar-' + i, d.percent);
        });
      })
      .catch(function (err) {
        console.error('Failed to fetch system info:', err);
      });
  }

  updateDashboard();
  setInterval(updateDashboard, 5000);
})();
