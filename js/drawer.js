import { icon } from "./icons.js";
import { esc, imgTag, badgeTone } from "./util.js";

const root = () => document.getElementById("hb-drawer");
const panel = () => root().querySelector(".hb-drawer__panel");
const body = () => document.getElementById("hb-drawer-body");

let lastFocus = null;
let closeTimer = 0;

function formatDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });
}

function open(html) {
  clearTimeout(closeTimer);
  const el = root();
  if (el.hidden) lastFocus = document.activeElement;
  body().innerHTML = html;
  body().scrollTop = 0;
  el.hidden = false;
  // Ein Frame Pause, damit die CSS-Transition greift
  requestAnimationFrame(() => {
    el.classList.add("is-open");
    panel().focus({ preventScroll: true });
  });
}

export function closeDrawer() {
  const el = root();
  if (el.hidden) return;
  el.classList.remove("is-open");
  closeTimer = setTimeout(() => {
    el.hidden = true;
    body().innerHTML = "";
  }, 260);
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  lastFocus = null;
}

export function isDrawerOpen() {
  return !root().hidden;
}

export function openCountryReport(c) {
  const stats = (c.stats ?? []).map((st) => `
    <li>${icon(st.icon)}<span><strong>${esc(st.value)}</strong><small>${esc(st.label)}</small></span></li>`).join("");
  const paras = (c.report?.paragraphs ?? []).map((p) => `<p>${esc(p)}</p>`).join("");
  const date = formatDate(c.report?.updatedAt);

  open(`
    <div class="hb-report__media">
      ${imgTag(c.coverUrl, 'alt=""', 920)}
      <div class="hb-report__head">
        ${imgTag(c.flagUrl, `class="hb-flag" alt="Flagge ${esc(c.name)}" width="44" height="44"`, 96) || `<span class="hb-flag hb-flag--icon">${icon("globe")}</span>`}
        <div>
          <h2 id="hb-drawer-title">${esc(c.name)}</h2>
          ${c.badge?.text ? `<span class="hb-badge hb-badge--${badgeTone(c.badge.tone)}">${esc(c.badge.text)}</span>` : ""}
        </div>
      </div>
    </div>
    <div class="hb-report__content">
      <ul class="hb-report__stats">${stats}</ul>
      <h3>Lagebericht</h3>
      ${date ? `<p class="hb-report__date">Stand: ${esc(date)}</p>` : ""}
      ${paras || `<p class="hb-empty">Für dieses Land wurde noch kein Bericht eingetragen.</p>`}
    </div>`);
}

export function openProject(p) {
  const tags = (p.tags ?? []).map((t) => `<li>${icon(t.icon)}<span>${esc(t.label)}</span></li>`).join("");
  const paras = (p.paragraphs ?? []).map((x) => `<p>${esc(x)}</p>`).join("");
  open(`
    <div class="hb-report__media hb-report__media--project">
      ${imgTag(p.thumbnailUrl, 'alt=""', 920)}
    </div>
    <div class="hb-report__content">
      <h2 id="hb-drawer-title">${esc(p.name)}</h2>
      <p>${esc(p.description)}</p>
      <ul class="hb-proj__tags">${tags}</ul>
      ${paras}
    </div>`);
}

export function openCountryList(countries) {
  const items = countries.map((c) => `
    <li>
      <button type="button" class="hb-listrow" data-open-report="${esc(c.id)}">
        ${imgTag(c.flagUrl, 'class="hb-flag" alt="" width="36" height="36"', 96) || `<span class="hb-flag hb-flag--icon">${icon("globe")}</span>`}
        <span><strong>${esc(c.name)}</strong><small>${esc(c.badge?.text ?? "")}</small></span>
        ${icon("arrow-right")}
      </button>
    </li>`).join("");
  open(`
    <div class="hb-report__content hb-report__content--list">
      <h2 id="hb-drawer-title">Alle Länder</h2>
      <p class="hb-sub">Wähle ein Land, um den aktuellen Bericht zu lesen.</p>
      <ul class="hb-list">${items}</ul>
    </div>`);
}

/** Einmalig aufrufen: Schließen per Backdrop, Button, Escape und Fokus im Panel halten. */
export function initDrawer() {
  root().addEventListener("click", (e) => {
    if (e.target.closest("[data-drawer-close]")) closeDrawer();
  });
  document.addEventListener("keydown", (e) => {
    if (!isDrawerOpen()) return;
    if (e.key === "Escape") { closeDrawer(); return; }
    if (e.key !== "Tab") return;
    const focusables = [...panel().querySelectorAll("button, a[href], input, [tabindex]:not([tabindex='-1'])")]
      .filter((n) => !n.disabled && n.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel())) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  });
}
