import { icon } from "./icons.js";

/** Text sicher in HTML einsetzen (Admin-Daten sind immer untrusted). */
export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Nur relative Pfade, http(s) und Bild-Data-URIs erlauben. Alles andere (z. B. javascript:) wird leer. */
export function safeUrl(url) {
  const u = String(url ?? "").trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  if (/^data:image\/(png|jpe?g|webp|gif|svg\+xml);/i.test(u)) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return "";
  return u;
}

/** Ersetzt alle [data-icon]-Platzhalter in root durch SVG-Icons. Mehrfach aufrufbar. */
export function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    if (el.dataset.iconDone) return;
    el.insertAdjacentHTML("afterbegin", icon(el.dataset.icon));
    el.dataset.iconDone = "1";
  });
}

let toastTimer = 0;
export function toast(message) {
  const el = document.getElementById("hb-toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), 2600);
}

const BADGE_TONES = new Set(["red", "orange", "blue", "grey"]);
/** Nur bekannte Badge-Farben zulassen, sonst grau. */
export const badgeTone = (t) => (BADGE_TONES.has(t) ? t : "grey");

/** Nur Hex-Farben zulassen (Admin-Eingabe landet in style-Attributen). */
export const safeColor = (c, fallback = "#3d7bf5") =>
  /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(c ?? "")) ? c : fallback;

/**
 * Cloudinary-Bilder in passender Größe anfordern (spart Datenvolumen + Credits).
 * Liefert für Retina die doppelte Breite. Andere URLs bleiben unverändert.
 */
export function sizedUrl(url, width) {
  const u = safeUrl(url);
  if (!width || !/^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//.test(u)) return u;
  return u.replace("/image/upload/", `/image/upload/f_auto,q_auto,c_limit,w_${Math.round(width)}/`);
}

/** <img> nur ausgeben, wenn es eine gültige URL gibt. Sonst bleibt der Farbverlauf dahinter sichtbar. */
export function imgTag(url, attrs = "", width = 0) {
  const u = sizedUrl(url, width);
  return u ? `<img src="${esc(u)}" ${attrs}>` : "";
}

/*
 * Social-Media-Links vervollständigen. Ohne "https://" würde der Browser den Link als Unterseite
 * der eigenen Website öffnen (→ 404 auf GitHub). Akzeptiert:
 *   https://www.tiktok.com/@name · www.tiktok.com/@name · tiktok.com/@name · vm.tiktok.com/xyz · @name · name
 * Gibt einen vollständigen https-Link zurück oder "" (ungültig → "Link folgt").
 */
const SOCIAL = {
  tiktok: { hosts: /^(www\.|m\.|vm\.|vt\.)?tiktok\.com(\/|$)/i, profile: (h) => `https://www.tiktok.com/@${h}` },
  instagram: { hosts: /^(www\.|m\.)?(instagram\.com|instagr\.am)(\/|$)/i, profile: (h) => `https://www.instagram.com/${h}/` }
};

export function socialUrl(input, platform) {
  const v = String(input ?? "").trim();
  const cfg = SOCIAL[platform];
  if (!v || !cfg) return "";
  // Nur ein Name (mit oder ohne @) → Profil-Link bauen
  const handle = v.match(/^@?([A-Za-z0-9._]{2,30})$/);
  if (handle && !handle[1].includes("..") && !/\.(com|de|net|org|am)$/i.test(handle[1])) return cfg.profile(handle[1]);
  // http(s) vorne ergänzen bzw. auf https umstellen
  const withScheme = /^https?:\/\//i.test(v) ? v.replace(/^http:\/\//i, "https://") : `https://${v}`;
  let url;
  try { url = new URL(withScheme); } catch (e) { return ""; }
  if (url.protocol !== "https:" || /\s/.test(v)) return "";
  // Muss zur Plattform passen (z. B. kein Instagram-Link im TikTok-Feld)
  if (!cfg.hosts.test(url.host + url.pathname.slice(0, 1))) return "";
  return url.href;
}
