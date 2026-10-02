/*
 * Hero-Weltkarte (D3 + Natural-Earth-Daten aus world-atlas, 1:50m, damit auch Gaza sichtbar ist).
 * Phase 2: Darstellung + Klick auf markierte Länder öffnet den Bericht.
 * Phase 3: Zoom/Pan, Zoom-Buttons, Hinzoomen beim Klick.
 */
import { esc, safeColor } from "./util.js";

const ANTARCTICA = "010";
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

function projectionFor(W, H) {
  const wide = W / H > 1.5;
  return window.d3.geoMercator()
    .center(wide ? [28, 12] : [48, 14])
    .scale(wide ? Math.min(W / 5, H / 1.75) : W / 1.75)
    .translate(wide ? [W * 0.7, H * 0.52] : [W * 0.5, H * 0.5]);
}

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
    el.classList.remove("is-left");
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
  let frame = 0;

  container.innerHTML = `
    <svg class="hb-map__svg" aria-hidden="true" focusable="false">
      <defs>
        <filter id="hb-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <g class="hb-map__land"></g>
      <g class="hb-map__hot"></g>
      <g class="hb-map__pins"></g>
    </svg>
    <div class="hb-map__labels"></div>`;

  const svg = d3.select(container).select("svg");
  const land = svg.select(".hb-map__land");
  const hot = svg.select(".hb-map__hot");
  const pins = svg.select(".hb-map__pins");
  const labels = container.querySelector(".hb-map__labels");

  function draw() {
    if (!features) return;
    const W = container.clientWidth;
    const H = container.clientHeight;
    if (!W || !H) return;

    svg.attr("viewBox", `0 0 ${W} ${H}`).attr("width", W).attr("height", H);
    const path = d3.geoPath(projectionFor(W, H));

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
      .on("click", (_, d) => onSelect(d.c.id));

    const points = active.map((d) => ({ ...d, p: path.centroid(d.f) }))
      .filter((d) => Number.isFinite(d.p[0]) && Number.isFinite(d.p[1]));

    pins.selectAll("g")
      .data(points, (d) => d.c.id)
      .join((enter) => {
        const g = enter.append("g");
        g.append("circle").attr("class", "hb-pin__ring").attr("r", 7);
        g.append("circle").attr("class", "hb-pin__dot").attr("r", 3.2);
        return g;
      })
      .attr("transform", (d) => `translate(${d.p[0]},${d.p[1]})`)
      .select(".hb-pin__ring").attr("stroke", (d) => d.color);

    labels.innerHTML = points.map((d) => `
      <button type="button" class="hb-map__label" data-open-report="${esc(d.c.id)}"
        style="left:${d.p[0].toFixed(1)}px;top:${d.p[1].toFixed(1)}px;--pin:${d.color}"
        aria-label="Bericht zu ${esc(d.c.name)} öffnen">${esc(d.c.name)}</button>`).join("");
    fitLabels(labels, W);
  }

  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
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
