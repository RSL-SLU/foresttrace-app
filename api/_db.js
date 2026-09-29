const path = require('path');
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch (_) {}
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env.vercel') }); } catch (_) {}

const crypto = require('crypto');
const { MongoClient, ObjectId } = require('mongodb');

let _client = null;

function getMongoUri() {
  return process.env.VERCEL_MONGODB_URI || process.env.MONGODB_URI;
}

function getDatabaseName() {
  // 1. Explicit override via environment variable
  if (process.env.MONGODB_DB_NAME) {
    return process.env.MONGODB_DB_NAME;
  }
  // 2. Explicit APP_MODE override (local/development -> foresttrace_dev, production -> foresttrace)
  const appMode = (process.env.APP_MODE || process.env.REACT_APP_MODE || '').toLowerCase();
  if (appMode === 'local' || appMode === 'dev' || appMode === 'development') {
    return 'foresttrace_dev';
  }
  if (appMode === 'production' || appMode === 'prod') {
    return 'foresttrace';
  }
  // 3. Vercel environment detection:
  // VERCEL_ENV is automatically provided by Vercel: 'production' | 'preview' | 'development'
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === 'preview') {
    return 'foresttrace_preview';
  }
  if (vercelEnv === 'development' || process.env.NODE_ENV === 'development') {
    return 'foresttrace_dev';
  }
  if (vercelEnv === 'production') {
    return 'foresttrace';
  }
  // 4. Fallback based on standard NODE_ENV
  return process.env.NODE_ENV === 'production' ? 'foresttrace' : 'foresttrace_dev';
}

async function getDb() {
  const uri = getMongoUri();
  if (!uri) {
    throw new Error('Neither VERCEL_MONGODB_URI nor MONGODB_URI is configured.');
  }
  if (!_client) {
    _client = new MongoClient(uri);
    await _client.connect();
  }
  const dbName = getDatabaseName();
  return _client.db(dbName);
}

async function getCollection(name) {
  const db = await getDb();
  return db.collection(name);
}

// Password hashing using Node's native crypto.scryptSync
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, key] = storedHash.split(':');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(hash, 'hex'));
}

// Lightweight, secure signed tokens using HMAC-SHA256
const AUTH_SECRET = process.env.AUTH_SECRET || process.env.SESSION_SECRET || 'foresttrace-auth-secret-key-2026';

function createToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  // Token valid for 30 days
  const exp = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const claims = Buffer.from(JSON.stringify({ ...payload, exp })).toString('base64url');
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(`${header}.${claims}`).digest('base64url');
  return `${header}.${claims}.${signature}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, claims, signature] = parts;
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(`${header}.${claims}`).digest('base64url');
  if (signature !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(claims, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function getUserFromRequest(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : req.headers['x-auth-token'];
  return verifyToken(token);
}

module.exports = {
  getDb,
  getCollection,
  ObjectId,
  hashPassword,
  verifyPassword,
  createToken,
  verifyToken,
  getUserFromRequest,
  getMongoUri,
};

