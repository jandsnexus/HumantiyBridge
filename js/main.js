import { subscribeSiteData } from "./data.js";
import { hydrateIcons, toast } from "./util.js";
import { renderFollow, renderCards, renderProject, renderQuote, renderFooter, applyDonationState } from "./render.js";
import { initDrawer, openCountryReport, openProject, openCountryList } from "./drawer.js";
import { createMap } from "./map.js";
import { initLoader } from "./loader.js";
import { initScrollSpy, initSearch } from "./nav.js";

let site = null;

const findCountry = (id) => site?.countries.find((c) => c.id === id);

function showCountry(id) {
  const c = findCountry(id);
  if (c) openCountryReport(c);
}

function render(data) {
  site = data;
  renderFollow(data.settings);
  renderCards(data.countries, data.moreCountries);
  renderProject(data.featuredProject);
  renderQuote(data.settings);
  renderFooter(data.settings);
  applyDonationState(Boolean(data.settings?.donationsEnabled));
  map.update(data.countries);
}

/* Ein zentraler Klick-Handler für alle dynamischen Elemente (Karten, Karte, Drawer, Suche).
   So hängen nach jedem Neu-Rendern keine doppelten Listener an den Buttons. */
function onDocumentClick(e) {
  const donate = e.target.closest("[data-donate]");
  if (donate) {
    if (donate.getAttribute("aria-disabled") === "true") {
      e.preventDefault();
      toast("Spenden sind bald möglich. Danke für deine Geduld!");
    }
    return;
  }
  const report = e.target.closest("[data-open-report]");
  if (report) { showCountry(report.dataset.openReport); return; }

  if (e.target.closest("[data-open-countries]")) {
    if (site) openCountryList(site.countries);
    return;
  }
  if (e.target.closest("[data-open-project]")) {
    if (site?.featuredProject) openProject(site.featuredProject);
  }
}

initLoader();
hydrateIcons();
initDrawer();
initScrollSpy();

const map = createMap(document.getElementById("hb-map"), { onSelect: showCountry });

initSearch(() => site, {
  onCountry: showCountry,
  onProject: () => site?.featuredProject && openProject(site.featuredProject)
});

document.addEventListener("click", onDocumentClick);
subscribeSiteData(render);
