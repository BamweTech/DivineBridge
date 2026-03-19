'use strict';

/**
 * Auth module — verifies Firebase ID tokens directly.
 *
 * Credentials are pulled from the same GCP Secret Manager secret that Flask uses
 * (`FIREBASE_CREDENTIALS`), so there is no shared secret, no key file to manage,
 * and no rotation to schedule. Firebase handles signing-key rotation automatically.
 *
 * Fallback chain:
 *   1. GCP Secret Manager  →  secret "FIREBASE_CREDENTIALS"  (production + local w/ gcloud auth)
 *   2. GOOGLE_APPLICATION_CREDENTIALS env var  (local dev with a downloaded key file)
 *   3. GCP Application Default Credentials  (Cloud Run / GKE workload identity)
 */

const admin = require('firebase-admin');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
require('dotenv').config();

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? 'divinebridge';
let _initPromise = null;

// ─── Credential Loading ───────────────────────────────────────────────────────

async function _loadCredentialsFromSecretManager() {
  try {
    const client = new SecretManagerServiceClient();
    const name = `projects/${PROJECT_ID}/secrets/FIREBASE_CREDENTIALS/versions/latest`;
    const [version] = await client.accessSecretVersion({ name });
    const json = version.payload.data.toString('utf8');
    return JSON.parse(json);
  } catch (err) {
    // Secret Manager not reachable locally without gcloud auth — fall through
    console.warn('[auth] Secret Manager unavailable, falling back to ADC:', err.message);
    return null;
  }
}

async function _initFirebase() {
  if (admin.apps.length > 0) return; // already initialized

  const credsDict = await _loadCredentialsFromSecretManager();

  if (credsDict) {
    admin.initializeApp({
      credential: admin.credential.cert(credsDict),
      projectId: credsDict.project_id ?? PROJECT_ID,
    });
    console.log(`[auth] Firebase initialized via Secret Manager (project: ${credsDict.project_id})`);
  } else {
    // ADC: works on Cloud Run / GKE, or locally when GOOGLE_APPLICATION_CREDENTIALS is set
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: PROJECT_ID,
    });
    console.log(`[auth] Firebase initialized via Application Default Credentials (project: ${PROJECT_ID})`);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Verify a Firebase ID token and return the caller's identity.
 *
 * In DEV_MODE (NODE_ENV=development or DEV_MODE=true) the token is treated
 * as a plain JSON object so local tests don't need real Firebase credentials.
 * Dev tokens look like: btoa(JSON.stringify({ userId, userName, roomId }))
 *
 * @param {string} idToken        Firebase ID token (or base64 dev token)
 * @param {string} expectedRoomId Room the client claims to be joining
 * @returns {Promise<{ userId: string, userName: string, roomId: string }>}
 * @throws if the token is invalid or expired
 */
async function verifyToken(idToken, expectedRoomId) {
  const isDev = process.env.DEV_MODE === 'true' || process.env.NODE_ENV === 'development';

  if (isDev) {
    try {
      const payload = JSON.parse(Buffer.from(idToken, 'base64').toString('utf8'));
      console.warn('[auth] DEV_MODE — skipping Firebase verification');
      return {
        userId: payload.userId ?? 'dev-user',
        userName: payload.userName ?? 'Dev User',
        roomId: payload.roomId ?? expectedRoomId,
      };
    } catch {
      // If it's not a base64 JSON, fall through to real verification
    }
  }

  // Lazy-init firebase-admin once, reuse for all subsequent calls
  if (!_initPromise) _initPromise = _initFirebase();
  await _initPromise;

  const decoded = await admin.auth().verifyIdToken(idToken, /* checkRevoked= */ true);

  const userId = decoded.uid;
  const userName = decoded.userName ?? decoded.name ?? decoded.email?.split('@')[0] ?? 'Anonymous';
  const roomId = decoded.roomId ?? expectedRoomId;

  return { userId, userName, roomId };
}

module.exports = { verifyToken };
