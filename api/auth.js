const {
  getCollection,
  hashPassword,
  verifyPassword,
  createToken,
  getUserFromRequest,
  getMongoUri,
} = require('./_db');
const {
  generateOtpCode,
  hashCode,
  sendSignupVerificationEmail,
  sendLoginCodeEmail,
} = require('./_mailer');

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
    const verificationCodes = await getCollection('verification_codes');

    // Create TTL index on verification_codes once if not present (auto-expire records)
    verificationCodes.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {});

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
            emailVerified: doc.emailVerified !== false,
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
          emailVerified: doc.emailVerified !== false,
          createdAt: doc.createdAt,
          lastActiveAt: doc.lastActiveAt,
        },
      });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { email, password, name, code } = req.body || {};
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
        emailVerified: true,
        createdAt: new Date(),
        lastActiveAt: new Date(),
      };

      const result = await users.insertOne(newUser);
      const userPayload = {
        id: result.insertedId.toString(),
        email: normalizedEmail,
        name: displayName,
        role: 'admin',
        emailVerified: true,
      };
      const token = createToken(userPayload);

      return res.status(201).json({
        success: true,
        message: 'Initial administrator account created successfully.',
        user: userPayload,
        token,
      });
    }

    // 4. SEND-SIGNUP-CODE: Sends a 6-digit confirmation code before creating user account
    if (action === 'send-signup-code') {
      if (!normalizedEmail || !normalizedEmail.includes('@')) {
        return res.status(400).json({ error: 'A valid email address is required.' });
      }

      const existing = await users.findOne({ email: normalizedEmail });
      if (existing) {
        return res.status(409).json({ error: 'An account with this email already exists. Please sign in instead.' });
      }

      const otp = generateOtpCode();
      const codeHash = hashCode(otp);
      const displayName = (name || '').trim() || normalizedEmail.split('@')[0];
      const passwordHash = (password && password.length >= 6) ? hashPassword(password) : null;
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      await verificationCodes.updateOne(
        { email: normalizedEmail, type: 'signup' },
        {
          $set: {
            email: normalizedEmail,
            codeHash,
            type: 'signup',
            metadata: {
              name: displayName,
              passwordHash,
            },
            attempts: 0,
            expiresAt,
            createdAt: new Date(),
          },
        },
        { upsert: true }
      );

      await sendSignupVerificationEmail(normalizedEmail, otp, displayName);

      return res.status(200).json({
        success: true,
        message: `Verification code sent to ${normalizedEmail}`,
      });
    }

    // 5. VERIFY-SIGNUP-CODE: Confirms 6-digit code and creates the verified user account
    if (action === 'verify-signup-code') {
      if (!normalizedEmail || !code) {
        return res.status(400).json({ error: 'Email and 6-digit verification code are required.' });
      }

      const pending = await verificationCodes.findOne({ email: normalizedEmail, type: 'signup' });
      if (!pending || new Date() > new Date(pending.expiresAt)) {
        return res.status(400).json({ error: 'Verification code has expired or was not requested. Please request a new code.' });
      }

      if (pending.attempts >= 5) {
        await verificationCodes.deleteOne({ _id: pending._id });
        return res.status(429).json({ error: 'Too many incorrect attempts. Please request a new code.' });
      }

      const submittedHash = hashCode(code);
      if (submittedHash !== pending.codeHash) {
        await verificationCodes.updateOne({ _id: pending._id }, { $inc: { attempts: 1 } });
        return res.status(400).json({ error: 'Invalid verification code. Please check your email and try again.' });
      }

      // Code matched! Delete used code
      await verificationCodes.deleteOne({ _id: pending._id });

      // Determine user role (first registered account gets admin if none exists)
      const count = await users.countDocuments();
      const role = count === 0 ? 'admin' : 'user';
      const displayName = pending.metadata?.name || normalizedEmail.split('@')[0];

      const newUser = {
        email: normalizedEmail,
        name: displayName,
        passwordHash: pending.metadata?.passwordHash || null,
        role,
        emailVerified: true,
        createdAt: new Date(),
        lastActiveAt: new Date(),
      };

      // Upsert/insert in case of race condition
      const result = await users.updateOne(
        { email: normalizedEmail },
        { $setOnInsert: newUser },
        { upsert: true }
      );

      const savedUser = await users.findOne({ email: normalizedEmail });
      const userPayload = {
        id: savedUser._id.toString(),
        email: savedUser.email,
        name: savedUser.name,
        role: savedUser.role,
        emailVerified: true,
      };
      const token = createToken(userPayload);

      return res.status(201).json({
        success: true,
        message: 'Email verified and account created successfully.',
        user: userPayload,
        token,
      });
    }

    // 6. SEND-LOGIN-CODE: Passwordless login — sends 6-digit code to registered user
    if (action === 'send-login-code') {
      if (!normalizedEmail || !normalizedEmail.includes('@')) {
        return res.status(400).json({ error: 'A valid email address is required.' });
      }

      const userDoc = await users.findOne({ email: normalizedEmail });
      if (!userDoc) {
        return res.status(404).json({ error: 'No ForestTrace account found with this email. Please sign up first.' });
      }

      const otp = generateOtpCode();
      const codeHash = hashCode(otp);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      await verificationCodes.updateOne(
        { email: normalizedEmail, type: 'login' },
        {
          $set: {
            email: normalizedEmail,
            codeHash,
            type: 'login',
            attempts: 0,
            expiresAt,
            createdAt: new Date(),
          },
        },
        { upsert: true }
      );

      await sendLoginCodeEmail(normalizedEmail, otp, userDoc.name);

      return res.status(200).json({
        success: true,
        message: `Login code sent to ${normalizedEmail}`,
      });
    }

    // 7. VERIFY-LOGIN-CODE: Authenticates user via 6-digit code
    if (action === 'verify-login-code') {
      if (!normalizedEmail || !code) {
        return res.status(400).json({ error: 'Email and 6-digit login code are required.' });
      }

      const pending = await verificationCodes.findOne({ email: normalizedEmail, type: 'login' });
      if (!pending || new Date() > new Date(pending.expiresAt)) {
        return res.status(400).json({ error: 'Login code has expired or was not requested. Please request a new code.' });
      }

      if (pending.attempts >= 5) {
        await verificationCodes.deleteOne({ _id: pending._id });
        return res.status(429).json({ error: 'Too many incorrect attempts. Please request a new code.' });
      }

      const submittedHash = hashCode(code);
      if (submittedHash !== pending.codeHash) {
        await verificationCodes.updateOne({ _id: pending._id }, { $inc: { attempts: 1 } });
        return res.status(400).json({ error: 'Invalid login code. Please check your email and try again.' });
      }

      // Code matched! Delete used code
      await verificationCodes.deleteOne({ _id: pending._id });

      const userDoc = await users.findOne({ email: normalizedEmail });
      if (!userDoc) {
        return res.status(404).json({ error: 'User account not found.' });
      }

      await users.updateOne(
        { _id: userDoc._id },
        { $set: { lastActiveAt: new Date(), emailVerified: true } }
      );

      const userPayload = {
        id: userDoc._id.toString(),
        email: userDoc.email,
        name: userDoc.name || userDoc.email.split('@')[0],
        role: userDoc.role || 'user',
        emailVerified: true,
      };
      const token = createToken(userPayload);

      return res.status(200).json({
        success: true,
        user: userPayload,
        token,
      });
    }

    // 8. DIRECT REGISTER: Kept as fallback
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
        emailVerified: false,
        createdAt: new Date(),
        lastActiveAt: new Date(),
      };

      const result = await users.insertOne(newUser);
      const userPayload = {
        id: result.insertedId.toString(),
        email: normalizedEmail,
        name: displayName,
        role,
        emailVerified: false,
      };
      const token = createToken(userPayload);

      return res.status(201).json({
        success: true,
        user: userPayload,
        token,
      });
    }

    // 9. PASSWORD LOGIN: Standard password authentication
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
        emailVerified: userDoc.emailVerified !== false,
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
