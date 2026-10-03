/*
 * Weltkarte (Canvas + D3, Natural-Earth-Daten 1:50m, damit auch Gaza sichtbar ist).
 *
 * Warum Canvas: Die Ländergrenzen werden einmal als Path2D vorberechnet und pro Frame nur
 * noch skaliert. Das ist auch auf Handys flüssig und in voller Retina-Schärfe.
 * Der Glow um markierte Länder wird nur im Ruhezustand gezeichnet (er ist teuer).
 *
 * Bedienung – Scrollen und Zoomen sind getrennt:
 *   Inaktiv:  Seite scrollt normal (Mausrad / ein Finger). Ziehen mit der Maus bewegt die Karte.
 *             Zwei Finger oder Strg/⌘ + Mausrad zoomen trotzdem.
 *   Antippen/Klicken der Karte aktiviert sie: dann bewegt ein Finger die Karte, das Mausrad zoomt.
 *   Beenden:  „Fertig“, Escape, Tippen außerhalb oder wenn die Karte aus dem Bild scrollt.
 *   Markiertes Land antippen: hinzoomen + Bericht öffnen.
 *   Start: eingezoomt auf die Krisenregion. Rauszoomen bis zur ganzen Welt ist möglich.
 */
import { esc, safeColor } from "./util.js";
import { icon } from "./icons.js";

const WORLD_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json";
const WORLD_LOW_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json"; // 10× weniger Punkte, nur während Bewegung
const ANTARCTICA = "010";
const MAX_ZOOM_FACTOR = 9;      // maximaler Zoom relativ zur Startansicht
const LAND = "#24344c";
const BORDER = "#3a4d6a";

let worldPromise = null;
let worldLowPromise = null;

function loadWorldLow() {
  worldLowPromise ??= fetch(WORLD_LOW_URL)
    .then((res) => (res.ok ? res.json() : null))
    .then((topo) => topo && window.topojson.feature(topo, topo.objects.countries).features.filter((f) => f.id !== ANTARCTICA))
    .catch(() => null);
  return worldLowPromise;
}

/** Lädt die Weltdaten einmal und gibt die Länder-Features zurück (auch fürs Admin nutzbar). */
export function loadWorldFeatures() {
  if (!worldPromise) {
    worldPromise = fetch(WORLD_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`Kartendaten nicht geladen (${res.status})`);
        return res.json();
      })
      .then((topo) => window.topojson.feature(topo, topo.objects.countries).features
        .filter((f) => f.id !== ANTARCTICA));
  }
  return worldPromise;
}

/** Eindeutige Kennung einer Kartenfläche. Länder ohne ISO-Nummer (z. B. Kosovo) über den Namen. */
export const featureKey = (f) => f.id ?? `n:${f.properties.name}`;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const coarsePointer = () => window.matchMedia("(pointer: coarse)").matches;

/** Ganze Welt (ohne Antarktis) passt in den Container: das ist Zoomstufe 1. */
function worldProjection(d3, W, H) {
  return d3.geoMercator().fitExtent([[6, 6], [W - 6, H - 6]], {
    type: "MultiPoint", coordinates: [[-180, -56], [180, 80]]
  });
}

/** Krisenregion für die Startansicht: Westafrika bis Afghanistan, Südafrika bis Türkei. */
const HOME_REGION = { type: "MultiPoint", coordinates: [[-14, -12], [72, 40]] };

/**
 * Startansicht: die Krisenregion passend in den FREIEN Bereich der Karte einpassen.
 * free = Bereich, der nicht vom Hero-Text verdeckt ist (Desktop: rechts, Handy: ganze Karte).
 */
function homeTransform(d3, proj, free) {
  const [[x0, y0], [x1, y1]] = d3.geoPath(proj).bounds(HOME_REGION);
  const fw = free.r - free.l;
  const fh = free.b - free.t;
  const k = Math.max(1, 0.92 * Math.min(fw / (x1 - x0), fh / (y1 - y0)));
  const cx = (free.l + free.r) / 2;
  const cy = (free.t + free.b) / 2;
  return d3.zoomIdentity.translate(cx - k * (x0 + x1) / 2, cy - k * (y0 + y1) / 2).scale(k);
}

/**
 * @param {HTMLElement} container
 * @param {{ onSelect: (id: string) => void, avoid?: string[] }} options
 *   avoid: Selektoren von Elementen, die über der Karte liegen (Labels weichen ihnen aus).
 */
export function createMap(container, { onSelect, avoid = [] }) {
  if (!window.d3 || !window.topojson || !window.Path2D) {
    container.classList.add("is-unavailable");
    return { update() {} };
  }
  const d3 = window.d3;

  container.innerHTML = `
    <canvas class="hb-map__canvas" aria-hidden="true"></canvas>
    <div class="hb-map__labels"></div>
    <div class="hb-map__controls" role="group" aria-label="Kartensteuerung">
      <button type="button" class="hb-map__ctrl" data-zoom="in" aria-label="Hineinzoomen">${icon("plus")}</button>
      <button type="button" class="hb-map__ctrl" data-zoom="out" aria-label="Herauszoomen">${icon("minus")}</button>
      <button type="button" class="hb-map__ctrl" data-zoom="world" aria-label="Ganze Welt zeigen">${icon("globe")}</button>
      <button type="button" class="hb-map__ctrl" data-zoom="home" aria-label="Zur Startansicht">${icon("rotate-ccw")}</button>
    </div>
    <button type="button" class="hb-map__done" hidden>${icon("check")}<span>Fertig</span></button>
    <p class="hb-map__hint" aria-live="polite"></p>`;

  const canvas = container.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const labelsEl = container.querySelector(".hb-map__labels");
  const hintEl = container.querySelector(".hb-map__hint");
  const doneBtn = container.querySelector(".hb-map__done");
  const btn = (name) => container.querySelector(`[data-zoom="${name}"]`);

  let features = null;
  let countries = [];
  let hot = [];                 // [{ c, color, path: Path2D, f, bounds, p }]
  let built = false;            // Karte für aktuelle Größe aufgebaut?
  let countryPaths = [];        // Detailkarte pro Land, mit Umriss für "nur Sichtbares zeichnen"
  let landLow = null;           // vereinfachte Karte für flüssige Bewegung
  let lowFeatures = null;
  let proj = null;
  let home = d3.zoomIdentity;
  let t = d3.zoomIdentity;
  let size = { W: 0, H: 0, dpr: 1 };
  let avoidRects = [];
  let free = { l: 0, t: 0, r: 0, b: 0 };   // nicht verdeckter Kartenbereich
  let active = false;
  let interacting = false;
  let userMoved = false;
  let frame = 0;
  let wantGlow = true;
  let hintTimer = 0;

  /* ---------- Hinweis ---------- */
  function hint(text, ms = 1800) {
    hintEl.textContent = text;
    hintEl.classList.add("is-visible");
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hintEl.classList.remove("is-visible"), ms);
  }

  /* ---------- Aktivieren / Deaktivieren ---------- */
  function setActive(on) {
    if (active === on) return;
    active = on;
    container.classList.toggle("is-active", on);
    canvas.style.touchAction = on ? "none" : "pan-y";
    doneBtn.hidden = !on;
    if (on) hint(coarsePointer() ? "Wischen bewegt die Karte, zwei Finger zoomen" : "Mausrad zoomt, Ziehen bewegt die Karte");
  }

  /* ---------- Zoom ---------- */
  const zoom = d3.zoom()
    .filter((event) => {
      if (event.type === "wheel") {
        if (active || event.ctrlKey || event.metaKey) return true;
        hint("Klicke in die Karte, um mit dem Mausrad zu zoomen");
        return false;
      }
      if (event.type === "dblclick") return active;
      if (event.type === "touchstart") {
        if (active) return true;
        if (event.touches.length >= 2) {
          // Finger landen nacheinander: D3 kennt sonst nur den zweiten und würde verschieben statt zoomen.
          // Darum hier beide Finger als "neu" melden.
          try { Object.defineProperty(event, "changedTouches", { value: event.touches }); } catch (e) { /* egal */ }
          return true;
        }
        return false;
      }
      return !event.button; // Maus: Ziehen geht immer, das stört das Scrollen nicht
    })
    .on("start", (event) => {
      interacting = true;
      const se = event.sourceEvent;
      if (se && se.touches && se.touches.length >= 2) setActive(true);
    })
    .on("zoom", (event) => {
      t = event.transform;
      if (event.sourceEvent) userMoved = true;
      schedule();
    })
    .on("end", () => {
      interacting = false;
      schedule(true);
    });

  const canvasSel = d3.select(canvas).call(zoom).on("dblclick.zoom", null);
  canvasSel.on("dblclick.zoom", (event) => { // Doppelklick nur im aktiven Zustand
    if (!active) return;
    const [x, y] = d3.pointer(event, canvas);
    canvasSel.transition().duration(reducedMotion() ? 0 : 300).call(zoom.scaleBy, 1.8, [x, y]);
  });
  canvas.style.touchAction = "pan-y";

  /* ---------- Zeichnen ---------- */
  function draw() {
    frame = 0;
    if (!built) return;
    const { W, H, dpr } = size;
    const glow = wantGlow && !interacting;
    wantGlow = false;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.setTransform(dpr * t.k, 0, 0, dpr * t.k, dpr * t.x, dpr * t.y);
    ctx.fillStyle = LAND;
    ctx.lineWidth = 0.6 / t.k;
    ctx.strokeStyle = BORDER;
    ctx.lineJoin = "round";
    if (interacting && landLow && t.k < home.k * 2.5) {
      // In Bewegung: leichte Karte (fällt in der Bewegung nicht auf, ist aber ~10× schneller)
      ctx.fill(landLow);
      ctx.stroke(landLow);
    } else {
      // Ruhe oder stark gezoomt: Detailkarte, aber nur Länder im sichtbaren Bereich
      const vx0 = -t.x / t.k, vy0 = -t.y / t.k, vx1 = (W - t.x) / t.k, vy1 = (H - t.y) / t.k;
      for (const cp of countryPaths) {
        if (cp.x1 < vx0 || cp.x0 > vx1 || cp.y1 < vy0 || cp.y0 > vy1) continue;
        ctx.fill(cp.path);
        ctx.stroke(cp.path);
      }
    }

    for (const h of hot) {
      ctx.save();
      if (glow) {
        ctx.shadowColor = h.color;
        ctx.shadowBlur = 18 * dpr;
      }
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = h.color;
      ctx.fill(h.path);
      ctx.restore();
      ctx.lineWidth = 1 / t.k;
      ctx.strokeStyle = h.color;
      ctx.stroke(h.path);
    }

    // Pins in Bildschirm-Koordinaten, damit sie beim Zoomen gleich groß bleiben
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const h of hot) {
      const [x, y] = t.apply(h.p);
      if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(15, 27, 45, .45)";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = h.color;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
    }

    placeLabels();
    updateControls();
  }

  function schedule(glow = false) {
    if (glow) wantGlow = true;
    if (!frame) frame = requestAnimationFrame(draw);
  }

  /* ---------- Labels: ohne Layout-Abfragen pro Frame (Breiten sind gecacht) ---------- */
  function measureLabels() {
    labelsEl.querySelectorAll(".hb-map__label").forEach((el) => {
      el._w = el.offsetWidth;
      el._h = el.offsetHeight;
    });
  }

  function placeLabels() {
    const { W, H } = size;
    const GAP = 14;
    const placed = [];
    const hits = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
    const screen = hot.map((h) => t.apply(h.p));
    // Bildschirm-Umrisse der markierten Länder: Labels sollen sie möglichst nicht verdecken
    const areas = hot.map((h) => {
      const [a0, a1] = [t.apply(h.bounds[0]), t.apply(h.bounds[1])];
      return { l: a0[0], r: a1[0], t: a0[1], b: a1[1] };
    });
    const els = labelsEl.children;

    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      const [x, y] = screen[i];
      const w = el._w || 80;
      const h = el._h || 26;
      // Mögliche Positionen in Reihenfolge der Vorliebe: rechts, links, oben, unten
      const box = (side) => side === "left" ? { l: x - GAP - w, r: x - GAP, t: y - h / 2, b: y + h / 2 }
        : side === "top" ? { l: x - w / 2, r: x + w / 2, t: y - 12 - h, b: y - 12 }
        : side === "bottom" ? { l: x - w / 2, r: x + w / 2, t: y + 12, b: y + 12 + h }
        : { l: x + GAP, r: x + GAP + w, t: y - h / 2, b: y + h / 2 };
      const coversCountry = (b) => areas.some((r, j) => j !== i && hits(b, r));
      const blocked = (b) =>
        b.l < 6 || b.r > W - 6 || b.t < 4 || b.b > H - 4 ||
        placed.some((p) => hits(b, p)) ||
        avoidRects.some((r) => hits(b, r)) ||
        screen.some((p, j) => j !== i && hits(b, { l: p[0] - 12, r: p[0] + 12, t: p[1] - 10, b: p[1] + 10 }));

      const inView = x > -10 && x < W + 10 && y > -10 && y < H + 10;
      const sides = ["right", "left", "top", "bottom"];
      const side = !inView ? null
        : sides.find((sd) => !blocked(box(sd)) && !coversCountry(box(sd)))  // ideal: nichts verdeckt
          ?? sides.find((sd) => !blocked(box(sd)))                          // sonst: nur keine Überlappung mit Labels/Pins/Text
          ?? null;
      if (el.dataset.side !== (side ?? "none")) el.dataset.side = side ?? "none";
      if (side) {
        const bx = box(side);
        placed.push({ l: bx.l - 4, r: bx.r + 4, t: bx.t - 4, b: bx.b + 4 }); // 4 px Mindestabstand zwischen Labels
        el.style.setProperty("--x", `${x.toFixed(1)}px`);
        el.style.setProperty("--y", `${y.toFixed(1)}px`);
      }
    }
  }

  function updateControls() {
    const [kMin, kMax] = zoom.scaleExtent();
    const atHome = Math.abs(t.k - home.k) < 0.01 && Math.abs(t.x - home.x) < 1 && Math.abs(t.y - home.y) < 1;
    btn("in").disabled = t.k >= kMax - 0.001;
    btn("out").disabled = t.k <= kMin + 0.001;
    btn("world").disabled = t.k <= kMin + 0.001;
    btn("home").disabled = atHome;
  }

  /* ---------- Aufbau bei Größen- oder Datenänderung ---------- */
  function buildHot() {
    if (!features || !proj) return;
    const byKey = new Map(features.map((f) => [featureKey(f), f]));
    const geo = d3.geoPath(proj);
    hot = countries
      .map((c) => ({ c, f: byKey.get(String(c.isoNumeric ?? "")) }))
      .filter((x) => x.f)
      .map((x) => {
        const path = new Path2D();
        d3.geoPath(proj, path)(x.f);
        const p = geo.centroid(x.f);
        return { ...x, color: safeColor(x.c.mapColor, "#ff3b4e"), path, bounds: geo.bounds(x.f), p };
      })
      .filter((x) => Number.isFinite(x.p[0]) && Number.isFinite(x.p[1]));

    labelsEl.innerHTML = hot.map((h) => `
      <button type="button" class="hb-map__label" data-map-country="${esc(h.c.id)}"
        style="--pin:${h.color}" aria-label="Bericht zu ${esc(h.c.name)} öffnen">${esc(h.c.name)}</button>`).join("");
    measureLabels();
  }

  function measureAvoid() {
    const base = container.getBoundingClientRect();
    avoidRects = avoid
      .flatMap((sel) => [...document.querySelectorAll(sel)])
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width && r.height)
      .map((r) => ({ l: r.left - base.left - 4, r: r.right - base.left + 4, t: r.top - base.top - 4, b: r.bottom - base.top + 4 }));
    // Eigene Bedienelemente (Buttons oben rechts)
    // Freier Bereich: große Elemente, die links über der Karte liegen (Hero-Text), abziehen
    const W = base.width;
    const H = base.height;
    let left = 0;
    for (const r of avoidRects) {
      const coversMiddle = r.t < H * 0.5 && r.b > H * 0.5 && (r.b - r.t) > H * 0.4;
      if (coversMiddle && r.l < W * 0.5 && r.r < W * 0.75) left = Math.max(left, r.r);
    }
    // Rechts Platz für die Zoom-Buttons plus ein Label daneben
    free = { l: left + 8, t: 12, r: W - Math.min(110, W * 0.22), b: H - 12 };

    const c = container.querySelector(".hb-map__controls").getBoundingClientRect();
    if (c.width) avoidRects.push({ l: c.left - base.left - 6, r: c.right - base.left + 6, t: c.top - base.top - 6, b: c.bottom - base.top + 6 });
  }

  function buildLow() {
    if (!lowFeatures || !proj) return;
    landLow = new Path2D();
    d3.geoPath(proj, landLow)({ type: "FeatureCollection", features: lowFeatures });
  }

  function rebuild() {
    const W = container.clientWidth;
    const H = container.clientHeight;
    if (!W || !H || !features) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (W === size.W && H === size.H && dpr === size.dpr && built) return;

    // Ansicht merken, damit eine Größenänderung (z. B. Handy drehen) den Ausschnitt behält
    let keep = null;
    if (proj && userMoved && size.W) {
      const c = proj.invert(t.invert([size.W / 2, size.H / 2]));
      if (c && Number.isFinite(c[0])) keep = { c, rel: t.k / home.k };
    }

    size = { W, H, dpr };
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;

    proj = worldProjection(d3, W, H);
    measureAvoid();
    home = homeTransform(d3, proj, free);
    const geo = d3.geoPath(proj);
    countryPaths = features.map((f) => {
      const path = new Path2D();
      d3.geoPath(proj, path)(f);
      const [[x0, y0], [x1, y1]] = geo.bounds(f);
      return { path, x0, y0, x1, y1 };
    });
    built = true;
    buildLow();
    buildHot();

    zoom.extent([[0, 0], [W, H]])
      .translateExtent([[0, 0], [W, H]])
      .scaleExtent([1, home.k * MAX_ZOOM_FACTOR]);

    let next = home;
    if (keep) {
      const k = Math.max(1, Math.min(home.k * MAX_ZOOM_FACTOR, keep.rel * home.k));
      const p = proj(keep.c);
      next = d3.zoomIdentity.translate(W / 2 - k * p[0], H / 2 - k * p[1]).scale(k);
    }
    canvasSel.call(zoom.transform, next);
    schedule(true);
  }

  /* ---------- Treffer-Test für Klick/Hover ---------- */
  function hitTest(clientX, clientY) {
    if (!proj) return null;
    const r = canvas.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    for (const h of hot) {
      const [px, py] = t.apply(h.p);
      if ((px - x) ** 2 + (py - y) ** 2 < 16 ** 2) return h.c.id;
    }
    const ll = proj.invert(t.invert([x, y]));
    if (!ll) return null;
    for (let i = hot.length - 1; i >= 0; i--) {
      if (d3.geoContains(hot[i].f, ll)) return hot[i].c.id;
    }
    return null;
  }

  /* ---------- Aktionen ---------- */
  const dur = (ms) => (reducedMotion() ? 0 : ms);

  function focusCountry(id) {
    const h = hot.find((x) => x.c.id === id);
    if (!h) return;
    const { W, H } = size;
    const [[x0, y0], [x1, y1]] = h.bounds;
    const [kMin, kMax] = zoom.scaleExtent();
    const fit = 0.5 / Math.max((x1 - x0) / (free.r - free.l), (y1 - y0) / (free.b - free.t), 1e-6);
    const k = Math.max(Math.max(kMin, home.k), Math.min(kMax * 0.7, fit));
    const target = d3.zoomIdentity.translate((free.l + free.r) / 2, (free.t + free.b) / 2)
      .scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
    userMoved = true;
    canvasSel.transition().duration(dur(750)).ease(d3.easeCubicInOut).call(zoom.transform, target);
  }

  function select(id) {
    focusCountry(id);
    onSelect(id);
  }

  canvas.addEventListener("click", (e) => {
    const id = hitTest(e.clientX, e.clientY);
    if (id) { setActive(true); select(id); return; }
    if (!active) setActive(true);
  });

  let hoverFrame = 0;
  canvas.addEventListener("mousemove", (e) => {
    if (hoverFrame) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0;
      const id = interacting ? null : hitTest(e.clientX, e.clientY);
      canvas.style.cursor = id ? "pointer" : (active ? "grab" : "default");
    });
  });

  labelsEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-map-country]");
    if (b) select(b.dataset.mapCountry);
  });
  // Mausrad über einem Label soll trotzdem die Karte steuern
  labelsEl.addEventListener("wheel", (e) => {
    if (!(active || e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    canvas.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY,
      deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode, ctrlKey: e.ctrlKey, metaKey: e.metaKey
    }));
  }, { passive: false });

  container.querySelector(".hb-map__controls").addEventListener("click", (e) => {
    const b = e.target.closest("[data-zoom]");
    if (!b || b.disabled) return;
    const tr = canvasSel.transition().duration(dur(350)).ease(d3.easeCubicOut);
    userMoved = true;
    if (b.dataset.zoom === "in") tr.call(zoom.scaleBy, 1.6);
    else if (b.dataset.zoom === "out") tr.call(zoom.scaleBy, 1 / 1.6);
    else if (b.dataset.zoom === "world") tr.call(zoom.transform, d3.zoomIdentity);
    else { userMoved = false; tr.call(zoom.transform, home); }
  });

  doneBtn.addEventListener("click", () => setActive(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setActive(false); });
  document.addEventListener("pointerdown", (e) => {
    if (active && !container.contains(e.target)) setActive(false);
  }, true);
  new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.intersectionRatio < 0.3) setActive(false); });
  }, { threshold: [0, 0.3] }).observe(container);

  /* ---------- Start ---------- */
  let resizeFrame = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(rebuild);
  }).observe(container);
  window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener?.("change", () => rebuild());
  document.fonts?.ready.then(() => {
    measureLabels();
    if (!built) return;
    measureAvoid();
    const before = home;
    home = homeTransform(d3, proj, free);
    // Hat sich durch die Schrift der freie Bereich verändert und hat noch niemand gezoomt → neu einpassen
    if (!userMoved && (before.k !== home.k || before.x !== home.x)) canvasSel.call(zoom.transform, home);
    schedule(true);
  });

  loadWorldFeatures()
    .then((f) => {
      features = f;
      rebuild();
      container.classList.add("is-ready");
      // Leichte Karte im Hintergrund nachladen (nur für flüssige Bewegung)
      loadWorldLow().then((low) => { lowFeatures = low; buildLow(); });
    })
    .catch((err) => {
      console.error(err);
      container.classList.add("is-unavailable");
    });

  return {
    update(next) {
      countries = next ?? [];
      if (!proj) return;
      buildHot();
      schedule(true);
    }
  };
}
