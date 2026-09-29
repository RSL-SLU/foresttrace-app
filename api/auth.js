const {
  getCollection,
  hashPassword,
  verifyPassword,
  createToken,
  getUserFromRequest,
  getMongoUri,
} = require('./_db');

module.exports = async function handler(req, res) {
  // Check database configuration
  if (!getMongoUri()) {
    return res.status(503).json({
      error: 'MongoDB is not configured. Set VERCEL_MONGODB_URI in your environment.',
      initialized: false,
    });
  }

  const action = (req.query?.action || req.body?.action || '').toLowerCase();

  try {
    const users = await getCollection('users');

    // 1. STATUS: Checks if platform has an admin initialized and validates token
    if (req.method === 'GET' && (action === 'status' || !action)) {
      const adminCount = await users.countDocuments({ role: 'admin' });
      const currentUser = getUserFromRequest(req);
      let userDetails = null;

      if (currentUser?.id) {
        const doc = await users.findOne(
          { email: currentUser.email.toLowerCase() },
          { projection: { passwordHash: 0 } }
        );
        if (doc) {
          userDetails = {
            id: doc._id.toString(),
            email: doc.email,
            name: doc.name || doc.email.split('@')[0],
            role: doc.role || 'user',
            createdAt: doc.createdAt,
          };
        }
      }

      return res.status(200).json({
        initialized: adminCount > 0,
        authenticated: Boolean(userDetails),
        user: userDetails,
      });
    }

    // 2. ME: Return current authenticated user profile
    if (req.method === 'GET' && action === 'me') {
      const currentUser = getUserFromRequest(req);
      if (!currentUser) {
        return res.status(401).json({ error: 'Unauthorized: valid token required' });
      }
      const doc = await users.findOne(
        { email: currentUser.email.toLowerCase() },
        { projection: { passwordHash: 0 } }
      );
      if (!doc) {
        return res.status(404).json({ error: 'User account not found' });
      }
      return res.status(200).json({
        user: {
          id: doc._id.toString(),
          email: doc.email,
          name: doc.name || doc.email.split('@')[0],
          role: doc.role || 'user',
          createdAt: doc.createdAt,
          lastActiveAt: doc.lastActiveAt,
        },
      });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { email, password, name } = req.body || {};
    const normalizedEmail = (email || '').trim().toLowerCase();

    // 3. BOOTSTRAP-ADMIN: Defines the first admin on initial setup
    if (action === 'bootstrap-admin') {
      const adminExists = await users.findOne({ role: 'admin' });
      if (adminExists) {
        return res.status(403).json({
          error: 'An administrator account already exists. Use the login screen or ask an existing admin for access.',
        });
      }

      if (!normalizedEmail || !password || password.length < 6) {
        return res.status(400).json({ error: 'Valid email and password (minimum 6 characters) required.' });
      }

      const passwordHash = hashPassword(password);
      const displayName = (name || '').trim() || normalizedEmail.split('@')[0];

      const newUser = {
        email: normalizedEmail,
        name: displayName,
        passwordHash,
        role: 'admin',
        createdAt: new Date(),
        lastActiveAt: new Date(),
      };

      const result = await users.insertOne(newUser);
      const userPayload = {
        id: result.insertedId.toString(),
        email: normalizedEmail,
        name: displayName,
        role: 'admin',
      };
      const token = createToken(userPayload);

      return res.status(201).json({
        success: true,
        message: 'Initial administrator account created successfully.',
        user: userPayload,
        token,
      });
    }

    // 4. REGISTER: Email + password sign-up. The email is the login name only;
    // it is not verified (no mail provider is configured).
    if (action === 'register') {
      if (!normalizedEmail || !password || password.length < 6) {
        return res.status(400).json({ error: 'Valid email and password (minimum 6 characters) required.' });
      }

      const existing = await users.findOne({ email: normalizedEmail });
      if (existing) {
        return res.status(409).json({ error: 'An account with this email already exists.' });
      }

      const passwordHash = hashPassword(password);
      const displayName = (name || '').trim() || normalizedEmail.split('@')[0];
      const count = await users.countDocuments();
      const role = count === 0 ? 'admin' : 'user';

      const newUser = {
        email: normalizedEmail,
        name: displayName,
        passwordHash,
        role,
        createdAt: new Date(),
        lastActiveAt: new Date(),
      };

      const result = await users.insertOne(newUser);
      const userPayload = {
        id: result.insertedId.toString(),
        email: normalizedEmail,
        name: displayName,
        role,
      };
      const token = createToken(userPayload);

      return res.status(201).json({
        success: true,
        user: userPayload,
        token,
      });
    }

    // 5. LOGIN: Email + password
    if (action === 'login') {
      if (!normalizedEmail || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
      }

      const userDoc = await users.findOne({ email: normalizedEmail });

      if (!userDoc || !userDoc.passwordHash || !verifyPassword(password, userDoc.passwordHash)) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      await users.updateOne(
        { _id: userDoc._id },
        { $set: { lastActiveAt: new Date() } }
      );

      const userPayload = {
        id: userDoc._id.toString(),
        email: userDoc.email,
        name: userDoc.name || userDoc.email.split('@')[0],
        role: userDoc.role || 'user',
      };
      const token = createToken(userPayload);

      return res.status(200).json({
        success: true,
        user: userPayload,
        token,
      });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    console.error('[Auth API Error]', err);
    return res.status(500).json({ error: err.message || 'Authentication service error' });
  }
};
