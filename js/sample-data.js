/*
 * Beispieldaten im exakten Format des Firestore-Dokuments "site/home".
 * Werden genutzt: (1) auf der Startseite, solange noch nichts veröffentlicht wurde,
 * (2) im Admin über "Mit Beispieldaten starten". Alles hier sind PLATZHALTER.
 */
export const flagUrlFor = (code) =>
  code ? `https://cdn.jsdelivr.net/npm/flag-icons@7.5.0/flags/1x1/${code}.svg` : "";

const country = (id, name, isoNumeric, flagCode, mapColor, badge, stats, text) => ({
  id, name, isoNumeric, flagCode, flagUrl: flagUrlFor(flagCode), flagCustom: false,
  mapColor, coverUrl: "", badge, stats, visible: true,
  report: { updatedAt: "2026-09-28", text }
});

export const SAMPLE_DATA = {
  settings: {
    donationsEnabled: false,
    socials: {
      tiktok: { url: "", handle: "@humanitybridge" },
      instagram: { url: "", handle: "@humanitybridge" }
    },
    quoteBackgroundUrl: ""
  },
  countries: [
    country("sudan", "Sudan", "729", "sd", "#ff3b4e", { text: "Akute Kriegslage", tone: "red" },
      [{ icon: "users", value: "48 Mio.", label: "Betroffene" }, { icon: "chart-pie", value: "70%", label: "ohne ausreichende Nahrung" }],
      "Platzhalter: Hier steht der Lagebericht zum Sudan, den euer Team im Admin einträgt.\n\nZum Beispiel: aktuelle Situation, wo eure Hilfe ankommt und welche Projekte gerade laufen."),
    country("palaestina", "Palästina", "275", "ps", "#ff4d6d", { text: "Humanitäre Krise", tone: "red" },
      [{ icon: "users", value: "2,3 Mio.", label: "Binnenvertriebene" }, { icon: "heart", value: "90%", label: "benötigen humanitäre Hilfe" }],
      "Platzhalter: Hier steht der Lagebericht zu Palästina, den euer Team im Admin einträgt."),
    country("afghanistan", "Afghanistan", "004", "af", "#ff8a1f", { text: "Hungersnot droht", tone: "orange" },
      [{ icon: "users", value: "23 Mio.", label: "Menschen in Not" }, { icon: "droplet", value: "60%", label: "keinen Zugang zu sauberem Wasser" }],
      "Platzhalter: Hier steht der Lagebericht zu Afghanistan, den euer Team im Admin einträgt."),
    country("kongo", "Dem. Rep. Kongo", "180", "cd", "#9b6bff", { text: "Konflikt & Gewalt", tone: "blue" },
      [{ icon: "users", value: "7,9 Mio.", label: "Binnenvertriebene" }, { icon: "heart", value: "50%", label: "unterernährt" }],
      "Platzhalter: Hier steht der Lagebericht zur Dem. Rep. Kongo, den euer Team im Admin einträgt.")
  ],
  moreCountries: {
    text: "z. B. Jemen, Syrien, Ukraine, Südsudan & mehr.",
    coverUrl: ""
  },
  projects: [
    {
      id: "food-camp",
      name: "Essen & Trinken für Familien",
      thumbnailUrl: "",
      badges: ["Projekt-Beispiel", "Food-Camp"],
      description: "In den Krisengebieten werden mobile Food-Camps aufgebaut, in denen Familien täglich mit Lebensmitteln, Trinkwasser und wichtigen Hilfsgütern versorgt werden.",
      tags: ["Lebensmittel", "Trinkwasser", "Hygiene", "Medizin"],
      text: "Platzhalter: Ausführliche Projektbeschreibung, die euer Team im Admin einträgt.",
      featured: true
    }
  ]
};

/** Auswahl für Statistik-Icons im Admin (Icon-Name → Bezeichnung). */
export const STAT_ICONS = {
  users: "Menschen",
  "chart-pie": "Anteil",
  heart: "Herz",
  droplet: "Wasser",
  utensils: "Essen",
  pill: "Medizin",
  house: "Unterkunft",
  "book-open": "Bildung"
};

/** Projekt-Tags mit festem Icon. */
export const PROJECT_TAGS = {
  Lebensmittel: "utensils",
  Trinkwasser: "droplet",
  Hygiene: "spray-can",
  Medizin: "pill",
  Unterkunft: "house",
  Bildung: "book-open",
  Kleidung: "shirt"
};
