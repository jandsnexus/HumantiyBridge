/*
 * Bericht-Fenster (Länderbericht, Projekt, Länderliste).
 * Mittig auf allen Geräten, Hintergrund abgedunkelt, dunkelblaues Design.
 * Länderbericht mit zwei Tabs: "Lagebericht" und "Quellen".
 */
import { icon } from "./icons.js";
import { esc, imgTag, badgeTone, safeUrl } from "./util.js";
import { weeklyMeta } from "./render.js";

const root = () => document.getElementById("hb-drawer");
const panel = () => root().querySelector(".hb-drawer__panel");
const body = () => document.getElementById("hb-drawer-body");

let lastFocus = null;
let closeTimer = 0;

function formatDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return ""; }
}

function open(html, variant = "") {
  clearTimeout(closeTimer);
  const el = root();
  if (el.hidden) lastFocus = document.activeElement;
  // Länderliste: feste Fensterhöhe, damit das Suchfeld beim Filtern nicht springt
  panel().classList.toggle("hb-drawer__panel--list", variant === "list");
  body().innerHTML = html;
  panel().scrollTop = 0;
  el.hidden = false;
  document.documentElement.classList.add("hb-modal-open"); // Seite dahinter scrollt nicht mit
  requestAnimationFrame(() => {
    el.classList.add("is-open");
    panel().focus({ preventScroll: true });
  });
}

export function closeDrawer() {
  const el = root();
  if (el.hidden) return;
  el.classList.remove("is-open");
  document.documentElement.classList.remove("hb-modal-open");
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

/* ---------- Quellen als eigener Tab ---------- */
function sourcesPanel(sources) {
  const items = (sources ?? []).map((q, i) => {
    const url = safeUrl(q.url);
    if (!url) return "";
    const host = hostOf(url);
    return `
      <li>
        <a class="hb-source" href="${esc(url)}" target="_blank" rel="noopener noreferrer">
          <span class="hb-source__num" aria-hidden="true">${i + 1}</span>
          <span class="hb-source__text">
            <strong>${esc(q.title || host)}</strong>
            <span>${esc(host)}</span>
          </span>
          ${icon("external-link", "hb-source__ext")}
        </a>
      </li>`;
  }).join("");
  return items;
}

export function openCountryReport(c) {
  const stats = (c.stats ?? []).map((st) => `
    <li>${icon(st.icon)}<span><strong>${esc(st.value)}</strong><small>${esc(st.label)}</small></span></li>`).join("");
  const paras = (c.report?.paragraphs ?? []).map((p) => `<p>${esc(p)}</p>`).join("");
  const date = formatDate(c.report?.updatedAt);
  const sources = sourcesPanel(c.report?.sources);
  const count = (c.report?.sources ?? []).filter((q) => safeUrl(q.url)).length;

  open(`
    <div class="hb-report__media">
      ${imgTag(c.coverUrl, 'alt=""', 1200)}
      <div class="hb-report__head">
        ${imgTag(c.flagUrl, `class="hb-flag" alt="Flagge ${esc(c.name)}" width="48" height="48"`, 96) || `<span class="hb-flag hb-flag--icon">${icon("globe")}</span>`}
        <div>
          <h2 id="hb-drawer-title">${esc(c.name)}</h2>
          ${c.badge?.text ? `<span class="hb-badge hb-badge--${badgeTone(c.badge.tone)}">${esc(c.badge.text)}</span>` : ""}
        </div>
      </div>
    </div>
    <div class="hb-report__content">
      ${stats ? `<ul class="hb-report__stats">${stats}</ul>` : ""}

      <div class="hb-tabs" role="tablist" aria-label="Bericht und Quellen">
        <button type="button" role="tab" class="hb-tab" id="hb-tab-report" aria-controls="hb-panel-report" aria-selected="true">Lagebericht</button>
        ${count ? `<button type="button" role="tab" class="hb-tab" id="hb-tab-sources" aria-controls="hb-panel-sources" aria-selected="false" tabindex="-1">Quellen <span class="hb-tab__count">${count}</span></button>` : ""}
      </div>

      <section class="hb-tabpanel" role="tabpanel" id="hb-panel-report" aria-labelledby="hb-tab-report" tabindex="0">
        ${date ? `<p class="hb-report__date">Stand: ${esc(date)}</p>` : ""}
        <div class="hb-report__text">
          ${paras || `<p class="hb-empty">Für dieses Land wurde noch kein Bericht eingetragen.</p>`}
        </div>
      </section>

      ${count ? `
      <section class="hb-tabpanel" role="tabpanel" id="hb-panel-sources" aria-labelledby="hb-tab-sources" tabindex="0" hidden>
        <p class="hb-report__date">Die Angaben in diesem Bericht stützen sich auf folgende Quellen. Externe Links öffnen sich in einem neuen Tab.</p>
        <ol class="hb-sources">${sources}</ol>
      </section>` : ""}
    </div>`);
}

/** Wochenbericht im Zeitungsstil: Foto, Überschrift, optionale Statistiken, Tabs „Bericht“ / „Quellen“. */
export function openWeekly(w) {
  const stats = (w.stats ?? []).map((st) => `
    <li>${icon(st.icon || "chart-pie")}<span><strong>${esc(st.value)}</strong><small>${esc(st.label)}</small></span></li>`).join("");
  const paras = (w.paragraphs ?? []).map((p) => `<p>${esc(p)}</p>`).join("");
  const sources = sourcesPanel(w.sources);
  const count = (w.sources ?? []).filter((q) => safeUrl(q.url)).length;
  const img = imgTag(w.imageUrl, 'alt=""', 1200);

  open(`
    ${img ? `<figure class="hb-report__media hb-report__media--weekly">${img}${w.imageCredit ? `<figcaption class="hb-report__credit">${esc(w.imageCredit)}</figcaption>` : ""}</figure>` : ""}
    <div class="hb-report__content hb-report__content--weekly">
      <p class="hb-weekly__kicker">${icon("file-text")}<span>${esc(weeklyMeta(w.date))}</span></p>
      <h2 class="hb-report__headline" id="hb-drawer-title">${esc(w.title)}</h2>
      ${w.teaser ? `<p class="hb-report__lead">${esc(w.teaser)}</p>` : ""}
      ${stats ? `<ul class="hb-report__stats">${stats}</ul>` : ""}

      <div class="hb-tabs" role="tablist" aria-label="Bericht und Quellen">
        <button type="button" role="tab" class="hb-tab" id="hb-tab-report" aria-controls="hb-panel-report" aria-selected="true">Bericht</button>
        ${count ? `<button type="button" role="tab" class="hb-tab" id="hb-tab-sources" aria-controls="hb-panel-sources" aria-selected="false" tabindex="-1">Quellen <span class="hb-tab__count">${count}</span></button>` : ""}
      </div>

      <section class="hb-tabpanel" role="tabpanel" id="hb-panel-report" aria-labelledby="hb-tab-report" tabindex="0">
        <div class="hb-report__text">${paras}</div>
      </section>

      ${count ? `
      <section class="hb-tabpanel" role="tabpanel" id="hb-panel-sources" aria-labelledby="hb-tab-sources" tabindex="0" hidden>
        <p class="hb-report__date">Die Angaben in diesem Bericht stützen sich auf folgende Quellen. Externe Links öffnen sich in einem neuen Tab.</p>
        <ol class="hb-sources">${sources}</ol>
      </section>` : ""}
    </div>`);
}

export function openProject(p) {
  const tags = (p.tags ?? []).map((t) => `<li>${icon(t.icon)}<span>${esc(t.label)}</span></li>`).join("");
  const paras = (p.paragraphs ?? []).map((x) => `<p>${esc(x)}</p>`).join("");
  open(`
    <div class="hb-report__media hb-report__media--project">
      ${imgTag(p.thumbnailUrl, 'alt=""', 1200)}
      <div class="hb-report__head">
        <div><h2 id="hb-drawer-title">${esc(p.name)}</h2></div>
      </div>
    </div>
    <div class="hb-report__content">
      ${p.description ? `<p class="hb-report__lead">${esc(p.description)}</p>` : ""}
      ${tags ? `<ul class="hb-proj__tags">${tags}</ul>` : ""}
      <div class="hb-report__text">${paras}</div>
    </div>`);
}

/** Vergleichsform für die Suche: klein, ohne Akzente, ä = ae = a (so findet „sued“ auch „Südsudan“). */
const searchNorm = (v) => String(v ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/ß/g, "ss").replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u").replace(/[^a-z0-9]/g, "");

export function openCountryList(countries) {
  const items = countries.map((c) => `
    <li data-search="${esc(searchNorm(`${c.name} ${c.badge?.text ?? ""}`))}">
      <button type="button" class="hb-listrow" data-open-report="${esc(c.id)}">
        ${imgTag(c.flagUrl, 'class="hb-flag" alt="" width="36" height="36"', 96) || `<span class="hb-flag hb-flag--icon">${icon("globe")}</span>`}
        <span><strong>${esc(c.name)}</strong><small>${esc(c.badge?.text ?? "")}</small></span>
        ${icon("arrow-right")}
      </button>
    </li>`).join("");
  open(`
    <div class="hb-report__content hb-report__content--list">
      <h2 id="hb-drawer-title">Alle Länder</h2>
      <p class="hb-report__date">Wähle ein Land, um den aktuellen Bericht zu lesen.</p>
      ${countries.length > 1 ? `
      <label class="hb-countrysearch">
        ${icon("search")}
        <span class="hb-visually-hidden">Land suchen</span>
        <input type="search" data-country-search placeholder="Land suchen …" autocomplete="off" enterkeyhint="search">
      </label>
      <p class="hb-countrysearch__count" data-country-count aria-live="polite">${countries.length} ${countries.length === 1 ? "Land" : "Länder"}</p>` : ""}
      <ul class="hb-list" data-country-list>${items}</ul>
      <p class="hb-empty" data-country-empty hidden>Kein Land gefunden. Versuch es mit einer anderen Schreibweise.</p>
    </div>`, "list");
}

function filterCountryList(input) {
  const wrap = input.closest(".hb-report__content");
  const q = searchNorm(input.value);
  let hits = 0;
  wrap.querySelectorAll("[data-country-list] > li").forEach((li) => {
    const show = !q || li.dataset.search.includes(q);
    li.hidden = !show;
    if (show) hits++;
  });
  wrap.querySelector("[data-country-empty]").hidden = hits > 0;
  wrap.querySelector("[data-country-count]").textContent = q
    ? `${hits} Treffer`
    : `${hits} ${hits === 1 ? "Land" : "Länder"}`;
}

/* ---------- Tabs: Klick + Pfeiltasten (Standard-Bedienung für Tabs) ---------- */
function selectTab(tab, focus = false) {
  const list = tab.closest('[role="tablist"]');
  list.querySelectorAll('[role="tab"]').forEach((t) => {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    const panelEl = document.getElementById(t.getAttribute("aria-controls"));
    if (panelEl) panelEl.hidden = !on;
  });
  if (focus) tab.focus();
}

/** Einmalig aufrufen: Schließen per Hintergrund, Button, Escape; Tabs; Fokus im Fenster halten. */
export function initDrawer() {
  root().addEventListener("click", (e) => {
    if (e.target.closest("[data-drawer-close]")) { closeDrawer(); return; }
    const tab = e.target.closest('[role="tab"]');
    if (tab) selectTab(tab);
  });
  root().addEventListener("input", (e) => {
    if (e.target.matches("[data-country-search]")) filterCountryList(e.target);
  });
  root().addEventListener("keydown", (e) => {
    // Enter in der Suche öffnet den ersten Treffer
    if (e.key === "Enter" && e.target.matches("[data-country-search]")) {
      e.preventDefault();
      root().querySelector("[data-country-list] > li:not([hidden]) .hb-listrow")?.click();
      return;
    }
    const tab = e.target.closest('[role="tab"]');
    if (!tab) return;
    const tabs = [...tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]')];
    const i = tabs.indexOf(tab);
    const next = e.key === "ArrowRight" ? tabs[(i + 1) % tabs.length]
      : e.key === "ArrowLeft" ? tabs[(i - 1 + tabs.length) % tabs.length]
      : e.key === "Home" ? tabs[0]
      : e.key === "End" ? tabs[tabs.length - 1] : null;
    if (next) { e.preventDefault(); selectTab(next, true); }
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
