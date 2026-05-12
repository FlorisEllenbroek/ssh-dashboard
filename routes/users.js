const express = require('express');
const { requireAuth, requireAdmin, getClientIp } = require('../auth');
const { listUsers, getUserById, createUser, updateUser, updateUserPassword, deleteUser, countActiveAdmins, addAuditLog } = require('../db');

const router = express.Router();

router.use(requireAuth);
router.use(requireAdmin);
router.use(express.json());

// List all users
router.get('/', (req, res) => {
  const users = listUsers();
  res.json(users);
});

// Create user
router.post('/', async (req, res) => {
  const { username, password, role, sudo_allowed } = req.body;
  const ip = getClientIp(req);

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  if (role && !['admin', 'user'].includes(role)) {
    return res.status(400).json({ error: 'Role must be "admin" or "user"' });
  }

  try {
    const id = await createUser(username, password, role || 'user', sudo_allowed ? 1 : 0);
    addAuditLog(req.session.username, 'user_created', { target: username, role: role || 'user', sudo_allowed: !!sudo_allowed }, ip);
    res.status(201).json({ id, username, role: role || 'user', sudo_allowed: sudo_allowed ? 1 : 0 });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Update user
router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const { username, role, sudo_allowed, active, password } = req.body;
  const ip = getClientIp(req);

  const user = getUserById(id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Prevent demoting/deactivating the last admin
  if (user.role === 'admin' && user.active === 1) {
    const willLoseAdmin = (role && role !== 'admin') || (active !== undefined && !active);
    if (willLoseAdmin && countActiveAdmins() <= 1) {
      return res.status(400).json({ error: 'Cannot remove the last admin' });
    }
  }

  if (role && !['admin', 'user'].includes(role)) {
    return res.status(400).json({ error: 'Role must be "admin" or "user"' });
  }

  const fields = {};
  if (username !== undefined) fields.username = username;
  if (role !== undefined) fields.role = role;
  if (sudo_allowed !== undefined) fields.sudo_allowed = sudo_allowed ? 1 : 0;
  if (active !== undefined) fields.active = active ? 1 : 0;

  try {
    updateUser(id, fields);

    if (password) {
      await updateUserPassword(id, password);
    }

    addAuditLog(req.session.username, 'user_updated', { target_id: id, changes: { ...fields, ...(password ? { password: '***' } : {}) } }, ip);
    res.json(getUserById(id));
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Delete (deactivate) user
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const ip = getClientIp(req);

  const user = getUserById(id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Prevent deleting the last admin
  if (user.role === 'admin' && user.active === 1 && countActiveAdmins() <= 1) {
    return res.status(400).json({ error: 'Cannot delete the last admin' });
  }

  deleteUser(id);
  addAuditLog(req.session.username, 'user_deleted', { target_id: id, target: user.username }, ip);
  res.json({ success: true });
});

module.exports = router;
