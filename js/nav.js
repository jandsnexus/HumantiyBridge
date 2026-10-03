import { icon } from "./icons.js";
import { esc, imgTag } from "./util.js";

/* ---------- Aktiver Menüpunkt beim Scrollen (Kopfzeile + Seitenmenü gleichzeitig) ---------- */
export function initScrollSpy() {
  const links = [...document.querySelectorAll("[data-nav]")];
  // In DOM-Reihenfolge sortieren: "Über uns" und "Projekte" liegen auf dem Desktop nebeneinander
  const sections = [...new Set(links.map((a) => a.dataset.nav))]
    .map((id) => document.getElementById(id))
    .filter(Boolean)
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const ids = sections.map((s) => s.id);
  let clicked = null;
  let clickedSeen = false;

  const setActive = (id) => {
    links.forEach((a) => {
      const on = a.dataset.nav === id;
      a.classList.toggle("is-active", on);
      if (on) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
    });
  };
  setActive("start");

  const visible = new Map();
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => visible.set(e.target.id, e.isIntersecting));
    // Nach einem Klick den gewählten Punkt halten, bis seine Sektion einmal sichtbar war und wieder verschwindet
    if (clicked) {
      if (visible.get(clicked)) { clickedSeen = true; setActive(clicked); return; }
      if (!clickedSeen) return;
      clicked = null;
      clickedSeen = false;
    }
    // Ganz unten: Kontakt aktiv, auch wenn der Footer kurz ist
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
      setActive("kontakt");
      return;
    }
    const first = ids.find((id) => visible.get(id));
    if (first) setActive(first);
  }, { rootMargin: "-40% 0px -55% 0px" });
  sections.forEach((s) => io.observe(s));

  links.forEach((a) => a.addEventListener("click", () => {
    clicked = a.dataset.nav;
    clickedSeen = Boolean(visible.get(clicked));
    setActive(clicked);
  }));
}

/* ---------- Suche in Kopfzeile: Länder und Projekt ---------- */
export function initSearch(getData, { onCountry, onProject }) {
  const wrap = document.getElementById("hb-search");
  const toggle = document.getElementById("hb-search-toggle");
  const panel = document.getElementById("hb-search-panel");
  const input = document.getElementById("hb-search-input");
  const list = document.getElementById("hb-search-results");

  const setOpen = (open) => {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) { input.value = ""; renderResults(""); input.focus(); }
  };

  function renderResults(q) {
    const data = getData();
    if (!data) { list.innerHTML = ""; return; }
    const needle = q.trim().toLowerCase();
    const countries = data.countries
      .filter((c) => !needle || c.name.toLowerCase().includes(needle))
      .map((c) => ({ type: "country", id: c.id, label: c.name, img: c.flagUrl }));
    const p = data.featuredProject;
    const projects = p && (!needle || p.name.toLowerCase().includes(needle))
      ? [{ type: "project", id: p.id, label: p.name, img: null }] : [];
    const rows = [...countries, ...projects];

    list.innerHTML = rows.length
      ? rows.map((r) => `
        <li role="option">
          <button type="button" data-type="${r.type}" data-id="${esc(r.id)}">
            ${imgTag(r.img, 'class="hb-flag" alt="" width="24" height="24"', 64) || `<span class="hb-flag hb-flag--icon">${icon(r.type === "project" ? "box" : "globe")}</span>`}
            <span>${esc(r.label)}</span>
          </button>
        </li>`).join("")
      : `<li class="hb-search__empty">Kein Treffer für „${esc(q)}“</li>`;
  }

  toggle.addEventListener("click", () => setOpen(panel.hidden));
  input.addEventListener("input", () => renderResults(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      list.querySelector("button")?.click();
    }
  });
  list.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-type]");
    if (!b) return;
    setOpen(false);
    if (b.dataset.type === "country") onCountry(b.dataset.id);
    else onProject();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden) { setOpen(false); toggle.focus(); }
  });
  document.addEventListener("pointerdown", (e) => {
    if (!panel.hidden && !wrap.contains(e.target)) setOpen(false);
  });
}
