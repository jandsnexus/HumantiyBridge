import { icon } from "./icons.js";
import { esc, safeUrl, sizedUrl, imgTag, badgeTone as tone } from "./util.js";

const cssUrl = (u) => `url("${u.replace(/"/g, "%22")}")`;

/* ---------- Rechter Tab: Social Media + Transparenz ---------- */
export function renderFollow(settings) {
  const list = document.getElementById("hb-follow-list");
  const s = settings?.socials ?? {};
  const rows = [
    { icon: "tiktok", title: "TikTok", handle: s.tiktok?.handle, text: "Einblicke direkt aus den Projekten", url: s.tiktok?.url },
    { icon: "instagram", title: "Instagram", handle: s.instagram?.handle, text: "Bilder, Updates und Geschichten", url: s.instagram?.url }
  ];

  const socialHtml = rows.map((r) => {
    const url = safeUrl(r.url);
    const inner = `
      <span class="hb-follow__icon">${icon(r.icon)}</span>
      <span class="hb-follow__text">
        <strong>${esc(r.title)}</strong>
        <span>${esc(r.handle || "")}</span>
        <span class="hb-follow__meta">${url ? esc(r.text) : "Link folgt"}</span>
      </span>`;
    return url
      ? `<li><a class="hb-follow__item" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${inner}</a></li>`
      : `<li><div class="hb-follow__item is-pending">${inner}</div></li>`;
  }).join("");

  list.innerHTML = socialHtml + `
    <li><div class="hb-follow__item">
      <span class="hb-follow__icon">${icon("heart")}</span>
      <span class="hb-follow__text">
        <strong class="hb-follow__big">100%</strong>
        <span class="hb-follow__meta">Transparente Verwendung<br>der Spendengelder</span>
      </span>
    </div></li>`;
}

/* ---------- Krisenländer-Karten ---------- */
function countryCard(c) {
  const stats = (c.stats ?? []).slice(0, 2).map((st) => `
    <li>
      ${icon(st.icon)}
      <span><strong>${esc(st.value)}</strong><small>${esc(st.label)}</small></span>
    </li>`).join("");

  return `
    <div class="hb-card" role="listitem">
      <div class="hb-card__media">
        ${imgTag(c.coverUrl, 'class="hb-card__img" alt="" loading="lazy" decoding="async"', 640)}
        <div class="hb-card__head">
          ${imgTag(c.flagUrl, `class="hb-flag" alt="Flagge ${esc(c.name)}" width="36" height="36"`, 96) || `<span class="hb-flag hb-flag--icon">${icon("globe")}</span>`}
          <div>
            <h3 class="hb-card__name">${esc(c.name)}</h3>
            ${c.badge?.text ? `<span class="hb-badge hb-badge--${tone(c.badge.tone)}">${esc(c.badge.text)}</span>` : ""}
          </div>
        </div>
      </div>
      <div class="hb-card__body">
        <ul class="hb-card__stats">${stats}</ul>
        <button class="hb-pill hb-card__cta" type="button" data-open-report="${esc(c.id)}"
          aria-label="Mehr erfahren über ${esc(c.name)}">
          <span>Mehr erfahren</span>${icon("arrow-right")}
        </button>
      </div>
    </div>`;
}

function moreCard(more) {
  return `
    <div class="hb-card hb-card--more" role="listitem">
      <div class="hb-card__media">
        ${imgTag(more?.coverUrl, 'class="hb-card__img" alt="" loading="lazy" decoding="async"', 640)}
        <div class="hb-card__head">
          <span class="hb-flag hb-flag--icon">${icon("globe")}</span>
          <div>
            <h3 class="hb-card__name">Weitere Länder</h3>
            <span class="hb-badge hb-badge--grey">Auch wichtig</span>
          </div>
        </div>
      </div>
      <div class="hb-card__body">
        <p class="hb-card__more">${esc(more?.text ?? "")}</p>
        <button class="hb-pill hb-card__cta" type="button" data-open-countries>
          <span>Alle Länder anzeigen</span>${icon("arrow-right")}
        </button>
      </div>
    </div>`;
}

export function renderCards(countries, more) {
  const el = document.getElementById("hb-cards");
  const items = countries.map(countryCard).join("");
  el.innerHTML = items + moreCard(more);
  el.removeAttribute("aria-busy");
}

/* ---------- Projekt unten Mitte ---------- */
export function renderProject(p) {
  const el = document.getElementById("hb-project");
  if (!p) {
    el.innerHTML = `<p class="hb-empty">Hier erscheint das Projekt, das im Admin als Startseiten-Projekt markiert ist.</p>`;
    return;
  }
  const [left, right] = p.badges ?? [];
  const tags = (p.tags ?? []).map((t) => `<li>${icon(t.icon)}<span>${esc(t.label)}</span></li>`).join("");
  el.innerHTML = `
    <article class="hb-proj">
      <div class="hb-proj__media">
        ${imgTag(p.thumbnailUrl, 'alt="" loading="lazy" decoding="async"', 760)}
        ${left ? `<span class="hb-tag hb-tag--left">${esc(left)}</span>` : ""}
        ${right ? `<span class="hb-tag hb-tag--right">${esc(right)}</span>` : ""}
      </div>
      <div class="hb-proj__body">
        <h3 class="hb-proj__title">${esc(p.name)}</h3>
        <p class="hb-proj__text">${esc(p.description)}</p>
        <ul class="hb-proj__tags">${tags}</ul>
        <button class="hb-pill" type="button" data-open-project>
          <span>Mehr über dieses Projekt</span>${icon("arrow-right")}
        </button>
      </div>
    </article>`;
}

/* ---------- Zitat-Hintergrund ---------- */
export function renderQuote(settings) {
  const url = sizedUrl(settings?.quoteBackgroundUrl, 1200);
  // Direkt als Inline-Style: url() in CSS-Variablen würde relativ zur CSS-Datei aufgelöst
  document.getElementById("hb-quote").style.backgroundImage = url ? cssUrl(url) : "none";
}

/* ---------- Footer ---------- */
export function renderFooter(settings) {
  const s = settings?.socials ?? {};
  const links = [["tiktok", "TikTok", s.tiktok?.url], ["instagram", "Instagram", s.instagram?.url]]
    .map(([ic, label, url]) => {
      const u = safeUrl(url);
      return u
        ? `<a class="hb-iconbtn" href="${esc(u)}" target="_blank" rel="noopener noreferrer" aria-label="${label}">${icon(ic)}</a>`
        : `<span class="hb-iconbtn is-pending" role="img" title="${label}: Link folgt" aria-label="${label}: Link folgt">${icon(ic)}</span>`;
    }).join("");
  document.getElementById("hb-footer-social").innerHTML = links;
  document.getElementById("hb-year").textContent = new Date().getFullYear();
}

/* ---------- Spenden-Buttons (Schalter kommt später aus dem Admin) ---------- */
export function applyDonationState(enabled) {
  document.querySelectorAll("[data-donate]").forEach((btn) => {
    btn.classList.toggle("is-disabled", !enabled);
    btn.setAttribute("aria-disabled", String(!enabled));
    if (!enabled) btn.title = "Spenden bald verfügbar";
    else btn.removeAttribute("title");
  });
}

/* ---------- Kein Inhalt verfügbar (erster Besuch + offline oder blockiert) ---------- */
export function renderUnavailable() {
  const msg = "Die Inhalte konnten gerade nicht geladen werden. Bitte prüfe deine Verbindung und lade die Seite neu.";
  document.getElementById("hb-cards").innerHTML = `<p class="hb-empty hb-empty--box">${msg}</p>`;
  document.getElementById("hb-project").innerHTML = "";
  renderFollow({});
  renderFooter({});
  applyDonationState(false);
}
