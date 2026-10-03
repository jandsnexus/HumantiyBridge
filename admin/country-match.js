/*
 * Findet zu einem eingetippten Ländernamen die passende Kartenfläche.
 * Versteht Umlaute/ohne Umlaute, englische Namen, Kurzformen ("Kongo", "Gaza")
 * und kleine Tippfehler ("Afganistan").
 */
import { COUNTRIES } from "../js/countries-de.js";

/** Vergleichsform: klein, ohne Akzente, ä=ae=a, nur Buchstaben/Ziffern. */
export function norm(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u")
    .replace(/[^a-z0-9]/g, "");
}

export const byKey = new Map(COUNTRIES.map((c) => [c.k, c]));

const index = new Map(); // Vergleichsform -> [Länder]
const entries = [];      // [{ key, c }]
for (const c of COUNTRIES) {
  const keys = new Set([c.n, ...(c.x ?? [])].map(norm).filter(Boolean));
  for (const key of keys) {
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(c);
    entries.push({ key, c });
  }
}

function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

const unique = (list) => [...new Map(list.map((c) => [c.k, c])).values()];

/**
 * @returns {{ exact: object|null, choices: object[], suggestions: object[] }}
 *   exact: eindeutiger Treffer → wird automatisch markiert
 *   choices: mehrdeutig (z. B. "Congo") → Team wählt
 *   suggestions: "Meintest du …?"
 */
export function matchCountry(input) {
  const q = norm(input);
  if (!q) return { exact: null, choices: [], suggestions: [] };

  const hits = unique(index.get(q) ?? []);
  if (hits.length === 1) return { exact: hits[0], choices: [], suggestions: [] };
  if (hits.length > 1) return { exact: null, choices: hits, suggestions: [] };

  const starts = unique(entries.filter((e) => e.key.startsWith(q)).map((e) => e.c));
  const contains = q.length >= 3 ? unique(entries.filter((e) => e.key.includes(q)).map((e) => e.c)) : [];
  let suggestions = unique([...starts, ...contains]);
  if (!suggestions.length && q.length >= 4) {
    const maxDist = q.length >= 8 ? 2 : 1;
    suggestions = unique(entries
      .map((e) => ({ c: e.c, d: distance(q, e.key) }))
      .filter((x) => x.d <= maxDist)
      .sort((a, b) => a.d - b.d)
      .map((x) => x.c));
  }
  return { exact: null, choices: [], suggestions: suggestions.slice(0, 6) };
}

/** Alle deutschen Namen für die Eingabe-Vorschlagsliste. */
export const countryNames = COUNTRIES.map((c) => c.n);
