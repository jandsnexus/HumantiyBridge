/*
 * Ladescreen: mindestens 600 ms (kein Flackern), höchstens 1200 ms, Tippen überspringt.
 * Die Seite rendert dahinter ganz normal weiter, er blockiert also nie.
 * Ohne JS blendet ein CSS-Fallback ihn nach 2,5 s aus.
 */
const MIN_MS = 600;
const MAX_MS = 1200;

export function initLoader() {
  const el = document.getElementById("hb-loader");
  if (!el) return;
  if (document.documentElement.classList.contains("hb-skip-loader")) {
    el.remove();
    return;
  }

  const start = performance.now();
  let done = false;

  const hide = () => {
    if (done) return;
    done = true;
    try { sessionStorage.setItem("hb-loader-seen", "1"); } catch (e) { /* privater Modus */ }
    el.classList.add("is-hidden");
    setTimeout(() => el.remove(), 450);
  };

  el.addEventListener("pointerdown", hide, { once: true });
  setTimeout(hide, MAX_MS);

  const onReady = () => setTimeout(hide, Math.max(0, MIN_MS - (performance.now() - start)));
  if (document.readyState === "complete") onReady();
  else window.addEventListener("load", onReady, { once: true });
}
