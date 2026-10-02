/*
 * Hero-Weltkarte (D3 + Natural-Earth-Daten aus world-atlas, 1:50m, damit auch Gaza sichtbar ist).
 *
 * Bedienung – die Karte blockiert nie das Scrollen der Seite:
 *   Desktop: Strg/⌘ + Mausrad oder Trackpad-Pinch zoomt, Ziehen verschiebt, normales Mausrad scrollt die Seite.
 *   Touch:   Ein Finger scrollt die Seite, zwei Finger zoomen und verschieben.
 *   Überall: +/−/Zurücksetzen-Buttons. Klick auf ein markiertes Land zoomt hin und öffnet den Bericht.
 */
import { esc, safeColor } from "./util.js";
import { icon } from "./icons.js";

const ANTARCTICA = "010";
const MAX_ZOOM = 8;
const MAX_FOCUS_ZOOM = 6;
let worldPromise = null;

function loadWorld() {
  if (!worldPromise) {
    worldPromise = (async () => {
      const res = await fetch("https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json");
      if (!res.ok) throw new Error(`Kartendaten nicht geladen (${res.status})`);
      return res.json();
    })();
  }
  return worldPromise;
}

const isWide = (W, H) => W / H > 1.5;

function projectionFor(W, H) {
  const wide = isWide(W, H);
  return window.d3.geoMercator()
    .center(wide ? [28, 12] : [48, 14])
    .scale(wide ? Math.min(W / 5, H / 1.75) : W / 1.75)
    .translate(wide ? [W * 0.7, H * 0.52] : [W * 0.5, H * 0.5]);
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Labels standardmäßig rechts vom Pin. Links platzieren, wenn rechts der Kartenrand,
 * ein anderer Pin oder ein bereits gesetztes Label im Weg ist.
 */
function fitLabels(labels, W) {
  const els = [...labels.querySelectorAll(".hb-map__label")];
  const pins = els.map((el) => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top) }));
  const placed = [];
  const GAP = 14;
  const hits = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

  els.forEach((el, i) => {
    const { x, y } = pins[i];
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const boxFor = (left) => left
      ? { l: x - GAP - w, r: x - GAP, t: y - h / 2, b: y + h / 2 }
      : { l: x + GAP, r: x + GAP + w, t: y - h / 2, b: y + h / 2 };
    const blocked = (box) =>
      box.r > W - 8 || box.l < 8 ||
      placed.some((p) => hits(box, p)) ||
      pins.some((p, j) => j !== i && hits(box, { l: p.x - 14, r: p.x + 14, t: p.y - 10, b: p.y + 10 }));

    const right = boxFor(false);
    let left = false;
    if (blocked(right)) {
      // Links nur, wenn dort frei ist – oder rechts sowieso aus der Karte ragen würde
      left = !blocked(boxFor(true)) || right.r > W - 8;
    }
    el.classList.toggle("is-left", left);
    placed.push(boxFor(left));
  });
}

export function createMap(container, { onSelect }) {
  if (!window.d3 || !window.topojson) {
    container.classList.add("is-unavailable");
    return { update() {} };
  }
  const d3 = window.d3;
  let countries = [];
  let features = null;
  let points = [];
  let path = null;
  let size = { W: 0, H: 0 };
  let t = d3.zoomIdentity;
  let frame = 0;
  let hintTimer = 0;
  let touchHintShown = false;

  container.innerHTML = `
    <svg class="hb-map__svg" aria-hidden="true" focusable="false">
      <defs>
        <filter id="hb-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <g class="hb-map__world">
        <g class="hb-map__land"></g>
        <g class="hb-map__hot"></g>
      </g>
      <g class="hb-map__pins"></g>
    </svg>
    <div class="hb-map__labels"></div>
    <div class="hb-map__controls" role="group" aria-label="Kartenzoom">
      <button type="button" class="hb-map__ctrl" data-zoom="in" aria-label="Hineinzoomen">${icon("plus")}</button>
      <button type="button" class="hb-map__ctrl" data-zoom="out" aria-label="Herauszoomen">${icon("minus")}</button>
      <button type="button" class="hb-map__ctrl" data-zoom="reset" aria-label="Karte zurücksetzen" disabled>${icon("rotate-ccw")}</button>
    </div>
    <p class="hb-map__hint" aria-hidden="true"></p>`;

  const svg = d3.select(container).select("svg");
  const world = svg.select(".hb-map__world");
  const land = svg.select(".hb-map__land");
  const hot = svg.select(".hb-map__hot");
  const pins = svg.select(".hb-map__pins");
  const labels = container.querySelector(".hb-map__labels");
  const hint = container.querySelector(".hb-map__hint");
  const btnIn = container.querySelector('[data-zoom="in"]');
  const btnOut = container.querySelector('[data-zoom="out"]');
  const btnReset = container.querySelector('[data-zoom="reset"]');

  /* ---------- Hinweis-Bubble ---------- */
  function showHint(text) {
    hint.textContent = text;
    hint.classList.add("is-visible");
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hint.classList.remove("is-visible"), 1600);
  }

  /* ---------- Zoom-Verhalten ---------- */
  const zoom = d3.zoom()
    .scaleExtent([1, MAX_ZOOM])
    .filter((event) => {
      if (event.type === "wheel") {
        // Nur Strg/⌘ + Rad (Trackpad-Pinch sendet ctrlKey). Normales Rad scrollt die Seite.
        if (event.ctrlKey || event.metaKey) return true;
        showHint("Strg/⌘ + Mausrad zum Zoomen");
        return false;
      }
      if (event.type.startsWith("touch")) {
        // Ein Finger gehört der Seite (Scrollen), zwei Finger der Karte.
        if (event.touches.length >= 2) return true;
        if (event.type === "touchstart" && !touchHintShown) {
          touchHintShown = true;
          showHint("Mit zwei Fingern zoomen");
        }
        return false;
      }
      return !event.button; // Maus: nur linke Taste
    })
    .on("zoom", (event) => {
      t = event.transform;
      world.attr("transform", t);
      scheduleOverlay();
    });

  svg.call(zoom)
    .on("dblclick.zoom", null)                // Doppelklick nicht kapern
    .style("touch-action", "pan-y"); // Ein-Finger-Scroll bleibt beim Browser, Pinch geht an die Karte

  /* ---------- Pins + Labels folgen dem Zoom ---------- */
  function updateOverlay() {
    const { W, H } = size;
    const placed = points.map((d) => ({ ...d, s: t.apply(d.p) }));
    pins.selectAll("g")
      .data(placed, (d) => d.c.id)
      .join((enter) => {
        const g = enter.append("g");
        g.append("circle").attr("class", "hb-pin__ring").attr("r", 7);
        g.append("circle").attr("class", "hb-pin__dot").attr("r", 3.2);
        return g;
      })
      .attr("transform", (d) => `translate(${d.s[0]},${d.s[1]})`)
      .classed("is-out", (d) => d.s[0] < -20 || d.s[0] > W + 20 || d.s[1] < -20 || d.s[1] > H + 20)
      .select(".hb-pin__ring").attr("stroke", (d) => d.color);

    labels.querySelectorAll(".hb-map__label").forEach((el) => {
      const d = placed.find((x) => x.c.id === el.dataset.mapCountry);
      if (!d) return;
      el.style.left = `${d.s[0].toFixed(1)}px`;
      el.style.top = `${d.s[1].toFixed(1)}px`;
      el.hidden = d.s[0] < -20 || d.s[0] > W + 20 || d.s[1] < -20 || d.s[1] > H + 20;
    });
    fitLabels(labels, W);

    const zoomed = t.k > 1.001 || Math.abs(t.x) > 0.5 || Math.abs(t.y) > 0.5;
    btnReset.disabled = !zoomed;
    btnIn.disabled = t.k >= MAX_ZOOM - 0.001;
    btnOut.disabled = t.k <= 1.001;
    container.classList.toggle("is-zoomed", zoomed);
  }

  function scheduleOverlay() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(updateOverlay);
  }

  /* ---------- Karte zeichnen (bei Daten- oder Größenänderung) ---------- */
  function draw() {
    if (!features) return;
    const W = container.clientWidth;
    const H = container.clientHeight;
    if (!W || !H) return;

    const resized = W !== size.W || H !== size.H;
    size = { W, H };
    svg.attr("viewBox", `0 0 ${W} ${H}`).attr("width", W).attr("height", H);
    zoom.extent([[0, 0], [W, H]]).translateExtent([[0, 0], [W, H]]);
    path = d3.geoPath(projectionFor(W, H));

    land.selectAll("path")
      .data(features, (d) => d.id)
      .join("path")
      .attr("d", path);

    const byIso = new Map(features.map((f) => [f.id, f]));
    const active = countries
      .map((c) => ({ c, f: byIso.get(c.isoNumeric) }))
      .filter((x) => x.f)
      .map((x) => ({ ...x, color: safeColor(x.c.mapColor) }));

    hot.selectAll("path")
      .data(active, (d) => d.c.id)
      .join("path")
      .attr("d", (d) => path(d.f))
      .attr("fill", (d) => d.color)
      .attr("stroke", (d) => d.color)
      .attr("filter", "url(#hb-glow)")
      .on("click", (_, d) => select(d.c.id));

    points = active.map((d) => ({ ...d, p: path.centroid(d.f) }))
      .filter((d) => Number.isFinite(d.p[0]) && Number.isFinite(d.p[1]));

    labels.innerHTML = points.map((d) => `
      <button type="button" class="hb-map__label" data-map-country="${esc(d.c.id)}"
        style="--pin:${d.color}" aria-label="Bericht zu ${esc(d.c.name)} öffnen">${esc(d.c.name)}</button>`).join("");

    // Neue Größe = neue Projektion: alter Zoom passt nicht mehr, also zurücksetzen
    if (resized && (t.k !== 1 || t.x || t.y)) svg.call(zoom.transform, d3.zoomIdentity);
    updateOverlay();
  }

  /* ---------- Aktionen ---------- */
  const duration = (ms) => (reducedMotion() ? 0 : ms);

  function focusCountry(id) {
    const d = points.find((x) => x.c.id === id);
    if (!d || !path) return;
    const { W, H } = size;
    const [[x0, y0], [x1, y1]] = path.bounds(d.f);
    const k = Math.max(1, Math.min(MAX_FOCUS_ZOOM, 0.55 / Math.max((x1 - x0) / W, (y1 - y0) / H)));
    const cx = isWide(W, H) ? W * 0.7 : W * 0.5;
    const target = d3.zoomIdentity
      .translate(cx, H / 2)
      .scale(k)
      .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
    svg.transition().duration(duration(650)).call(zoom.transform, target);
  }

  function select(id) {
    focusCountry(id);
    onSelect(id);
  }

  // Strg/⌘ + Rad über einem Label soll trotzdem die Karte zoomen
  labels.addEventListener("wheel", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    svg.node().dispatchEvent(new WheelEvent("wheel", {
      bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY,
      deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode, ctrlKey: e.ctrlKey, metaKey: e.metaKey
    }));
  }, { passive: false });

  labels.addEventListener("click", (e) => {
    const b = e.target.closest("[data-map-country]");
    if (b) select(b.dataset.mapCountry);
  });

  container.querySelector(".hb-map__controls").addEventListener("click", (e) => {
    const b = e.target.closest("[data-zoom]");
    if (!b || b.disabled) return;
    const tr = svg.transition().duration(duration(300));
    if (b.dataset.zoom === "in") tr.call(zoom.scaleBy, 1.6);
    else if (b.dataset.zoom === "out") tr.call(zoom.scaleBy, 1 / 1.6);
    else tr.call(zoom.transform, d3.zoomIdentity);
  });

  /* ---------- Start ---------- */
  let drawFrame = 0;
  const schedule = () => {
    cancelAnimationFrame(drawFrame);
    drawFrame = requestAnimationFrame(draw);
  };
  new ResizeObserver(schedule).observe(container);

  loadWorld()
    .then((topo) => {
      features = window.topojson.feature(topo, topo.objects.countries).features
        .filter((f) => f.id !== ANTARCTICA);
      container.classList.add("is-ready");
      schedule();
    })
    .catch((err) => {
      console.error(err);
      container.classList.add("is-unavailable");
    });

  return {
    update(next) {
      countries = next ?? [];
      schedule();
    }
  };
}
