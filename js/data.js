/*
 * Datenquelle der Startseite.
 * Phase 2: Dummy-Daten, exakt in der Form des späteren Firestore-Sammel-Dokuments "public/home".
 * Phase 5: Nur loadSiteData()/subscribeSiteData() werden auf Firestore umgestellt, der Rest bleibt.
 *
 * Alle Zahlen, Texte und Bilder hier sind PLATZHALTER und werden später im Admin gepflegt.
 * Leere Bild-URLs ("") zeigen einen Farbverlauf, bis im Admin ein Bild hochgeladen ist.
 */

// Platzhalter-Flaggen vom CDN. Später lädt dein Team eigene Flaggen im Admin hoch.
const FLAG = (code) => `https://cdn.jsdelivr.net/npm/flag-icons@7.5.0/flags/1x1/${code}.svg`;

const DUMMY = {
  settings: {
    donationsEnabled: false,
    socials: {
      tiktok:    { url: "", handle: "@humanitybridge" },
      instagram: { url: "", handle: "@humanitybridge" }
    },
    quoteBackgroundUrl: ""
  },

  countries: [
    {
      id: "sudan",
      name: "Sudan",
      isoNumeric: "729",
      mapColor: "#ff3b4e",
      flagUrl: FLAG("sd"),
      coverUrl: "",
      badge: { text: "Akute Kriegslage", tone: "red" },
      stats: [
        { icon: "users", value: "48 Mio.", label: "Betroffene" },
        { icon: "chart-pie", value: "70%", label: "ohne ausreichende Nahrung" }
      ],
      report: {
        updatedAt: "2026-09-28",
        paragraphs: [
          "Platzhalter: Hier steht der Lagebericht zum Sudan, den euer Team im Admin einträgt.",
          "Zum Beispiel: aktuelle Situation, wo eure Hilfe ankommt und welche Projekte gerade laufen."
        ]
      }
    },
    {
      id: "palaestina",
      name: "Palästina",
      isoNumeric: "275",
      mapColor: "#ff4d6d",
      flagUrl: FLAG("ps"),
      coverUrl: "",
      badge: { text: "Humanitäre Krise", tone: "red" },
      stats: [
        { icon: "users", value: "2,3 Mio.", label: "Binnenvertriebene" },
        { icon: "heart", value: "90%", label: "benötigen humanitäre Hilfe" }
      ],
      report: {
        updatedAt: "2026-09-28",
        paragraphs: [
          "Platzhalter: Hier steht der Lagebericht zu Palästina, den euer Team im Admin einträgt."
        ]
      }
    },
    {
      id: "afghanistan",
      name: "Afghanistan",
      isoNumeric: "004",
      mapColor: "#ff8a1f",
      flagUrl: FLAG("af"),
      coverUrl: "",
      badge: { text: "Hungersnot droht", tone: "orange" },
      stats: [
        { icon: "users", value: "23 Mio.", label: "Menschen in Not" },
        { icon: "heart", value: "60%", label: "keinen Zugang zu sauberem Wasser" }
      ],
      report: {
        updatedAt: "2026-09-28",
        paragraphs: [
          "Platzhalter: Hier steht der Lagebericht zu Afghanistan, den euer Team im Admin einträgt."
        ]
      }
    },
    {
      id: "kongo",
      name: "Dem. Rep. Kongo",
      isoNumeric: "180",
      mapColor: "#9b6bff",
      flagUrl: FLAG("cd"),
      coverUrl: "",
      badge: { text: "Konflikt & Gewalt", tone: "blue" },
      stats: [
        { icon: "users", value: "7,9 Mio.", label: "Binnenvertriebene" },
        { icon: "heart", value: "50%", label: "unterernährt" }
      ],
      report: {
        updatedAt: "2026-09-28",
        paragraphs: [
          "Platzhalter: Hier steht der Lagebericht zur Dem. Rep. Kongo, den euer Team im Admin einträgt."
        ]
      }
    }
  ],

  moreCountries: {
    text: "z. B. Jemen, Syrien, Ukraine, Südsudan & mehr.",
    coverUrl: ""
  },

  featuredProject: {
    id: "food-camp",
    name: "Essen & Trinken für Familien",
    thumbnailUrl: "",
    badges: ["Projekt-Beispiel", "Food-Camp"],
    description: "In den Krisengebieten werden mobile Food-Camps aufgebaut, in denen Familien täglich mit Lebensmitteln, Trinkwasser und wichtigen Hilfsgütern versorgt werden.",
    tags: [
      { icon: "utensils", label: "Lebensmittel" },
      { icon: "droplet", label: "Trinkwasser" },
      { icon: "spray-can", label: "Hygiene" },
      { icon: "pill", label: "Medizin" }
    ],
    paragraphs: [
      "Platzhalter: Ausführliche Projektbeschreibung, die euer Team im Admin einträgt."
    ]
  }
};

/** Einmaliges Laden. Gibt eine Kopie zurück, damit niemand die Quelle verändert. */
export async function loadSiteData() {
  return structuredClone(DUMMY);
}

/**
 * Live-Abo. Phase 5: wird zu onSnapshot(doc(db, "public", "home"), ...).
 * Gibt eine Funktion zum Abmelden zurück, wie Firestore.
 */
export function subscribeSiteData(onData) {
  let active = true;
  loadSiteData().then((d) => { if (active) onData(d); });
  return () => { active = false; };
}
