/*
 * Lädt Firebase direkt von Googles offiziellem CDN (kein npm/Build nötig, läuft auf GitHub Pages).
 * Die Module werden erst bei Bedarf geladen, damit die Startseite schnell erscheint.
 */
import { FIREBASE_CONFIG, FIREBASE_VERSION } from "./config.js";

const BASE = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/`;
let appPromise = null;
let firestorePromise = null;
let authPromise = null;

function loadApp() {
  appPromise ??= import(`${BASE}firebase-app.js`).then((m) =>
    m.getApps().length ? m.getApp() : m.initializeApp(FIREBASE_CONFIG));
  return appPromise;
}

/** @returns {Promise<{ f: object, db: object }>} f = Firestore-Funktionen, db = Datenbank */
export function loadFirestore() {
  firestorePromise ??= Promise.all([loadApp(), import(`${BASE}firebase-firestore.js`)])
    .then(([app, f]) => ({ f, db: f.getFirestore(app) }));
  return firestorePromise;
}

/** @returns {Promise<{ a: object, auth: object }>} a = Auth-Funktionen, auth = Auth-Instanz */
export function loadAuth() {
  authPromise ??= Promise.all([loadApp(), import(`${BASE}firebase-auth.js`)])
    .then(([app, a]) => ({ a, auth: a.getAuth(app) }));
  return authPromise;
}
