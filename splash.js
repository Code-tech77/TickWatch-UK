/* TickWatch UK: intro splash + early accessibility settings.
   Plain JavaScript on purpose: it must run before React and Babel have loaded. */
(function () {
  var doc = document, html = doc.documentElement, P = {};
  var SIZES = [100, 112, 125, 150, 175];

  // 1. Re-apply saved accessibility settings straight away (no flash of the default style).
  try { P = JSON.parse(localStorage.getItem("tw_a11y") || "{}") || {}; } catch (e) { P = {}; }
  Object.keys(P).forEach(function (k) { if (k !== "size" && P[k] === true) html.classList.add("a11y-" + k); });
  if (SIZES[P.size]) html.style.fontSize = SIZES[P.size] + "%";

  // 2. Intro splash (plays on every load / refresh).
  var splash = doc.getElementById("splash"), root = doc.getElementById("root");
  if (!splash || !root) return;
  var osReduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (P.motion === true || osReduce) { splash.parentNode.removeChild(splash); toDashboard(); return; } // motion-sensitive users skip it

  var MIN_MS = 2900, done = false, minDone = false, loaded = doc.readyState === "complete";
  html.classList.add("splash-on");           // freezes page animations + scrolling underneath
  root.setAttribute("inert", "");            // keeps keyboard focus out of the hidden app

  // When the intro ends, take the visitor to the dashboard (map + filters).
  // The dashboard may still be loading (Babel compile, API fetch), so wait until the map exists
  // and the page is tall enough, then scroll. Cancel if the visitor starts scrolling themselves.
  function toDashboard() {
    var tries = 0, cancelled = false, evts = ["wheel", "touchstart", "mousedown"];
    function stop() { cancelled = true; clearInterval(t); evts.forEach(function (n) { window.removeEventListener(n, stop); }); }
    evts.forEach(function (n) { window.addEventListener(n, stop, { passive: true }); });
    var t = setInterval(function () {
      var map = doc.getElementById("map"), main = doc.getElementById("content");
      if (map && main && !cancelled) {
        stop();
        requestAnimationFrame(function () {
          var y = main.getBoundingClientRect().top + window.pageYOffset - 76; // sticky header height
          window.scrollTo({ top: Math.max(0, y), behavior: html.classList.contains("a11y-motion") ? "auto" : "smooth" });
        });
      } else if (++tries > 200) stop(); // give up after ~20 s
    }, 100);
  }
  function finish() {
    if (done) return; done = true;
    splash.classList.add("out");             // curtain wipes upward
    html.classList.remove("splash-on");      // page entrance animations start as the curtain lifts
    root.removeAttribute("inert");
    root.classList.add("intro");
    toDashboard();                           // intro over: take the visitor to the main dashboard
    setTimeout(function () { if (splash.parentNode) splash.parentNode.removeChild(splash); }, 1200);
  }
  function tryFinish() { if (minDone && loaded) finish(); }

  setTimeout(function () { minDone = true; tryFinish(); }, MIN_MS);
  if (!loaded) window.addEventListener("load", function () { loaded = true; tryFinish(); });
  setTimeout(function () { finish(); }, 9000);                  // failsafe if something never loads

})();
