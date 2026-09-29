const {
  getCollection,
  getUserFromRequest,
  getMongoUri,
} = require('./_db');

module.exports = async function handler(req, res) {
  if (!getMongoUri()) {
    return res.status(503).json({ error: 'Database service unavailable' });
  }

  const user = getUserFromRequest(req);
  const action = (req.query?.action || req.body?.action || '').toLowerCase();

  try {
    // 1. Module activation tracker
    if (action === 'track-module') {
      const { moduleId } = req.body || {};
      if (moduleId) {
        const analytics = await getCollection('module_analytics');
        await analytics.insertOne({
          userId: user?.id || 'anonymous',
          userEmail: user?.email || 'anonymous',
          moduleId,
          timestamp: new Date(),
        });
      }
      return res.status(200).json({ ok: true });
    }

    const reportsCol = await getCollection('bug_reports');

    // 2. Submit bug report
    if (req.method === 'POST') {
      const { title, description, context } = req.body || {};
      if (!title || !description) {
        return res.status(400).json({ error: 'Title and description are required.' });
      }

      const reportDoc = {
        userId: user?.id || null,
        userEmail: user?.email || req.body?.email || 'anonymous',
        title: title.trim(),
        description: description.trim(),
        context: context || null,
        status: 'open',
        createdAt: new Date(),
      };

      const result = await reportsCol.insertOne(reportDoc);
      return res.status(201).json({
        success: true,
        reportId: result.insertedId.toString(),
        message: 'Bug report submitted successfully. Thank you for helping improve ForestTrace!',
      });
    }

    // 3. View user's own submitted reports
    if (req.method === 'GET') {
      if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const query = user.role === 'admin' ? {} : { userId: user.id };
      const reports = await reportsCol.find(query).sort({ createdAt: -1 }).limit(30).toArray();

      return res.status(200).json({
        reports: reports.map((r) => ({
          id: r._id.toString(),
          title: r.title,
          description: r.description,
          status: r.status,
          createdAt: r.createdAt,
        })),
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[Reports API Error]', err);
    return res.status(500).json({ error: err.message || 'Report submission failed' });
  }
};

