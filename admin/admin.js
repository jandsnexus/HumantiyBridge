/*
 * Admin-Dashboard: ein gemeinsamer Team-Account, alle Inhalte in einem Dokument ("site/home").
 * Ablauf: Anmelden → Inhalte bearbeiten (lokal) → "Veröffentlichen" → Startseite aktualisiert sich live.
 */
import { ADMIN_UID, SITE_DOC } from "../js/config.js";
import { loadAuth, loadFirestore } from "../js/firebase.js";
import { SAMPLE_DATA, STAT_ICONS, PROJECT_TAGS, flagUrlFor } from "../js/sample-data.js";
import { createMap } from "../js/map.js";
import { icon } from "../js/icons.js";
import { esc, imgTag, hydrateIcons, toast, safeColor } from "../js/util.js";
import { matchCountry, byKey, countryNames } from "./country-match.js";
import { processAndUpload } from "./upload.js";

const $ = (sel, root = document) => root.querySelector(sel);
const MAX_DOC_CHARS = 900_000; // Firestore-Limit liegt bei 1 MB pro Dokument
const MAP_COLORS = ["#ff3b4e", "#ff4d6d", "#ff8a1f", "#f5c518", "#9b6bff", "#2f9bff"];
const COLOR_NAMES = ["Rot", "Pink", "Orange", "Gelb", "Lila", "Blau"];
const TONES = { red: "Rot", orange: "Orange", blue: "Blau", grey: "Grau" };
const URL_OK = /^https?:\/\/\S+\.\S+/i;
const MAX_SOURCES = 10;
const TEAM_DOC = ["admin", "team"];   // nur für den Admin-Account lesbar, nie auf der Website
const IMPRESSUM_TEAM = ["Samreen Singh", "Hassan Rashid", "Gülseher Aydin", "Nezha Khechab", "Tuana Eda Uğur", "Yunus Emre Karaus"];

const EMPTY = () => ({
  settings: { donationsEnabled: false, socials: { tiktok: { url: "", handle: "" }, instagram: { url: "", handle: "" } }, quoteBackgroundUrl: "" },
  countries: [],
  moreCountries: { text: "", coverUrl: "" },
  projects: []
});

const state = { data: EMPTY(), rev: 0, dirty: false, busy: false, uploads: 0 };

/* ---------- Ladescreen: zeigt den echten Fortschritt (Verbindung → Anmeldung → Inhalte) ---------- */
const loader = (() => {
  const el = document.getElementById("ad-loader");
  const st = document.getElementById("ad-loader-status");
  const MIN_MS = 900;      // kein Flackern
  const MAX_MS = 10000;    // blockiert nie länger
  let shownAt = performance.now();
  let gen = 0;
  let maxTimer = 0;
  el.style.animation = "none"; // CSS-Notausgang abschalten, JS übernimmt (sonst käme er nach Login nicht wieder)

  function status(text) {
    if (st.textContent === text) return;
    st.textContent = text;
    st.style.animation = "none";
    void st.offsetWidth; // Einblend-Animation neu starten
    st.style.animation = "";
  }
  function done() {
    const g = ++gen;
    clearTimeout(maxTimer);
    const wait = Math.max(0, MIN_MS - (performance.now() - shownAt));
    setTimeout(() => {
      if (g !== gen) return; // inzwischen wieder geöffnet
      el.classList.add("is-done");
      el.setAttribute("aria-hidden", "true");
    }, wait);
  }
  function show(text) {
    gen++;
    if (el.classList.contains("is-done")) {
      el.classList.remove("is-done");
      el.removeAttribute("aria-hidden");
      shownAt = performance.now();
    }
    status(text);
    clearTimeout(maxTimer);
    maxTimer = setTimeout(done, MAX_MS);
  }
  maxTimer = setTimeout(done, MAX_MS);
  return { status, show, done };
})();

/* ---------- Eigenes Bestätigungsfenster: gleich auf allen Geräten, sicherer Knopf vorausgewählt ---------- */
const confirmDlg = document.getElementById("ad-confirm");
let confirmResolve = null;

function finishConfirm(value) {
  const resolve = confirmResolve;
  confirmResolve = null;
  if (confirmDlg.open) confirmDlg.close();
  if (resolve) resolve(value);
}

/** @returns {Promise<boolean>} true = bestätigt */
function askConfirm({ title, text, yes = "OK", no = "Abbrechen", danger = false, symbol = "triangle-alert" }) {
  if (confirmResolve) finishConfirm(false);
  document.getElementById("ad-confirm-title").textContent = title;
  document.getElementById("ad-confirm-text").textContent = text;
  document.getElementById("ad-confirm-yes").textContent = yes;
  document.getElementById("ad-confirm-no").textContent = no;
  document.getElementById("ad-confirm-icon").innerHTML = icon(symbol);
  confirmDlg.classList.toggle("is-danger", danger);
  confirmDlg.showModal();
  document.getElementById("ad-confirm-no").focus(); // sicherer Knopf zuerst
  return new Promise((resolve) => { confirmResolve = resolve; });
}

document.getElementById("ad-confirm-yes").addEventListener("click", () => finishConfirm(true));
document.getElementById("ad-confirm-no").addEventListener("click", () => finishConfirm(false));
confirmDlg.addEventListener("cancel", (e) => { e.preventDefault(); finishConfirm(false); });
confirmDlg.addEventListener("click", (e) => { if (e.target === confirmDlg) finishConfirm(false); });
let map = null;

/* =========================================================
   Hilfsfunktionen
   ========================================================= */
const clone = (o) => JSON.parse(JSON.stringify(o));
const today = () => new Date().toISOString().slice(0, 10);

function slugify(name, taken) {
  const base = String(name).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "eintrag";
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}

/** Nur erlaubte Felder übernehmen: schützt vor kaputten oder alten Datenständen. */
function sanitize(raw) {
  const d = EMPTY();
  const r = raw && typeof raw === "object" ? raw : {};
  const s = (v, max = 5000) => (typeof v === "string" ? v.slice(0, max) : "");
  const st = r.settings ?? {};
  d.settings.donationsEnabled = st.donationsEnabled === true;
  for (const k of ["tiktok", "instagram"]) {
    d.settings.socials[k] = { url: s(st.socials?.[k]?.url, 300), handle: s(st.socials?.[k]?.handle, 40) };
  }
  d.settings.quoteBackgroundUrl = s(st.quoteBackgroundUrl, 500);
  d.moreCountries = { text: s(r.moreCountries?.text, 120), coverUrl: s(r.moreCountries?.coverUrl, 500) };
  d.countries = (Array.isArray(r.countries) ? r.countries : []).filter((c) => c && c.id && c.name).map((c) => ({
    id: s(c.id, 80), name: s(c.name, 60), isoNumeric: s(c.isoNumeric, 40), flagCode: s(c.flagCode, 4),
    flagUrl: s(c.flagUrl, 500), flagCustom: c.flagCustom === true, mapColor: safeColor(c.mapColor, MAP_COLORS[0]),
    coverUrl: s(c.coverUrl, 500), visible: c.visible !== false,
    badge: { text: s(c.badge?.text, 40), tone: TONES[c.badge?.tone] ? c.badge.tone : "red" },
    stats: [0, 1].map((i) => ({ icon: STAT_ICONS[c.stats?.[i]?.icon] ? c.stats[i].icon : "users", value: s(c.stats?.[i]?.value, 30), label: s(c.stats?.[i]?.label, 60) })),
    report: {
      updatedAt: s(c.report?.updatedAt, 10),
      text: s(c.report?.text, 20000),
      sources: (Array.isArray(c.report?.sources) ? c.report.sources : [])
        .map((q) => ({ title: s(q?.title, 120), url: s(q?.url, 500).trim() }))
        .filter((q) => URL_OK.test(q.url))
        .slice(0, MAX_SOURCES)
    }
  }));
  d.projects = (Array.isArray(r.projects) ? r.projects : []).filter((p) => p && p.id && p.name).map((p) => ({
    id: s(p.id, 80), name: s(p.name, 80), thumbnailUrl: s(p.thumbnailUrl, 500),
    badges: [s(p.badges?.[0], 30), s(p.badges?.[1], 30)],
    description: s(p.description, 400), tags: (Array.isArray(p.tags) ? p.tags : []).filter((t) => PROJECT_TAGS[t]),
    text: s(p.text, 20000), featured: p.featured === true
  }));
  if (d.projects.length && !d.projects.some((p) => p.featured)) d.projects[0].featured = true;
  return d;
}

function setDirty(on = true) {
  state.dirty = on;
  const btn = $("#ad-publish-btn");
  const status = $("#ad-status");
  $("#ad-publish").classList.toggle("is-dirty", on);
  btn.disabled = !on || state.busy || state.uploads > 0;
  status.textContent = state.uploads > 0 ? "Bild wird hochgeladen …"
    : on ? "Nicht veröffentlichte Änderungen" : "Alles veröffentlicht";
}

function errorText(err) {
  const code = err?.code ?? "";
  if (code.includes("permission-denied")) return "Keine Berechtigung. Sind die Firestore-Regeln eingefügt und ist der richtige Account angemeldet?";
  if (code.includes("unavailable") || code.includes("network")) return "Keine Verbindung. Bitte Internet prüfen und erneut versuchen.";
  return err?.message || "Unbekannter Fehler.";
}

/* =========================================================
   Anmeldung
   ========================================================= */
function initAuth() {
  const form = $("#ad-login-form");
  const errEl = $("#ad-login-error");

  // Sofort anhängen: sonst könnte der Browser das Formular (mit Passwort in der URL) normal absenden
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.hidden = true;
    let a, auth;
    try { ({ a, auth } = await loadAuth()); } catch (err) {
      errEl.textContent = "Firebase konnte nicht geladen werden. Internet prüfen und Seite neu laden.";
      errEl.hidden = false;
      return;
    }
    const email = form.email.value.trim();
    const password = form.password.value;
    if (!email || !password) { errEl.textContent = "Bitte E-Mail und Passwort eingeben."; errEl.hidden = false; return; }
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      // Nur für diesen Browser-Tab angemeldet bleiben (gemeinsam genutzte Geräte)
      await a.setPersistence(auth, a.browserSessionPersistence);
      await a.signInWithEmailAndPassword(auth, email, password);
      form.password.value = "";
    } catch (err) {
      const c = err?.code ?? "";
      errEl.textContent = /invalid-credential|wrong-password|user-not-found|invalid-email/.test(c) ? "E-Mail oder Passwort ist falsch."
        : c.includes("too-many-requests") ? "Zu viele Versuche. Bitte ein paar Minuten warten."
        : c.includes("network") ? "Keine Verbindung. Bitte Internet prüfen."
        : `Anmeldung fehlgeschlagen (${c || "unbekannt"}).`;
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  $("#ad-logout").addEventListener("click", async () => {
    if (state.dirty && !(await askConfirm({ title: "Trotzdem abmelden?", text: "Es gibt Änderungen, die noch nicht veröffentlicht sind. Beim Abmelden gehen sie verloren.", yes: "Abmelden", no: "Zurück", danger: true }))) return;
    setDirty(false);
    const { a, auth } = await loadAuth();
    await a.signOut(auth);
  });

  return loadAuth().then(({ a, auth }) => {
    loader.status("Anmeldung wird geprüft …");
    return a.onAuthStateChanged(auth, async (user) => {
    if (user && user.uid !== ADMIN_UID) {
      await a.signOut(auth);
      errEl.textContent = "Dieser Account hat keinen Admin-Zugang.";
      errEl.hidden = false;
      return;
    }
    if (user) loader.show("Inhalte werden geladen …");
    $("#ad-login").hidden = !!user;
    $("#ad-app").hidden = !user;
    if (user) await Promise.all([loadData(), loadTeam()]);
    loader.done();
    });
  });
}

/* =========================================================
   Laden & Veröffentlichen
   ========================================================= */
async function loadData() {
  const banner = $("#ad-banner");
  banner.hidden = true;
  try {
    const { f, db } = await loadFirestore();
    const snap = await f.getDoc(f.doc(db, ...SITE_DOC));
    if (snap.exists()) {
      const raw = snap.data();
      state.data = sanitize(raw);
      state.rev = Number(raw.rev) || 0;
    } else {
      state.data = EMPTY();
      state.rev = 0;
      banner.innerHTML = `<span>Es wurde noch nichts veröffentlicht. Die Startseite zeigt gerade Beispieldaten.</span>
        <button class="hb-btn hb-btn--dark hb-btn--sm" type="button" id="ad-load-sample">Mit Beispieldaten starten</button>`;
      banner.hidden = false;
      $("#ad-load-sample").addEventListener("click", () => {
        state.data = sanitize(clone(SAMPLE_DATA));
        banner.hidden = true;
        renderAll();
        setDirty(true);
        toast("Beispieldaten geladen. Jetzt anpassen und veröffentlichen.");
      });
    }
    renderAll();
    setDirty(false);
  } catch (err) {
    console.error(err);
    banner.innerHTML = `<span>${esc(errorText(err))}</span><button class="hb-btn hb-btn--dark hb-btn--sm" type="button" id="ad-retry">Erneut laden</button>`;
    banner.hidden = false;
    $("#ad-retry").addEventListener("click", loadData);
  }
}

async function publish() {
  if (!state.dirty || state.busy || state.uploads > 0) return;
  const json = JSON.stringify(state.data);
  if (json.length > MAX_DOC_CHARS) {
    alert("Die Inhalte sind zu groß zum Speichern (Limit ca. 1 MB). Bitte lange Berichte kürzen.");
    return;
  }
  state.busy = true;
  setDirty(true);
  $("#ad-status").textContent = "Wird veröffentlicht …";
  try {
    const { f, db } = await loadFirestore();
    const ref = f.doc(db, ...SITE_DOC);
    // Hat jemand anderes inzwischen veröffentlicht?
    const current = await f.getDoc(ref);
    const remoteRev = current.exists() ? Number(current.data().rev) || 0 : 0;
    if (remoteRev !== state.rev && !confirm("Jemand hat in der Zwischenzeit veröffentlicht. Mit deinem Stand überschreiben?")) {
      state.busy = false;
      setDirty(true);
      return;
    }
    const rev = Math.max(remoteRev, state.rev) + 1;
    await f.setDoc(ref, { ...clone(state.data), rev, updatedAt: f.serverTimestamp() });
    state.rev = rev;
    state.busy = false;
    setDirty(false);
    toast("Veröffentlicht. Die Startseite ist aktualisiert.");
  } catch (err) {
    console.error(err);
    state.busy = false;
    setDirty(true);
    alert(`Veröffentlichen fehlgeschlagen: ${errorText(err)}`);
  }
}

/* =========================================================
   Bildfeld (wiederverwendbar)
   ========================================================= */
function imageField(container, { label, value, maxSize = 1600, ratio = "wide", onChange, extra = "" }) {
  let current = value || "";
  const render = (progress = null) => {
    container.innerHTML = `
      <span class="ad-image__label">${esc(label)}</span>
      <div class="ad-image__row">
        <div class="ad-image__preview ad-image__preview--${ratio}">
          ${imgTag(current, 'alt=""', ratio === "square" ? 160 : 480) || `<span class="ad-image__empty">${icon("image")}</span>`}
          ${progress !== null ? `<span class="ad-image__progress"><span style="width:${Math.round(progress * 100)}%"></span></span>` : ""}
        </div>
        <div class="ad-image__actions">
          <button type="button" class="hb-btn ad-btn-ghost hb-btn--sm" data-pick-file ${progress !== null ? "disabled" : ""}>
            ${icon("upload")}<span>${progress !== null ? "Lädt hoch …" : current ? "Ersetzen" : "Bild wählen"}</span>
          </button>
          <input type="file" accept="image/*" hidden>
          ${current && progress === null ? `<button type="button" class="hb-btn ad-btn-ghost hb-btn--sm" data-remove>${icon("trash-2")}<span>Entfernen</span></button>` : ""}
          ${extra}
        </div>
      </div>`;
  };
  render();

  container.addEventListener("change", async (e) => {
    const input = e.target.closest("input[type=file]");
    if (!input || !input.files?.[0]) return;
    const file = input.files[0];
    state.uploads++;
    setDirty(state.dirty);
    render(0);
    try {
      current = await processAndUpload(file, maxSize, (p) => render(p));
      onChange(current);
      toast("Bild hochgeladen.");
    } catch (err) {
      console.error(err);
      alert(err.message || "Upload fehlgeschlagen.");
    } finally {
      state.uploads--;
      render();
      setDirty(state.dirty);
    }
  });
  container.addEventListener("click", (e) => {
    if (e.target.closest("[data-pick-file]")) {
      container.querySelector("input[type=file]").click();
      return;
    }
    if (e.target.closest("[data-remove]")) {
      current = "";
      onChange("");
      render();
    }
  });
  return { set(v) { current = v || ""; render(); } };
}

/* =========================================================
   Länder
   ========================================================= */
function renderCountries() {
  const list = $("#ad-country-list");
  const cs = state.data.countries;
  if (!cs.length) {
    list.innerHTML = `<li class="ad-empty">Noch keine Länder. Mit „Land hinzufügen“ das erste anlegen.</li>`;
  } else {
    let visibleIndex = 0;
    list.innerHTML = cs.map((c, i) => {
      const onMap = c.isoNumeric && byKey.has(c.isoNumeric);
      // Die ersten 3 sichtbaren Länder sind Karten auf der Startseite, alle weiteren unter „Weitere Länder“
      const place = !c.visible ? "" : (visibleIndex++ < 3 ? "Karte auf der Startseite" : "Unter „Weitere Länder“");
      return `
      <li class="ad-row ${c.visible ? "" : "is-hidden"}" data-id="${esc(c.id)}">
        <span class="ad-row__thumb">${imgTag(c.flagUrl, 'class="hb-flag" alt="" width="40" height="40"', 96) || `<span class="hb-flag hb-flag--icon">${icon("globe")}</span>`}</span>
        <span class="ad-row__main">
          <strong>${esc(c.name)}</strong>
          <span class="ad-row__meta">
            ${c.badge.text ? `<span class="hb-badge hb-badge--${c.badge.tone}">${esc(c.badge.text)}</span>` : ""}
            <span class="${onMap ? "ad-ok" : "ad-warn"}">${icon(onMap ? "map-pin" : "triangle-alert")}${onMap ? "Auf der Karte" : "Nicht auf der Karte"}</span>
            ${c.visible ? `<span class="ad-place ${place.startsWith("Karte") ? "is-card" : ""}">${place}</span>` : `<span class="ad-muted">Ausgeblendet</span>`}
          </span>
        </span>
        <span class="ad-row__actions">
          <button class="hb-iconbtn" type="button" data-act="visible" aria-label="${c.visible ? "Ausblenden" : "Einblenden"}" title="${c.visible ? "Ausblenden" : "Einblenden"}">${icon(c.visible ? "eye" : "eye-off")}</button>
          <button class="hb-iconbtn" type="button" data-act="up" aria-label="Nach oben" ${i === 0 ? "disabled" : ""}>${icon("chevron-up")}</button>
          <button class="hb-iconbtn" type="button" data-act="down" aria-label="Nach unten" ${i === cs.length - 1 ? "disabled" : ""}>${icon("chevron-down")}</button>
          <button class="hb-iconbtn" type="button" data-act="edit" aria-label="Bearbeiten">${icon("pencil")}</button>
          <button class="hb-iconbtn ad-danger" type="button" data-act="delete" aria-label="Löschen">${icon("trash-2")}</button>
        </span>
      </li>`;
    }).join("");
  }
  map?.update(cs.filter((c) => c.visible));
}

function moveItem(arr, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

function onListClick(listSel, key, renderFn, openFn) {
  $(listSel).addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const id = b.closest("[data-id]").dataset.id;
    const arr = state.data[key];
    const i = arr.findIndex((x) => x.id === id);
    if (i < 0) return;
    const act = b.dataset.act;
    if (act === "edit") return openFn(arr[i]);
    if (act === "delete") {
      const what = key === "projects" ? "Projekt" : "Land";
      const ok = await askConfirm({
        title: `${what} „${arr[i].name}“ löschen?`,
        text: `Der komplette Eintrag inklusive ${key === "projects" ? "Projekttext" : "Bericht und Quellen"} wird entfernt. Auf der Website verschwindet er nach dem Veröffentlichen.`,
        yes: "Löschen", no: "Behalten", danger: true, symbol: "trash-2"
      });
      const j = arr.findIndex((x) => x.id === id); // Liste kann sich inzwischen geändert haben
      if (!ok || j < 0) return;
      const wasFeatured = arr[j].featured;
      arr.splice(j, 1);
      if (wasFeatured && arr[0]) arr[0].featured = true;
    }
    if (act === "up") moveItem(arr, i, -1);
    if (act === "down") moveItem(arr, i, 1);
    if (act === "visible") arr[i].visible = !arr[i].visible;
    if (act === "feature") arr.forEach((x, k) => { x.featured = k === i; });
    renderFn();
    setDirty(true);
  });
}

/* ---------- Dialog ---------- */
const dialog = $("#ad-dialog");
let dialogSubmit = null;
let dialogCtl = new AbortController();
let dialogDirty = false;
const markDialogDirty = () => { if (dialog.open) dialogDirty = true; };

/** Listener, die nur für die aktuelle Dialog-Öffnung gelten, bekommen dieses Signal. */
const dialogSignal = () => dialogCtl.signal;

function openDialog(title, bodyHtml, onSubmit) {
  dialogCtl.abort();
  dialogCtl = new AbortController();
  dialogDirty = false;
  $("#ad-dialog-title").textContent = title;
  $("#ad-dialog-body").innerHTML = bodyHtml;
  dialogSubmit = onSubmit;
  dialog.showModal();
  $("#ad-dialog-body").scrollTop = 0;
}

/** Schließen mit Sicherheitsabfrage, wenn etwas geändert wurde (Abbrechen, X, Escape, Klick daneben). */
async function closeDialog() {
  if (!dialog.open) return;
  if (state.uploads > 0) {
    const ok = await askConfirm({ title: "Bild wird noch hochgeladen", text: "Wenn du jetzt schließt, wird das Bild nicht übernommen.", yes: "Trotzdem schließen", no: "Warten", symbol: "upload" });
    if (!ok) return;
  } else if (dialogDirty) {
    const ok = await askConfirm({
      title: "Änderungen verwerfen?",
      text: "Du hast in diesem Fenster etwas geändert. Wenn du jetzt schließt, gehen diese Eingaben verloren.",
      yes: "Verwerfen", no: "Weiter bearbeiten", danger: true
    });
    if (!ok) return;
  }
  dialogDirty = false;
  dialog.close();
}

$("#ad-dialog-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (state.uploads > 0) { toast("Bitte warten, bis das Bild hochgeladen ist."); return; }
  if (dialogSubmit && dialogSubmit() !== false) { dialogDirty = false; dialog.close(); }
});
// Jede Eingabe im Editor zählt als Änderung
$("#ad-dialog-form").addEventListener("input", markDialogDirty);
$("#ad-dialog-form").addEventListener("change", markDialogDirty);
dialog.addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) closeDialog();
  else if (e.target === dialog) closeDialog(); // Klick auf den abgedunkelten Rand
});
dialog.addEventListener("close", () => dialogCtl.abort());
// Escape schon beim Drücken abfangen: Chrome würde sonst bei zweimal Escape trotz Abfrage schließen
dialog.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { e.preventDefault(); closeDialog(); }
});
dialog.addEventListener("cancel", (e) => { e.preventDefault(); closeDialog(); });

/* ---------- Land bearbeiten ---------- */
function statFields(st, i) {
  return `
    <div class="ad-stat">
      <span class="ad-stat__label">Statistik ${i + 1}</span>
      <label class="ad-field"><span>Symbol</span>
        <select name="stat${i}Icon">${Object.entries(STAT_ICONS).map(([k, v]) => `<option value="${k}" ${st.icon === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>
      </label>
      <label class="ad-field"><span>Wert</span><input name="stat${i}Value" value="${esc(st.value)}" placeholder="z. B. 48 Mio." maxlength="30"></label>
      <label class="ad-field ad-field--wide"><span>Beschreibung</span><input name="stat${i}Label" value="${esc(st.label)}" placeholder="z. B. Betroffene" maxlength="60"></label>
    </div>`;
}

function openCountryEditor(existing) {
  const isNew = !existing;
  const c = existing ? clone(existing) : {
    id: "", name: "", isoNumeric: "", flagCode: "", flagUrl: "", flagCustom: false, mapColor: MAP_COLORS[0],
    coverUrl: "", visible: true, badge: { text: "", tone: "red" },
    stats: [{ icon: "users", value: "", label: "" }, { icon: "chart-pie", value: "", label: "" }],
    report: { updatedAt: today(), text: "", sources: [] }
  };
  if (!Array.isArray(c.report.sources)) c.report.sources = [];

  openDialog(isNew ? "Land hinzufügen" : `${c.name} bearbeiten`, `
    <label class="ad-field">
      <span>Land</span>
      <input name="cname" value="${esc(c.name)}" list="ad-country-names" autocomplete="off" placeholder="z. B. Sudan" maxlength="60" required>
    </label>
    <div class="ad-match" id="ad-match" aria-live="polite"></div>

    <div class="ad-field">
      <span>Farbe auf der Karte</span>
      <div class="ad-swatches">
        ${MAP_COLORS.map((col, i) => `<label class="ad-swatch" style="--c:${col}" title="${COLOR_NAMES[i]}"><input type="radio" name="mapColor" value="${col}" aria-label="Kartenfarbe ${COLOR_NAMES[i]}" ${c.mapColor === col ? "checked" : ""}><span></span></label>`).join("")}
        <label class="ad-swatch ad-swatch--custom" title="Eigene Farbe"><input type="color" name="mapColorCustom" aria-label="Eigene Kartenfarbe wählen" value="${safeColor(c.mapColor)}"></label>
      </div>
    </div>

    <div class="ad-image" id="ad-img-flag"></div>
    <div class="ad-image" id="ad-img-cover"></div>

    <div class="ad-grid2">
      <label class="ad-field"><span>Badge-Text</span><input name="badgeText" value="${esc(c.badge.text)}" placeholder="z. B. Akute Kriegslage" maxlength="40"></label>
      <label class="ad-field"><span>Badge-Farbe</span>
        <select name="badgeTone">${Object.entries(TONES).map(([k, v]) => `<option value="${k}" ${c.badge.tone === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      </label>
    </div>

    ${statFields(c.stats[0], 0)}
    ${statFields(c.stats[1], 1)}

    <label class="ad-field"><span>Bericht – Stand</span><input type="date" name="reportDate" value="${esc(c.report.updatedAt || today())}"></label>
    <label class="ad-field"><span>Bericht (Absätze mit Leerzeile trennen)</span><textarea name="reportText" rows="8" maxlength="20000">${esc(c.report.text)}</textarea></label>

    <div class="ad-field">
      <span>Quellen (optional, max. ${MAX_SOURCES})</span>
      <div class="ad-sources" id="ad-sources"></div>
      <button type="button" class="hb-btn ad-btn-ghost hb-btn--sm ad-sources__add" id="ad-add-source">${icon("plus")}<span>Quelle hinzufügen</span></button>
    </div>

    <label class="ad-switch"><input type="checkbox" name="visible" ${c.visible ? "checked" : ""}><span>Auf der Startseite zeigen</span></label>
  `, () => {
    const form = $("#ad-dialog-form");
    const name = form.cname.value.trim();
    if (!name) { toast("Bitte einen Ländernamen eingeben."); form.cname.focus(); return false; }
    if (!c.isoNumeric && !confirm(`„${name}“ wurde keiner Kartenfläche zugeordnet und leuchtet nicht auf der Karte. Trotzdem übernehmen?`)) return false;
    const dup = state.data.countries.find((x) => x.id !== c.id && c.isoNumeric && x.isoNumeric === c.isoNumeric);
    if (dup && !confirm(`„${dup.name}“ ist bereits auf diese Kartenfläche gesetzt. Trotzdem übernehmen?`)) return false;

    c.name = name;
    c.badge = { text: form.badgeText.value.trim(), tone: form.badgeTone.value };
    c.stats = [0, 1].map((i) => ({ icon: form[`stat${i}Icon`].value, value: form[`stat${i}Value`].value.trim(), label: form[`stat${i}Label`].value.trim() }));
    const sources = [];
    for (const row of form.querySelectorAll(".ad-source")) {
      const title = row.querySelector("[data-src-title]").value.trim();
      const urlEl = row.querySelector("[data-src-url]");
      const url = urlEl.value.trim();
      if (!title && !url) continue;
      if (!URL_OK.test(url)) {
        urlEl.classList.add("is-invalid");
        urlEl.focus();
        toast("Bitte einen vollständigen Link mit https:// eintragen.");
        return false;
      }
      sources.push({ title, url });
    }
    c.report = { updatedAt: form.reportDate.value || today(), text: form.reportText.value.trim(), sources };
    c.visible = form.visible.checked;
    if (isNew) {
      c.id = slugify(name, new Set(state.data.countries.map((x) => x.id)));
      state.data.countries.push(c);
    } else {
      const i = state.data.countries.findIndex((x) => x.id === c.id);
      state.data.countries[i] = c;
    }
    renderCountries();
    setDirty(true);
    return true;
  });

  const form = $("#ad-dialog-form");
  const matchEl = $("#ad-match");
  const sourcesEl = $("#ad-sources");
  const addSourceBtn = $("#ad-add-source");

  function addSourceRow(q = { title: "", url: "" }) {
    sourcesEl.insertAdjacentHTML("beforeend", `
      <div class="ad-source">
        <input type="text" data-src-title value="${esc(q.title)}" placeholder="Titel, z. B. UNHCR-Bericht Mai 2026" maxlength="120" aria-label="Titel der Quelle">
        <input type="url" data-src-url value="${esc(q.url)}" placeholder="https://…" inputmode="url" aria-label="Link zur Quelle">
        <button type="button" class="hb-iconbtn ad-danger" data-src-remove aria-label="Quelle entfernen">${icon("trash-2")}</button>
      </div>`);
    addSourceBtn.hidden = sourcesEl.children.length >= MAX_SOURCES;
  }
  c.report.sources.forEach(addSourceRow);
  addSourceBtn.addEventListener("click", () => {
    markDialogDirty();
    addSourceRow();
    sourcesEl.lastElementChild.querySelector("input").focus();
  });
  sourcesEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-src-remove]");
    if (!b) return;
    b.closest(".ad-source").remove();
    markDialogDirty();
    addSourceBtn.hidden = sourcesEl.children.length >= MAX_SOURCES;
  });
  sourcesEl.addEventListener("input", (e) => e.target.classList.remove("is-invalid"));

  const flagField = imageField($("#ad-img-flag"), {
    label: "Flagge (wird automatisch gesetzt, eigene optional)", value: c.flagUrl, maxSize: 256, ratio: "square",
    onChange: (url) => {
      markDialogDirty();
      c.flagCustom = !!url;
      c.flagUrl = url || flagUrlFor(c.flagCode);
      flagField.set(c.flagUrl);
    }
  });
  imageField($("#ad-img-cover"), { label: "Titelbild der Karte", value: c.coverUrl, maxSize: 1600, onChange: (url) => { markDialogDirty(); c.coverUrl = url; } });

  function applyCountry(entry) {
    c.isoNumeric = entry.k;
    c.flagCode = entry.a;
    if (!c.flagCustom) {
      c.flagUrl = flagUrlFor(entry.a);
      flagField.set(c.flagUrl);
    }
    matchEl.className = "ad-match is-ok";
    matchEl.innerHTML = `${icon("check")}<span>Gefunden: <strong>${esc(entry.n)}</strong> – wird auf der Karte markiert.</span>`;
  }

  function checkName() {
    const val = form.cname.value;
    const r = matchCountry(val);
    if (r.exact) { applyCountry(r.exact); return; }
    c.isoNumeric = "";
    c.flagCode = "";
    if (!c.flagCustom) { c.flagUrl = ""; flagField.set(""); }
    const opts = r.choices.length ? r.choices : r.suggestions;
    if (!val.trim()) { matchEl.className = "ad-match"; matchEl.innerHTML = ""; return; }
    matchEl.className = "ad-match is-warn";
    matchEl.innerHTML = `${icon("triangle-alert")}<span>${r.choices.length ? "Welches Land ist gemeint?" : opts.length ? "Nicht eindeutig. Meintest du:" : "Kein Land auf der Karte gefunden."}</span>
      ${opts.length ? `<span class="ad-match__opts">${opts.map((o) => `<button type="button" class="hb-pill" data-pick="${esc(o.k)}">${esc(o.n)}</button>`).join("")}</span>` : ""}`;
  }

  matchEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pick]");
    if (!b) return;
    const entry = byKey.get(b.dataset.pick);
    if (!entry) return;
    form.cname.value = entry.n;
    markDialogDirty();
    applyCountry(entry);
  });
  form.cname.addEventListener("input", checkName);

  form.addEventListener("change", (e) => {
    if (e.target.name === "mapColor") c.mapColor = e.target.value;
    if (e.target.name === "mapColorCustom") {
      c.mapColor = safeColor(e.target.value);
      form.querySelectorAll('input[name="mapColor"]').forEach((r) => { r.checked = false; });
    }
  }, { signal: dialogSignal() });

  // Bestehendes Land: Zuordnung anzeigen, ohne die gespeicherte Auswahl zu überschreiben
  if (!isNew && c.isoNumeric && byKey.has(c.isoNumeric)) {
    const entry = byKey.get(c.isoNumeric);
    matchEl.className = "ad-match is-ok";
    matchEl.innerHTML = `${icon("check")}<span>Auf der Karte: <strong>${esc(entry.n)}</strong></span>`;
  } else if (!isNew) {
    checkName();
  }
  form.cname.focus();
}

/* =========================================================
   Projekte
   ========================================================= */
function renderProjects() {
  const list = $("#ad-project-list");
  const ps = state.data.projects;
  list.innerHTML = ps.length ? ps.map((p, i) => `
    <li class="ad-row" data-id="${esc(p.id)}">
      <span class="ad-row__thumb ad-row__thumb--wide">${imgTag(p.thumbnailUrl, 'alt=""', 160) || `<span class="ad-image__empty">${icon("image")}</span>`}</span>
      <span class="ad-row__main">
        <strong>${esc(p.name)}</strong>
        <span class="ad-row__meta">${p.featured ? `<span class="ad-ok">${icon("check")}Auf der Startseite</span>` : ""}<span class="ad-muted">${esc(p.tags.join(", "))}</span></span>
      </span>
      <span class="ad-row__actions">
        <button class="hb-iconbtn ${p.featured ? "is-on" : ""}" type="button" data-act="feature" aria-label="Auf der Startseite zeigen" aria-pressed="${p.featured}" title="Auf der Startseite zeigen">${icon("map-pin")}</button>
        <button class="hb-iconbtn" type="button" data-act="up" aria-label="Nach oben" ${i === 0 ? "disabled" : ""}>${icon("chevron-up")}</button>
        <button class="hb-iconbtn" type="button" data-act="down" aria-label="Nach unten" ${i === ps.length - 1 ? "disabled" : ""}>${icon("chevron-down")}</button>
        <button class="hb-iconbtn" type="button" data-act="edit" aria-label="Bearbeiten">${icon("pencil")}</button>
        <button class="hb-iconbtn ad-danger" type="button" data-act="delete" aria-label="Löschen">${icon("trash-2")}</button>
      </span>
    </li>`).join("")
    : `<li class="ad-empty">Noch keine Projekte. Mit „Projekt hinzufügen“ das erste anlegen.</li>`;
}

function openProjectEditor(existing) {
  const isNew = !existing;
  const p = existing ? clone(existing) : {
    id: "", name: "", thumbnailUrl: "", badges: ["", ""], description: "", tags: [], text: "",
    featured: state.data.projects.length === 0
  };
  openDialog(isNew ? "Projekt hinzufügen" : `${p.name} bearbeiten`, `
    <label class="ad-field"><span>Projektname</span><input name="pname" value="${esc(p.name)}" maxlength="80" required></label>
    <div class="ad-image" id="ad-img-thumb"></div>
    <div class="ad-grid2">
      <label class="ad-field"><span>Badge links</span><input name="badge0" value="${esc(p.badges[0])}" placeholder="z. B. Projekt-Beispiel" maxlength="30"></label>
      <label class="ad-field"><span>Badge rechts</span><input name="badge1" value="${esc(p.badges[1])}" placeholder="z. B. Food-Camp" maxlength="30"></label>
    </div>
    <label class="ad-field"><span>Kurzbeschreibung (auf der Startseite)</span><textarea name="description" rows="3" maxlength="400">${esc(p.description)}</textarea></label>
    <div class="ad-field"><span>Was wird geleistet?</span>
      <div class="ad-checks">${Object.entries(PROJECT_TAGS).map(([label, ic]) => `
        <label class="ad-check"><input type="checkbox" name="tags" value="${esc(label)}" ${p.tags.includes(label) ? "checked" : ""}>${icon(ic)}<span>${esc(label)}</span></label>`).join("")}
      </div>
    </div>
    <label class="ad-field"><span>Ausführlicher Text (Absätze mit Leerzeile trennen)</span><textarea name="ptext" rows="8" maxlength="20000">${esc(p.text)}</textarea></label>
    <label class="ad-switch"><input type="checkbox" name="featured" ${p.featured ? "checked" : ""}><span>Auf der Startseite zeigen</span></label>
  `, () => {
    const form = $("#ad-dialog-form");
    const name = form.pname.value.trim();
    if (!name) { toast("Bitte einen Projektnamen eingeben."); form.pname.focus(); return false; }
    p.name = name;
    p.badges = [form.badge0.value.trim(), form.badge1.value.trim()];
    p.description = form.description.value.trim();
    p.tags = [...form.querySelectorAll('input[name="tags"]:checked')].map((x) => x.value);
    p.text = form.ptext.value.trim();
    p.featured = form.featured.checked;
    const arr = state.data.projects;
    if (isNew) {
      p.id = slugify(name, new Set(arr.map((x) => x.id)));
      arr.push(p);
    } else {
      arr[arr.findIndex((x) => x.id === p.id)] = p;
    }
    if (p.featured) arr.forEach((x) => { x.featured = x.id === p.id; });
    if (!arr.some((x) => x.featured) && arr[0]) arr[0].featured = true;
    renderProjects();
    setDirty(true);
    return true;
  });
  imageField($("#ad-img-thumb"), { label: "Vorschaubild", value: p.thumbnailUrl, maxSize: 1600, onChange: (url) => { markDialogDirty(); p.thumbnailUrl = url; } });
  $("#ad-dialog-form").pname.focus();
}

/* =========================================================
   Startseiten-Einstellungen
   ========================================================= */
let quoteField = null;
let moreField = null;

function renderSettings() {
  const form = $("#ad-settings-form");
  const s = state.data.settings;
  form.tiktokUrl.value = s.socials.tiktok.url;
  form.tiktokHandle.value = s.socials.tiktok.handle;
  form.instagramUrl.value = s.socials.instagram.url;
  form.instagramHandle.value = s.socials.instagram.handle;
  form.moreText.value = state.data.moreCountries.text;
  form.donationsEnabled.checked = s.donationsEnabled;
  quoteField.set(s.quoteBackgroundUrl);
  moreField.set(state.data.moreCountries.coverUrl);
}

function initSettings() {
  const form = $("#ad-settings-form");
  quoteField = imageField(form.querySelector('[data-image="quote"]'), {
    label: "Hintergrundbild", value: "", maxSize: 2000,
    onChange: (url) => { state.data.settings.quoteBackgroundUrl = url; setDirty(true); }
  });
  moreField = imageField(form.querySelector('[data-image="more"]'), {
    label: "Titelbild", value: "", maxSize: 1600,
    onChange: (url) => { state.data.moreCountries.coverUrl = url; setDirty(true); }
  });
  form.addEventListener("input", (e) => {
    const s = state.data.settings;
    const v = e.target.value;
    switch (e.target.name) {
      case "tiktokUrl": s.socials.tiktok.url = v.trim(); break;
      case "tiktokHandle": s.socials.tiktok.handle = v.trim(); break;
      case "instagramUrl": s.socials.instagram.url = v.trim(); break;
      case "instagramHandle": s.socials.instagram.handle = v.trim(); break;
      case "moreText": state.data.moreCountries.text = v; break;
      case "donationsEnabled":
        if (e.target.checked && !confirm("Spenden-Buttons wirklich aktivieren? Erst machen, wenn die Spendenseite bereit ist.")) { e.target.checked = false; return; }
        s.donationsEnabled = e.target.checked;
        break;
      default: return;
    }
    setDirty(true);
  });
  // Links prüfen, sobald man das Feld verlässt
  form.addEventListener("focusout", (e) => {
    if (e.target.type !== "url") return;
    const v = e.target.value.trim();
    e.target.classList.toggle("is-invalid", !!v && !/^https:\/\/\S+\.\S+/.test(v));
  });
}

/* =========================================================
   Team (nur im Admin sichtbar, eigenes gesperrtes Dokument)
   Mitglied: { name, photoUrl, phone, email, zip, address, bio }
   Karte antippen → Steckbrief (Ansicht). Bearbeiten nur über den Stift.
   ========================================================= */
const team = { members: [], state: "loading", error: "", saving: false };
const MEMBER_LIMITS = { name: 60, phone: 25, email: 120, zip: 10, address: 160, bio: 3000 };
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_OK = /^\+?[0-9 ()\/-]{6,25}$/;
const ZIP_OK = /^\d{4,5}$/;

const str = (v, max) => String(v ?? "").trim().slice(0, max);
const normMember = (m) => (typeof m === "string"
  ? { name: str(m, 60), photoUrl: "", phone: "", email: "", zip: "", address: "", bio: "" }
  : {
    name: str(m?.name, MEMBER_LIMITS.name),
    photoUrl: URL_OK.test(String(m?.photoUrl ?? "")) ? m.photoUrl : "",
    phone: str(m?.phone, MEMBER_LIMITS.phone),
    email: str(m?.email, MEMBER_LIMITS.email),
    zip: str(m?.zip, MEMBER_LIMITS.zip),
    address: str(m?.address, MEMBER_LIMITS.address),
    bio: String(m?.bio ?? "").slice(0, MEMBER_LIMITS.bio)
  });

function teamErrorHtml(err) {
  const code = err?.code ?? "";
  if (code.includes("permission-denied")) {
    return `<strong>Der Team-Bereich hat keine Berechtigung.</strong>
      <span>In Firebase sind noch die alten Regeln aktiv. Firebase → Firestore Database → Regeln → die neuen Regeln (mit „admin/team“) einfügen → Veröffentlichen. Danach diese Seite neu laden.</span>`;
  }
  return `<strong>Team konnte nicht geladen werden.</strong><span>${esc(errorText(err))}</span>`;
}

const avatar = (m, size) => (m.photoUrl
  ? imgTag(m.photoUrl, 'alt=""', size)
  : `<span class="ad-member__initial" aria-hidden="true">${esc((m.name || "?").charAt(0).toUpperCase())}</span>`);

function renderTeam() {
  const list = $("#ad-team-list");
  const ready = team.state === "ready";
  $("#ad-team-form").querySelector("fieldset").disabled = !ready || team.saving;
  const errEl = $("#ad-team-error");
  errEl.hidden = team.state !== "error";
  errEl.innerHTML = team.state === "error" ? team.error : "";
  $("#ad-team-import").hidden = !ready || team.members.length > 0;
  $("#ad-team-count").textContent = ready ? `${team.members.length} ${team.members.length === 1 ? "Mitglied" : "Mitglieder"}` : "";

  if (team.state === "loading") { list.innerHTML = `<li class="ad-empty">Team wird geladen …</li>`; return; }
  if (team.state === "error") { list.innerHTML = ""; return; }
  list.innerHTML = team.members.length ? team.members.map((m, i) => `
    <li class="ad-member" data-index="${i}">
      <button type="button" class="ad-member__open" data-team-open aria-label="Steckbrief von ${esc(m.name)} öffnen">
        <span class="ad-member__photo">${avatar(m, 192)}</span>
        <span class="ad-member__text">
          <strong>${esc(m.name)}</strong>
          <span>${esc(m.email || m.phone || "Steckbrief öffnen")}</span>
        </span>
        ${icon("arrow-right", "ad-member__chev")}
      </button>
      <button class="hb-iconbtn ad-danger ad-member__remove" type="button" data-team-remove aria-label="${esc(m.name)} aus dem Team entfernen">${icon("trash-2")}</button>
    </li>`).join("")
    : `<li class="ad-empty">Noch niemand eingetragen.</li>`;
}

async function saveTeam(next, message) {
  if (team.saving) return false;
  team.saving = true;
  renderTeam();
  try {
    const { f, db } = await loadFirestore();
    await f.setDoc(f.doc(db, ...TEAM_DOC), { members: next, updatedAt: f.serverTimestamp() });
    team.members = next;
    if (message) toast(message);
    return true;
  } catch (err) {
    console.error(err);
    if ((err?.code ?? "").includes("permission-denied")) { team.state = "error"; team.error = teamErrorHtml(err); }
    else alert(`Team konnte nicht gespeichert werden: ${errorText(err)}`);
    return false;
  } finally {
    team.saving = false;
    renderTeam();
  }
}

async function loadTeam() {
  team.state = "loading";
  renderTeam();
  try {
    const { f, db } = await loadFirestore();
    const snap = await f.getDoc(f.doc(db, ...TEAM_DOC));
    const raw = snap.exists() && Array.isArray(snap.data().members) ? snap.data().members : [];
    team.members = raw.map(normMember).filter((m) => m.name);
    team.state = "ready";
  } catch (err) {
    console.error(err);
    team.state = "error";
    team.error = teamErrorHtml(err);
  }
  renderTeam();
}

async function removeMember(i) {
  const m = team.members[i];
  if (!m) return false;
  const ok = await askConfirm({
    title: `${m.name} entfernen?`,
    text: "Die Person und ihr kompletter Steckbrief (Kontaktdaten, Foto, Notizen) werden gelöscht. Das lässt sich nicht rückgängig machen.",
    yes: "Entfernen", no: "Behalten", danger: true, symbol: "trash-2"
  });
  if (!ok) return false;
  const j = team.members.indexOf(m); // Liste kann sich inzwischen geändert haben
  if (j < 0) return false;
  return saveTeam(team.members.filter((_, k) => k !== j), `${m.name} entfernt.`);
}

/* ---------- Steckbrief ---------- */
const profileDlg = document.getElementById("ad-profile");
const profile = { index: -1, mode: "view", draft: null, dirty: false, uploading: false };

function factRow(symbol, label, value, href) {
  const content = value
    ? (href ? `<a href="${esc(href)}">${esc(value)}</a>` : `<span>${esc(value)}</span>`)
    : `<span class="ad-profile__none">nicht eingetragen</span>`;
  return `<div class="ad-profile__fact">${icon(symbol)}<dt>${label}</dt><dd>${content}</dd></div>`;
}

function renderProfileView() {
  const m = team.members[profile.index];
  if (!m) { profileDlg.close(); return; }
  const tel = m.phone ? `tel:${m.phone.replace(/[^\d+]/g, "")}` : "";
  $("#ad-profile-body").innerHTML = `
    <header class="ad-profile__head">
      <span class="ad-profile__photo">${avatar(m, 256)}</span>
      <div class="ad-profile__name">
        <p class="ad-profile__kicker">${icon("file-text")}Steckbrief</p>
        <h2 id="ad-profile-title">${esc(m.name)}</h2>
      </div>
      <div class="ad-profile__tools">
        <button class="hb-iconbtn" type="button" data-prof-edit aria-label="Steckbrief bearbeiten" title="Bearbeiten">${icon("pencil")}</button>
        <button class="hb-iconbtn" type="button" data-prof-close aria-label="Schließen" title="Schließen">${icon("x")}</button>
      </div>
    </header>
    <dl class="ad-profile__facts">
      ${factRow("phone", "Telefon", m.phone, tel)}
      ${factRow("mail", "E-Mail", m.email, m.email ? `mailto:${m.email}` : "")}
      ${factRow("map-pin", "PLZ", m.zip)}
      ${factRow("map", "Anschrift", m.address)}
    </dl>
    <section class="ad-profile__bio" aria-labelledby="ad-profile-bio-h">
      <h3 id="ad-profile-bio-h">Über ${esc(m.name.split(" ")[0])}</h3>
      ${m.bio ? `<p class="ad-profile__biotext">${esc(m.bio)}</p>`
        : `<p class="ad-profile__none">Noch nichts eingetragen. Über den Stift oben rechts kannst du hier alles notieren: Aufgaben, Erreichbarkeit, Ideen …</p>`}
    </section>`;
}

function editField(name, label, type, value, extra = "") {
  return `<label class="ad-field"><span>${label}</span>
    <input type="${type}" name="${name}" value="${esc(value)}" maxlength="${MEMBER_LIMITS[name]}" ${extra}>
    <small class="ad-field__err" data-err="${name}" hidden></small></label>`;
}

function renderProfilePhoto() {
  const el = $("#ad-prof-photo");
  if (!el) return;
  const d = profile.draft;
  el.innerHTML = `
    <span class="ad-profile__photo">${avatar(d, 256)}${profile.uploading ? `<span class="ad-member__busy" aria-hidden="true"></span>` : ""}</span>
    <div class="ad-profile__photoactions">
      <button type="button" class="hb-btn ad-btn-ghost hb-btn--sm" data-prof-photo ${profile.uploading ? "disabled" : ""}>${icon("camera")}<span>${profile.uploading ? "Lädt hoch …" : d.photoUrl ? "Foto ändern" : "Foto hinzufügen"}</span></button>
      ${d.photoUrl && !profile.uploading ? `<button type="button" class="hb-btn ad-btn-ghost hb-btn--sm" data-prof-unphoto>${icon("trash-2")}<span>Foto entfernen</span></button>` : ""}
      <input type="file" accept="image/*" hidden data-prof-file>
    </div>`;
}

function renderProfileEdit() {
  const d = profile.draft;
  $("#ad-profile-body").innerHTML = `
    <form class="ad-profile__form" id="ad-profile-form" novalidate>
      <header class="ad-profile__head ad-profile__head--edit">
        <div class="ad-profile__name">
          <p class="ad-profile__kicker">${icon("pencil")}Steckbrief bearbeiten</p>
          <h2 id="ad-profile-title">${esc(team.members[profile.index]?.name ?? "")}</h2>
        </div>
        <div class="ad-profile__tools">
          <button class="hb-iconbtn" type="button" data-prof-close aria-label="Schließen" title="Schließen">${icon("x")}</button>
        </div>
      </header>
      <div class="ad-profile__editbody">
        <div class="ad-profile__photorow" id="ad-prof-photo"></div>
        ${editField("name", "Name", "text", d.name, 'autocomplete="off" required')}
        <div class="ad-grid2">
          ${editField("phone", "Telefon", "tel", d.phone, 'inputmode="tel" autocomplete="off" placeholder="+49 …"')}
          ${editField("email", "E-Mail", "email", d.email, 'inputmode="email" autocomplete="off" placeholder="name@…"')}
          ${editField("zip", "PLZ", "text", d.zip, 'inputmode="numeric" autocomplete="off" placeholder="z. B. 80331"')}
          ${editField("address", "Anschrift", "text", d.address, 'autocomplete="off" placeholder="Straße Hausnummer, Ort"')}
        </div>
        <label class="ad-field"><span>Steckbrief (frei, z. B. Aufgaben, Erreichbarkeit, Notizen)</span>
          <textarea name="bio" rows="7" maxlength="${MEMBER_LIMITS.bio}">${esc(d.bio)}</textarea></label>
      </div>
      <footer class="ad-profile__foot">
        <button class="hb-btn ad-btn-ghost" type="button" data-prof-cancel>Abbrechen</button>
        <button class="hb-btn hb-btn--dark" type="submit">${icon("check")}<span>Speichern</span></button>
      </footer>
    </form>`;
  renderProfilePhoto();
}

function openProfile(i) {
  profile.index = i;
  profile.mode = "view";
  profile.draft = null;
  profile.dirty = false;
  renderProfileView();
  if (!profileDlg.open) profileDlg.showModal();
  profileDlg.querySelector("[data-prof-edit]")?.focus();
}

function startEdit() {
  profile.mode = "edit";
  profile.draft = { ...team.members[profile.index] };
  profile.dirty = false;
  renderProfileEdit();
  $("#ad-profile-form").elements.namedItem("name").focus();
}

/** Bearbeiten verlassen. close=true schließt ganz, sonst zurück zur Ansicht. Fragt bei Änderungen nach. */
async function leaveEdit(close) {
  if (profile.uploading) {
    const ok = await askConfirm({ title: "Foto wird noch hochgeladen", text: "Wenn du jetzt abbrichst, wird das Foto nicht übernommen.", yes: "Trotzdem abbrechen", no: "Warten", symbol: "upload" });
    if (!ok) return;
  } else if (profile.dirty) {
    const ok = await askConfirm({
      title: "Änderungen verwerfen?",
      text: "Deine Eingaben im Steckbrief wurden noch nicht gespeichert und gehen verloren.",
      yes: "Verwerfen", no: "Weiter bearbeiten", danger: true
    });
    if (!ok) return;
  }
  profile.dirty = false;
  profile.uploading = false;
  if (close) { profileDlg.close(); return; }
  profile.mode = "view";
  renderProfileView();
  profileDlg.querySelector("[data-prof-edit]")?.focus();
}

function requestProfileClose() {
  if (profile.mode === "edit") leaveEdit(true);
  else profileDlg.close();
}

async function saveProfile() {
  const form = $("#ad-profile-form");
  const d = profile.draft;
  const errors = {};
  if (!d.name) errors.name = "Bitte einen Namen eintragen.";
  else if (team.members.some((x, k) => k !== profile.index && x.name.toLowerCase() === d.name.toLowerCase())) errors.name = "Diesen Namen gibt es schon im Team.";
  if (d.phone && !(PHONE_OK.test(d.phone) && d.phone.replace(/\D/g, "").length >= 6)) errors.phone = "Bitte eine gültige Telefonnummer eintragen.";
  if (d.email && !EMAIL_OK.test(d.email)) errors.email = "Bitte eine gültige E-Mail-Adresse eintragen.";
  if (d.zip && !ZIP_OK.test(d.zip)) errors.zip = "PLZ aus 4 oder 5 Ziffern.";
  form.querySelectorAll("[data-err]").forEach((el) => {
    const msg = errors[el.dataset.err];
    el.hidden = !msg;
    el.textContent = msg || "";
    const input = form.elements.namedItem(el.dataset.err);
    input.classList.toggle("is-invalid", !!msg);
    input.setAttribute("aria-invalid", msg ? "true" : "false");
  });
  const first = Object.keys(errors)[0];
  if (first) { form.elements.namedItem(first).focus(); return; }
  if (profile.uploading) { toast("Bitte warten, bis das Foto hochgeladen ist."); return; }

  const i = profile.index;
  const next = team.members.map((x, k) => (k === i ? normMember(d) : x));
  if (await saveTeam(next, "Steckbrief gespeichert.")) {
    profile.dirty = false;
    profile.mode = "view";
    if (profileDlg.open) { renderProfileView(); profileDlg.querySelector("[data-prof-edit]")?.focus(); }
  }
}

function initProfile() {
  profileDlg.addEventListener("click", (e) => {
    if (e.target === profileDlg) { requestProfileClose(); return; } // Klick auf den dunklen Rand
    if (e.target.closest("[data-prof-close]")) requestProfileClose();
    else if (e.target.closest("[data-prof-edit]")) startEdit();
    else if (e.target.closest("[data-prof-cancel]")) leaveEdit(false);
    else if (e.target.closest("[data-prof-photo]")) profileDlg.querySelector("[data-prof-file]")?.click();
    else if (e.target.closest("[data-prof-unphoto]")) { profile.draft.photoUrl = ""; profile.dirty = true; renderProfilePhoto(); }
  });
  profileDlg.addEventListener("input", (e) => {
    const el = e.target;
    if (profile.mode !== "edit" || !el.name || !(el.name in MEMBER_LIMITS)) return;
    profile.draft[el.name] = el.name === "bio" ? el.value : el.value.replace(/\s+/g, " ").trimStart();
    profile.dirty = true;
    const err = profileDlg.querySelector(`[data-err="${el.name}"]`);
    if (err) { err.hidden = true; el.classList.remove("is-invalid"); el.setAttribute("aria-invalid", "false"); }
  });
  profileDlg.addEventListener("change", async (e) => {
    const input = e.target.closest("[data-prof-file]");
    if (!input?.files?.[0]) return;
    profile.uploading = true;
    renderProfilePhoto();
    try {
      const url = await processAndUpload(input.files[0], 400);
      if (profile.mode === "edit" && profile.uploading) { profile.draft.photoUrl = url; profile.dirty = true; }
    } catch (err) {
      console.error(err);
      alert(err.message || "Foto konnte nicht hochgeladen werden.");
    } finally {
      profile.uploading = false;
      renderProfilePhoto();
    }
  });
  profileDlg.addEventListener("submit", (e) => {
    if (e.target.id !== "ad-profile-form") return;
    e.preventDefault();
    // Namen säubern, bevor geprüft wird
    profile.draft.name = profile.draft.name.trim();
    saveProfile();
  });
  // Escape: in der Ansicht schließen, beim Bearbeiten erst nachfragen (schon beim Tastendruck abfangen)
  profileDlg.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    if (profile.mode === "edit") leaveEdit(false);
    else profileDlg.close();
  });
  profileDlg.addEventListener("cancel", (e) => { e.preventDefault(); requestProfileClose(); });
}

function initTeam() {
  const form = $("#ad-team-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (team.state !== "ready") return; // Formular ist dann gesperrt und der Grund wird angezeigt
    const name = form.member.value.trim().replace(/\s+/g, " ");
    if (!name) { toast("Bitte einen Namen eintragen."); form.member.focus(); return; }
    if (team.members.some((m) => m.name.toLowerCase() === name.toLowerCase())) { toast(`${name} ist schon im Team.`); return; }
    if (team.members.length >= 50) { toast("Maximal 50 Mitglieder."); return; }
    if (await saveTeam([...team.members, normMember({ name })], `${name} hinzugefügt.`)) form.member.value = "";
    form.member.focus();
  });

  $("#ad-team-list").addEventListener("click", async (e) => {
    const item = e.target.closest("[data-index]");
    if (!item || team.saving) return;
    const i = Number(item.dataset.index);
    if (e.target.closest("[data-team-remove]")) await removeMember(i);
    else if (e.target.closest("[data-team-open]")) openProfile(i);
  });

  $("#ad-team-import").addEventListener("click", () =>
    saveTeam(IMPRESSUM_TEAM.map((name) => normMember({ name })), "Team aus dem Impressum übernommen."));

  initProfile();
}

/* =========================================================
   Start
   ========================================================= */
function renderAll() {
  renderCountries();
  renderProjects();
  renderSettings();
}

function initTabs() {
  document.querySelectorAll(".ad-tab").forEach((tab) => tab.addEventListener("click", () => {
    document.querySelectorAll(".ad-tab").forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
    document.querySelectorAll(".ad-panel").forEach((p) => { p.hidden = p.id !== `panel-${tab.dataset.tab}`; });
  }));
}

function init() {
  hydrateIcons();
  $("#ad-country-names").innerHTML = countryNames.map((n) => `<option value="${esc(n)}"></option>`).join("");
  initTabs();
  initSettings();
  initTeam();
  map = createMap($("#ad-map"), {
    onSelect: (id) => {
      const c = state.data.countries.find((x) => x.id === id);
      if (c) openCountryEditor(c);
    }
  });
  onListClick("#ad-country-list", "countries", renderCountries, openCountryEditor);
  onListClick("#ad-project-list", "projects", renderProjects, openProjectEditor);
  $("#ad-add-country").addEventListener("click", () => openCountryEditor(null));
  $("#ad-add-project").addEventListener("click", () => openProjectEditor(null));
  $("#ad-publish-btn").addEventListener("click", publish);
  window.addEventListener("beforeunload", (e) => {
    if (state.dirty || state.uploads > 0) { e.preventDefault(); e.returnValue = ""; }
  });
  initAuth().catch((err) => {
    console.error(err);
    loader.done();
    const errEl = $("#ad-login-error");
    errEl.textContent = "Firebase konnte nicht geladen werden. Internet prüfen und Seite neu laden.";
    errEl.hidden = false;
  });
}

init();
