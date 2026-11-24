const {
  getCollection,
  hashPassword,
  verifyPassword,
  createToken,
  getUserFromRequest,
  getMongoUri,
} = require('./_db');
const {
  normalizeUsername, validateUsername, ensureUsername, ensureIndex,
} = require('./_usernames');
const { allowedPrefixesFor } = require('./_uploadTargets');
const { verifyGoogleIdToken, googleClientId } = require('./_google');

let googleIndexReady = null;

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
            username: await ensureUsername(users, doc),
            name: doc.name || doc.email.split('@')[0],
            role: doc.role || 'user',
            // Drives the "Upload Data" menu item; api/uploads.js re-checks it.
            canUpload: allowedPrefixesFor(doc).length > 0,
            createdAt: doc.createdAt,
          };
        }
      }

      return res.status(200).json({
        initialized: adminCount > 0,
        authenticated: Boolean(userDetails),
        user: userDetails,
        // Public by design (it is in every page that shows the button); null
        // hides "Sign in with Google".
        googleClientId: googleClientId(),
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
          username: await ensureUsername(users, doc),
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

    const { email, password, name, username } = req.body || {};
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
        username: await ensureUsername(users, { ...newUser, _id: result.insertedId }),
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

      const usernameError = validateUsername(username);
      if (usernameError) return res.status(400).json({ error: usernameError });
      const normalizedUsername = normalizeUsername(username);

      const existing = await users.findOne({ email: normalizedEmail });
      if (existing) {
        return res.status(409).json({ error: 'An account with this email already exists.' });
      }
      await ensureIndex(users);
      if (await users.findOne({ username: normalizedUsername }, { projection: { _id: 1 } })) {
        return res.status(409).json({ error: 'That username is taken. Please choose another.' });
      }

      const passwordHash = hashPassword(password);
      const displayName = (name || '').trim() || normalizedEmail.split('@')[0];
      const count = await users.countDocuments();
      const role = count === 0 ? 'admin' : 'user';

      const newUser = {
        email: normalizedEmail,
        username: normalizedUsername,
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
        username: normalizedUsername,
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

    // 5. GOOGLE: sign in or sign up with a Google ID token ({ credential }
    // from the Google Identity Services button; see api/_google.js).
    if (action === 'google') {
      let claims;
      try {
        claims = await verifyGoogleIdToken(req.body?.credential, googleClientId());
      } catch (err) {
        return res.status(401).json({ error: err.message });
      }
      const googleEmail = String(claims.email || '').trim().toLowerCase();
      if (!googleEmail || claims.email_verified !== true) {
        return res.status(401).json({ error: 'Your Google account has no verified email address.' });
      }
      googleIndexReady ??= users.createIndex({ googleSub: 1 }, { unique: true, sparse: true }).catch(() => {});
      await googleIndexReady;
      if (!await users.findOne({ role: 'admin' }, { projection: { _id: 1 } })) {
        return res.status(409).json({ error: 'Finish the initial administrator setup before signing in with Google.' });
      }

      let userDoc = await users.findOne({ googleSub: claims.sub })
        || await users.findOne({ email: googleEmail });

      if (!userDoc) {
        const newUser = {
          email: googleEmail,
          name: String(claims.name || '').trim() || googleEmail.split('@')[0],
          googleSub: claims.sub,
          emailVerified: true,
          role: 'user',
          createdAt: new Date(),
          lastActiveAt: new Date(),
        };
        const { insertedId } = await users.insertOne(newUser);
        userDoc = { ...newUser, _id: insertedId };
      } else {
        const set = { lastActiveAt: new Date(), emailVerified: true };
        const unset = {};
        if (!userDoc.googleSub) {
          set.googleSub = claims.sub;
          set.googleLinkedAt = new Date();
          // Sign-up never verified emails, so anyone could have registered
          // this address with a password before its owner arrived. Google has
          // now proven ownership; a password set by a stranger must not keep
          // working (the same rule Firebase applies). Accounts an admin made
          // (create-user.js) and admin accounts keep their password.
          if (userDoc.passwordHash && !userDoc.createdBy && userDoc.role !== 'admin') {
            unset.passwordHash = '';
          }
        }
        await users.updateOne({ _id: userDoc._id }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
      }

      const userPayload = {
        id: userDoc._id.toString(),
        email: userDoc.email,
        username: await ensureUsername(users, userDoc),
        name: userDoc.name || userDoc.email.split('@')[0],
        role: userDoc.role || 'user',
      };
      return res.status(200).json({
        success: true,
        user: { ...userPayload, canUpload: allowedPrefixesFor(userDoc).length > 0 },
        token: createToken(userPayload),
      });
    }

    // 6. LOGIN: Email + password
    if (action === 'login') {
      if (!normalizedEmail || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
      }

      const userDoc = await users.findOne({ email: normalizedEmail });

      if (userDoc && !userDoc.passwordHash && userDoc.googleSub) {
        return res.status(401).json({ error: 'This account signs in with Google. Use “Continue with Google” above.' });
      }
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
        username: await ensureUsername(users, userDoc),
        name: userDoc.name || userDoc.email.split('@')[0],
        role: userDoc.role || 'user',
      };
      const token = createToken(userPayload);

      return res.status(200).json({
        success: true,
        // canUpload stays out of the token: access is re-read on each upload.
        user: { ...userPayload, canUpload: allowedPrefixesFor(userDoc).length > 0 },
        token,
      });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    console.error('[Auth API Error]', err);
    return res.status(500).json({ error: err.message || 'Authentication service error' });
  }
};
