const express = require('express');
const { requireAuth, requireAdmin } = require('../auth');
const { getAuditLogs } = require('../db');

const router = express.Router();

router.use(requireAuth);
router.use(requireAdmin);

// Get audit logs with pagination and filters
router.get('/', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const username = req.query.username || null;
  const eventType = req.query.event_type || null;

  const result = getAuditLogs({ page, limit, username, eventType });
  res.json(result);
});

module.exports = router;
