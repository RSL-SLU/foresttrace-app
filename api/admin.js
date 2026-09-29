const {
  getCollection,
  ObjectId,
  getUserFromRequest,
  getMongoUri,
} = require('./_db');

const VERCEL_ANALYTICS_URL = process.env.VERCEL_ANALYTICS_URL || 'https://vercel.com/rsl7/foresttrace/analytics';

module.exports = async function handler(req, res) {
  if (!getMongoUri()) {
    return res.status(503).json({ error: 'Database service unavailable' });
  }

  // 1. Verify administrator credentials
  const currentUser = getUserFromRequest(req);
  if (!currentUser || currentUser.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Administrator privileges required.' });
  }

  const action = (req.query?.action || req.body?.action || '').toLowerCase();

  try {
    const usersCol = await getCollection('users');
    const analyticsCol = await getCollection('module_analytics');
    const reportsCol = await getCollection('bug_reports');
    const chatsCol = await getCollection('chat_messages');

    // GET /api/admin?action=overview (or default)
    if (req.method === 'GET' && (action === 'overview' || !action)) {
      const [users, reports, chatsCount, moduleStats] = await Promise.all([
        usersCol.find({}, { projection: { passwordHash: 0 } }).sort({ createdAt: -1 }).limit(100).toArray(),
        reportsCol.find({}).sort({ createdAt: -1 }).limit(50).toArray(),
        chatsCol.countDocuments(),
        analyticsCol.aggregate([
          { $group: { _id: '$moduleId', count: { $sum: 1 }, lastUsed: { $max: '$timestamp' } } },
          { $sort: { count: -1 } },
        ]).toArray(),
      ]);

      const formattedUsers = users.map((u) => ({
        id: u._id.toString(),
        email: u.email,
        name: u.name || u.email.split('@')[0],
        role: u.role || 'user',
        createdAt: u.createdAt,
        lastActiveAt: u.lastActiveAt || u.createdAt,
      }));

      const formattedReports = reports.map((r) => ({
        id: r._id.toString(),
        userId: r.userId,
        userEmail: r.userEmail,
        title: r.title,
        description: r.description,
        context: r.context,
        status: r.status || 'open',
        createdAt: r.createdAt,
      }));

      return res.status(200).json({
        users: formattedUsers,
        totalUsers: formattedUsers.length,
        reports: formattedReports,
        totalReports: formattedReports.length,
        totalChats: chatsCount,
        moduleActivations: moduleStats.map((m) => ({
          moduleId: m._id,
          count: m.count,
          lastUsed: m.lastUsed,
        })),
        vercelAnalyticsUrl: VERCEL_ANALYTICS_URL,
      });
    }

    // PATCH /api/admin (update report status or user role)
    if (req.method === 'PATCH' || req.method === 'POST') {
      // Update bug report status
      if (action === 'update-report') {
        const { reportId, status } = req.body || {};
        if (!reportId || !status) {
          return res.status(400).json({ error: 'reportId and status are required' });
        }
        await reportsCol.updateOne(
          { _id: new ObjectId(reportId) },
          { $set: { status, updatedAt: new Date(), updatedBy: currentUser.email } }
        );
        return res.status(200).json({ success: true, message: `Report marked as ${status}` });
      }

      // Update user role (promote/demote)
      if (action === 'update-user-role') {
        const { targetUserId, newRole } = req.body || {};
        if (!targetUserId || !['admin', 'user'].includes(newRole)) {
          return res.status(400).json({ error: 'Valid targetUserId and newRole ("admin" or "user") required' });
        }

        // Prevent self-demotion to avoid locking out the admin
        if (targetUserId === currentUser.id && newRole !== 'admin') {
          return res.status(400).json({ error: 'You cannot demote your own administrator account.' });
        }

        await usersCol.updateOne(
          { _id: new ObjectId(targetUserId) },
          { $set: { role: newRole, roleUpdatedAt: new Date() } }
        );
        return res.status(200).json({ success: true, message: `User role updated to ${newRole}` });
      }
    }

    return res.status(400).json({ error: `Unknown admin action: ${action}` });
  } catch (err) {
    console.error('[Admin API Error]', err);
    return res.status(500).json({ error: err.message || 'Admin service error' });
  }
};

