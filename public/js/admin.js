(function () {
  // --- User Management ---
  var usersBody = document.querySelector('#users-table tbody');
  var modal = document.getElementById('user-modal');
  var form = document.getElementById('user-form');
  var modalTitle = document.getElementById('modal-title');
  var passwordHint = document.getElementById('password-hint');

  function loadUsers() {
    fetch('/api/users')
      .then(function (r) { return r.json(); })
      .then(function (users) {
        usersBody.innerHTML = '';
        users.forEach(function (u) {
          var tr = document.createElement('tr');
          if (!u.active) tr.classList.add('inactive-row');
          tr.innerHTML =
            '<td>' + u.id + '</td>' +
            '<td>' + escapeHtml(u.username) + '</td>' +
            '<td><span class="badge badge-' + u.role + '">' + u.role + '</span></td>' +
            '<td>' + (u.sudo_allowed ? 'Yes' : 'No') + '</td>' +
            '<td>' + (u.active ? 'Yes' : 'No') + '</td>' +
            '<td>' + u.created_at + '</td>' +
            '<td class="actions">' +
              '<button class="btn btn-small btn-edit" data-id="' + u.id + '">Edit</button>' +
              (u.active ? '<button class="btn btn-small btn-danger btn-delete" data-id="' + u.id + '">Delete</button>' : '') +
            '</td>';
          usersBody.appendChild(tr);
        });

        // Bind edit/delete buttons
        document.querySelectorAll('.btn-edit').forEach(function (btn) {
          btn.addEventListener('click', function () { editUser(parseInt(this.dataset.id), users); });
        });
        document.querySelectorAll('.btn-delete').forEach(function (btn) {
          btn.addEventListener('click', function () { deleteUser(parseInt(this.dataset.id)); });
        });
      });
  }

  document.getElementById('btn-add-user').addEventListener('click', function () {
    form.reset();
    document.getElementById('form-id').value = '';
    document.getElementById('form-password').required = true;
    passwordHint.style.display = 'none';
    modalTitle.textContent = 'Add User';
    modal.style.display = 'flex';
  });

  document.getElementById('modal-close').addEventListener('click', function () {
    modal.style.display = 'none';
  });

  modal.addEventListener('click', function (e) {
    if (e.target === modal) modal.style.display = 'none';
  });

  function editUser(id, users) {
    var user = users.find(function (u) { return u.id === id; });
    if (!user) return;

    document.getElementById('form-id').value = user.id;
    document.getElementById('form-username').value = user.username;
    document.getElementById('form-password').value = '';
    document.getElementById('form-password').required = false;
    passwordHint.style.display = 'block';
    document.getElementById('form-role').value = user.role;
    document.getElementById('form-sudo').checked = !!user.sudo_allowed;
    modalTitle.textContent = 'Edit User';
    modal.style.display = 'flex';
  }

  function deleteUser(id) {
    if (!confirm('Are you sure you want to deactivate this user?')) return;
    fetch('/api/users/' + id, { method: 'DELETE' })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.error); });
        loadUsers();
        loadAuditLogs();
      })
      .catch(function (err) { alert(err.message); });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var id = document.getElementById('form-id').value;
    var data = {
      username: document.getElementById('form-username').value,
      role: document.getElementById('form-role').value,
      sudo_allowed: document.getElementById('form-sudo').checked,
    };

    var password = document.getElementById('form-password').value;
    if (password) data.password = password;

    var url = id ? '/api/users/' + id : '/api/users';
    var method = id ? 'PUT' : 'POST';

    fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.error); });
        modal.style.display = 'none';
        loadUsers();
        loadAuditLogs();
      })
      .catch(function (err) { alert(err.message); });
  });

  // --- Audit Logs ---
  var auditBody = document.querySelector('#audit-table tbody');
  var auditPagination = document.getElementById('audit-pagination');
  var currentPage = 1;

  function loadAuditLogs(page) {
    page = page || 1;
    currentPage = page;

    var username = document.getElementById('filter-username').value.trim();
    var eventType = document.getElementById('filter-event').value;

    var params = new URLSearchParams({ page: page, limit: 50 });
    if (username) params.set('username', username);
    if (eventType) params.set('event_type', eventType);

    fetch('/api/audit-logs?' + params.toString())
      .then(function (r) { return r.json(); })
      .then(function (data) {
        auditBody.innerHTML = '';
        data.logs.forEach(function (log) {
          var detail = '';
          if (log.detail) {
            try {
              var parsed = JSON.parse(log.detail);
              if (parsed.command) {
                detail = escapeHtml(parsed.command);
                if (parsed.blocked) detail += ' <span class="badge badge-danger">BLOCKED</span>';
              } else {
                detail = escapeHtml(JSON.stringify(parsed));
              }
            } catch (e) {
              detail = escapeHtml(log.detail);
            }
          }

          var tr = document.createElement('tr');
          tr.innerHTML =
            '<td class="nowrap">' + log.timestamp + '</td>' +
            '<td>' + escapeHtml(log.username) + '</td>' +
            '<td><span class="badge badge-event-' + log.event_type + '">' + log.event_type + '</span></td>' +
            '<td class="detail-cell">' + detail + '</td>' +
            '<td>' + (log.ip_address || '-') + '</td>';
          auditBody.appendChild(tr);
        });

        // Pagination
        auditPagination.innerHTML = '';
        if (data.totalPages > 1) {
          for (var i = 1; i <= data.totalPages; i++) {
            var btn = document.createElement('button');
            btn.textContent = i;
            btn.className = 'btn btn-small' + (i === data.page ? ' btn-active' : '');
            btn.dataset.page = i;
            btn.addEventListener('click', function () {
              loadAuditLogs(parseInt(this.dataset.page));
            });
            auditPagination.appendChild(btn);
          }
        }
      });
  }

  document.getElementById('btn-filter').addEventListener('click', function () {
    loadAuditLogs(1);
  });

  // Allow Enter key in filter input
  document.getElementById('filter-username').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') loadAuditLogs(1);
  });

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  // Initial load
  loadUsers();
  loadAuditLogs();
})();
