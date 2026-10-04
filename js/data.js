/*
 * Datenquelle der Startseite: live aus Firestore ("site/home").
 * - Wiederholte Besuche zeigen sofort den zuletzt gespeicherten Stand (localStorage), dann live.
 * - Solange im Admin noch nichts veröffentlicht wurde, erscheinen die Beispieldaten.
 * - Jede Änderung im Admin erscheint ohne Neuladen.
 */
import { loadFirestore } from "./firebase.js";
import { SITE_DOC } from "./config.js";
import { SAMPLE_DATA, PROJECT_TAGS } from "./sample-data.js";

const CACHE_KEY = "hb-site-cache-v1";

const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === "string" ? v : "");
const paragraphs = (text) => str(text).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

/**
 * Wochenbericht. Erscheint nur, wenn im Admin eingeschaltet UND Überschrift + Text vorhanden sind.
 * Statistiken und Quellen sind optional; leere werden weggelassen.
 */
function normalizeWeekly(w) {
  const r = w && typeof w === "object" ? w : {};
  const out = {
    title: str(r.title).trim(),
    date: str(r.date),
    imageUrl: str(r.imageUrl),
    imageCredit: str(r.imageCredit).trim(),
    teaser: str(r.teaser).trim(),
    paragraphs: paragraphs(r.text),
    stats: arr(r.stats).slice(0, 3)
      .map((st) => ({ icon: str(st?.icon), value: str(st?.value).trim(), label: str(st?.label).trim() }))
      .filter((st) => st.value || st.label),
    sources: arr(r.sources)
      .map((q) => ({ title: str(q?.title).slice(0, 120), url: str(q?.url).trim() }))
      .filter((q) => /^https?:\/\/\S+\.\S+/i.test(q.url))
      .slice(0, 10)
  };
  out.show = r.visible === true && !!out.title && out.paragraphs.length > 0;
  return out;
}

/** Bringt gespeicherte Daten (egal wie unvollständig) in die Form, die die Startseite rendert. */
export function normalizeSite(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const s = r.settings ?? {};
  const projects = arr(r.projects).filter((p) => p && str(p.name));
  const featured = projects.find((p) => p.featured) ?? projects[0] ?? null;

  return {
    settings: {
      donationsEnabled: s.donationsEnabled === true,
      socials: {
        tiktok: { url: str(s.socials?.tiktok?.url), handle: str(s.socials?.tiktok?.handle) },
        instagram: { url: str(s.socials?.instagram?.url), handle: str(s.socials?.instagram?.handle) }
      },
      quoteBackgroundUrl: str(s.quoteBackgroundUrl),
      weekly: normalizeWeekly(s.weekly)
    },
    countries: arr(r.countries)
      .filter((c) => c && c.visible !== false && str(c.name) && str(c.id))
      .map((c) => ({
        id: c.id,
        name: c.name,
        isoNumeric: str(c.isoNumeric),
        mapColor: str(c.mapColor),
        flagUrl: str(c.flagUrl),
        coverUrl: str(c.coverUrl),
        badge: { text: str(c.badge?.text), tone: str(c.badge?.tone) },
        stats: arr(c.stats).slice(0, 2).map((st) => ({ icon: str(st?.icon), value: str(st?.value), label: str(st?.label) }))
          .filter((st) => st.value || st.label),
        report: {
          updatedAt: str(c.report?.updatedAt),
          paragraphs: paragraphs(c.report?.text),
          // Quellen: nur echte http(s)-Links, max. 10
          sources: arr(c.report?.sources)
            .map((q) => ({ title: str(q?.title).slice(0, 120), url: str(q?.url).trim() }))
            .filter((q) => /^https?:\/\/\S+\.\S+/i.test(q.url))
            .slice(0, 10)
        }
      })),
    moreCountries: { text: str(r.moreCountries?.text), coverUrl: str(r.moreCountries?.coverUrl) },
    featuredProject: featured && {
      id: str(featured.id),
      name: featured.name,
      thumbnailUrl: str(featured.thumbnailUrl),
      badges: arr(featured.badges).map(str),
      description: str(featured.description),
      tags: arr(featured.tags).map((label) => ({ icon: PROJECT_TAGS[label] ?? "box", label: str(label) })),
      paragraphs: paragraphs(featured.text)
    }
  };
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function writeCache(data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (e) { /* Speicher voll/privat */ }
}

/**
 * Live-Abo. onData(site | null, source) mit source = "cache" | "live" | "sample" | "error".
 * null bedeutet: nichts verfügbar (offline beim allerersten Besuch).
 * Gibt eine Abmelde-Funktion zurück.
 */
export function subscribeSiteData(onData) {
  let stopped = false;
  let unsubscribe = () => {};
  const cached = readCache();
  if (cached) onData(normalizeSite(cached), "cache");

  loadFirestore()
    .then(({ f, db }) => {
      if (stopped) return;
      unsubscribe = f.onSnapshot(
        f.doc(db, ...SITE_DOC),
        (snap) => {
          if (snap.exists()) {
            const { updatedAt, ...data } = snap.data(); // Zeitstempel nicht cachen
            writeCache(data);
            onData(normalizeSite(data), "live");
          } else {
            onData(normalizeSite(SAMPLE_DATA), "sample");
          }
        },
        (err) => {
          console.error("Firestore:", err);
          if (!cached) onData(null, "error");
        }
      );
    })
    .catch((err) => {
      console.error("Firebase konnte nicht geladen werden:", err);
      if (!cached) onData(null, "error");
    });

  return () => { stopped = true; unsubscribe(); };
}
