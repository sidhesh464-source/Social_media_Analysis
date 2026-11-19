import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged
} from 'firebase/auth';
import {
  getDatabase,
  ref,
  set,
  push,
  get,
  child,
  onValue,
  off
} from 'firebase/database';

const env = import.meta.env || {};

const projectId = env.VITE_FIREBASE_PROJECT_ID || "";
// Default Firebase Realtime Database URL format: https://<PROJECT_ID>-default-rtdb.firebaseio.com
const defaultDbUrl = projectId ? `https://${projectId}-default-rtdb.firebaseio.com` : "";

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || "AIzaSyD_wprK4cwYRi9BYULfUYrd6nvUAlNPn3c",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "social-media-sentiment-ana.firebaseapp.com",
  databaseURL: env.VITE_FIREBASE_DATABASE_URL || "https://social-media-sentiment-ana-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: env.VITE_FIREBASE_PROJECT_ID || "social-media-sentiment-ana",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "social-media-sentiment-ana.firebasestorage.app",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "510984607074",
  appId: env.VITE_FIREBASE_APP_ID || "1:510984607074:web:2c12b3fa66483e7111483b",
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || ""
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
  (firebaseConfig.databaseURL || firebaseConfig.projectId)
);

// Initialize Firebase
export let app = null;
export let auth = null;
export let rtdb = null;

if (isFirebaseConfigured) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    rtdb = getDatabase(app, firebaseConfig.databaseURL);
    console.info("Firebase Realtime Database connected:", firebaseConfig.databaseURL);
  } catch (err) {
    console.error("Firebase Realtime Database init error:", err);
  }
}

// Error Formatter for Real World Production
export function formatAuthError(err) {
  if (!err) return "An unexpected error occurred.";
  const code = err.code || "";
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return "Invalid email or password. Please verify your credentials.";
    case 'auth/email-already-in-use':
      return "An account with this email address already exists. Please sign in.";
    case 'auth/weak-password':
      return "Password should be at least 6 characters.";
    case 'auth/invalid-email':
      return "Please enter a valid email address.";
    case 'auth/popup-closed-by-user':
      return "Google sign-in popup was closed before finishing.";
    case 'auth/popup-blocked':
      return "Popup was blocked by your browser. Please allow popups for this domain.";
    case 'auth/operation-not-allowed':
      return "This authentication provider is not enabled in Firebase Console (Authentication > Sign-in method).";
    case 'auth/too-many-requests':
      return "Too many attempts. Account is temporarily locked. Try again later.";
    case 'auth/network-request-failed':
      return "Network connection issue. Please check your internet connection.";
    default:
      return err.message?.replace('Firebase: ', '') || "Authentication failed.";
  }
}

// Authentication Functions (No Guest / Demo)
export async function loginWithEmail(email, password) {
  if (!auth) throw new Error("Firebase Authentication is not configured. Please supply your Firebase credentials.");
  return await signInWithEmailAndPassword(auth, email, password);
}

export async function registerWithEmail(email, password) {
  if (!auth) throw new Error("Firebase Authentication is not configured. Please supply your Firebase credentials.");
  return await createUserWithEmailAndPassword(auth, email, password);
}

export async function loginWithGoogle() {
  if (!auth) throw new Error("Firebase Authentication is not configured. Please supply your Firebase credentials.");
  const provider = new GoogleAuthProvider();
  return await signInWithPopup(auth, provider);
}

export async function logoutUser() {
  if (!auth) return;
  return await signOut(auth);
}

export function onAuthChange(callback) {
  if (!auth) {
    callback(null);
    return () => { };
  }
  return onAuthStateChanged(auth, callback);
}

// ==========================================
// FIREBASE REALTIME DATABASE (NO SQL)
// ==========================================

// Save or update dataset in RTDB
export async function saveDatasetToRTDB(dataset, user) {
  if (!rtdb || !user) return null;
  const dsId = String(dataset.id || Date.now());
  const dsRef = ref(rtdb, `datasets/${dsId}`);
  const payload = {
    id: dsId,
    name: dataset.name,
    source: dataset.source || 'upload',
    status: dataset.status || 'uploaded',
    row_count: Number(dataset.row_count || 0),
    user_id: user.uid,
    user_email: user.email || 'unknown',
    created_at: dataset.created_at || Date.now()
  };
  await set(dsRef, payload);
  return dsId;
}

// Live Real-Time Datasets Listener
export function subscribeToDatasets(callback) {
  if (!rtdb) {
    callback([]);
    return () => { };
  }
  const datasetsRef = ref(rtdb, 'datasets');
  const unsubscribe = onValue(datasetsRef, (snapshot) => {
    const val = snapshot.val();
    if (!val) {
      callback([]);
      return;
    }
    const list = Object.keys(val).map(k => ({ ...val[k], id: val[k].id || k }));
    list.sort((a, b) => (Number(b.created_at) || 0) - (Number(a.created_at) || 0));
    callback(list);
  }, (err) => {
    console.error("RTDB Datasets subscribe error:", err);
    callback([]);
  });
  return () => off(datasetsRef, 'value', unsubscribe);
}

// Save posts batch to RTDB under /posts/<datasetId>
export async function savePostsToRTDB(datasetId, postsList, user) {
  if (!rtdb || !user) return;
  const postsRef = ref(rtdb, `posts/${datasetId}`);
  const formatted = postsList.slice(0, 1000).map((p, idx) => ({
    id: String(p.id || idx + 1),
    dataset_id: String(datasetId),
    platform: p.platform || 'upload',
    author: p.author || 'unknown',
    text: String(p.text || '').slice(0, 5000),
    sentiment: p.sentiment || 'neutral',
    score: Number(p.score !== undefined ? p.score : 0),
    user_id: user.uid,
    processed_at: p.processed_at || Date.now()
  }));
  await set(postsRef, formatted);
}

// Live Real-Time Posts Listener
export function subscribeToPosts(datasetId, callback) {
  if (!rtdb) {
    callback([]);
    return () => { };
  }
  const targetRef = datasetId ? ref(rtdb, `posts/${datasetId}`) : ref(rtdb, 'posts');
  const unsubscribe = onValue(targetRef, (snapshot) => {
    const val = snapshot.val();
    if (!val) {
      callback([]);
      return;
    }
    if (datasetId) {
      callback(Array.isArray(val) ? val : Object.values(val));
    } else {
      const allPosts = [];
      Object.keys(val).forEach(dsId => {
        const items = Array.isArray(val[dsId]) ? val[dsId] : Object.values(val[dsId]);
        allPosts.push(...items);
      });
      callback(allPosts);
    }
  }, (err) => {
    console.error("RTDB Posts subscribe error:", err);
    callback([]);
  });
  return () => off(targetRef, 'value', unsubscribe);
}

// Save MapReduce Job to RTDB under /jobs/<jobId>
export async function saveJobToRTDB(job, user) {
  if (!rtdb || !user) return null;
  const jobId = String(job.id || `job_${Date.now()}`);
  const jobRef = ref(rtdb, `jobs/${jobId}`);
  const payload = {
    id: jobId,
    dataset_id: String(job.dataset_id),
    status: job.status || 'succeeded',
    positive: Number(job.positive || 0),
    negative: Number(job.negative || 0),
    neutral: Number(job.neutral || 0),
    total: Number((job.positive || 0) + (job.negative || 0) + (job.neutral || 0)),
    log: String(job.log || '').slice(0, 10000),
    user_id: user.uid,
    user_email: user.email || 'unknown',
    started_at: Date.now()
  };
  await set(jobRef, payload);
  return jobId;
}

// Live Real-Time Jobs Listener
export function subscribeToJobs(callback) {
  if (!rtdb) {
    callback([]);
    return () => { };
  }
  const jobsRef = ref(rtdb, 'jobs');
  const unsubscribe = onValue(jobsRef, (snapshot) => {
    const val = snapshot.val();
    if (!val) {
      callback([]);
      return;
    }
    const list = Object.keys(val).map(k => ({ ...val[k], id: val[k].id || k }));
    list.sort((a, b) => (Number(b.started_at) || 0) - (Number(a.started_at) || 0));
    callback(list);
  }, (err) => {
    console.error("RTDB Jobs subscribe error:", err);
    callback([]);
  });
  return () => off(jobsRef, 'value', unsubscribe);
}
