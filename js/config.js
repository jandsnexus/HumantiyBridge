/*
 * Projekt-Konfiguration. Diese Werte sind öffentlich und stehen bei jeder Firebase-Website im Code.
 * Geschützt wird alles über die Firestore-Regeln (nur ADMIN_UID darf schreiben).
 * NIE hier eintragen: Passwörter, Cloudinary API Secret oder API Key.
 */
export const FIREBASE_VERSION = "12.19.0";

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAz1sgItlAX_J2BumYpdLf3lZ6XdgT9shM",
  authDomain: "humantiybridge-b856e.firebaseapp.com",
  projectId: "humantiybridge-b856e",
  storageBucket: "humantiybridge-b856e.firebasestorage.app",
  messagingSenderId: "638635125302",
  appId: "1:638635125302:web:9f5550274d284bfc508697"
};

/** Der eine gemeinsame Team-Account. */
export const ADMIN_UID = "8Vd62vz664Pq5W4AyRl8NN5VqsX2";

export const CLOUDINARY = {
  cloudName: "qaxlsxbv",
  uploadPreset: "hb_admin_k7q2x9"
};

/** Das eine Sammel-Dokument, das die Startseite liest (1 Lesezugriff pro Besucher). */
export const SITE_DOC = ["site", "home"];
