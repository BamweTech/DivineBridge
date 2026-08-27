import { Platform } from 'react-native';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeAuth, getAuth, type Persistence } from 'firebase/auth';
import {
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getDatabase } from 'firebase/database';
import AsyncStorage from '@react-native-async-storage/async-storage';

// @firebase/auth ships a top-level "react-native" field in package.json.
// Metro's legacy resolver picks that up and returns dist/rn/index.js,
// which exports getReactNativePersistence. Using require() avoids TS errors
// since the public type declarations don't list this export.
const { getReactNativePersistence } = require('@firebase/auth') as {
  getReactNativePersistence: (storage: typeof AsyncStorage) => Persistence;
};

const firebaseConfig = {
  apiKey: 'AIzaSyBl941ca7r1EShcF7xtontXwi10HwZar-8',
  authDomain: 'divinebridge.firebaseapp.com',
  databaseURL: 'https://divinebridge-default-rtdb.firebaseio.com',
  projectId: 'divinebridge',
  storageBucket: 'divinebridge.firebasestorage.app',
  messagingSenderId: '853408757178',
  appId: '1:853408757178:ios:e8c511f14c217f62ed5983',
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// initializeAuth can only be called once — on hot-reloads fall back to getAuth
let auth: ReturnType<typeof initializeAuth>;
try {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch {
  auth = getAuth(app);
}
export { auth };

// IndexedDB persistence is web-only. On native it warns and falls back to
// memory, so request memory cache directly.
export const db = initializeFirestore(app, {
  localCache:
    Platform.OS === 'web'
      ? persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        })
      : memoryLocalCache(),
});

export const storage = getStorage(app);
export const rtdb = getDatabase(app);

export default app;
