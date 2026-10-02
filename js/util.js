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

/** <img> nur ausgeben, wenn es eine gültige URL gibt. Sonst bleibt der Farbverlauf dahinter sichtbar. */
export function imgTag(url, attrs = "") {
  const u = safeUrl(url);
  return u ? `<img src="${esc(u)}" ${attrs}>` : "";
}
