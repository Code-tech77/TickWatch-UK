/* TickWatch UK - Elanco Placement Programme frontend task.
   Author: Mohammed Zuoriki.
   Single-file React app (no build step), compiled in the browser by Babel standalone.
   React, Leaflet, markercluster and Chart.js are loaded as globals from index.html. */


const { useEffect, useMemo, useRef, useState, Component } = React;

const API = "https://dev-task.elancoapps.com";
const DAY = 864e5; // milliseconds in one day
let NOW = Date.now(); // re-anchored to the newest record once data loads

// The API only returns a city name, so sightings sit at approximate city centres
const CITIES = {
  London: [51.507, -0.128], Manchester: [53.481, -2.243], Birmingham: [52.486, -1.89], Edinburgh: [55.953, -3.188], Glasgow: [55.864, -4.252],
  Liverpool: [53.408, -2.992], Leeds: [53.8, -1.549], Sheffield: [53.381, -1.47], Bristol: [51.454, -2.587], Cardiff: [51.481, -3.18],
  Newcastle: [54.978, -1.618], Nottingham: [52.954, -1.15], Leicester: [52.637, -1.139], Belfast: [54.597, -5.93], Bournemouth: [50.72, -1.88],
  Brighton: [50.822, -0.137], Southampton: [50.904, -1.404], Portsmouth: [50.819, -1.088], Plymouth: [50.375, -4.143], Exeter: [50.726, -3.527],
  Oxford: [51.752, -1.258], Cambridge: [52.205, 0.119], Norwich: [52.63, 1.297], York: [53.959, -1.081], Aberdeen: [57.149, -2.094],
  Dundee: [56.462, -2.971], Inverness: [57.477, -4.225], Swansea: [51.621, -3.944], Coventry: [52.408, -1.511], Bath: [51.381, -2.359],
  Canterbury: [51.28, 1.08], Cheltenham: [51.9, -2.078], Ipswich: [52.056, 1.148], Reading: [51.454, -0.978], Stirling: [56.116, -3.937],
  Carlisle: [54.892, -2.944], Lancaster: [54.047, -2.801], Derby: [52.922, -1.476], Hull: [53.744, -0.332], Sunderland: [54.906, -1.381],
  Newport: [51.584, -2.998], Lincoln: [53.234, -0.538], Peterborough: [52.573, -0.243], Salisbury: [51.069, -1.795], Gloucester: [51.865, -2.244],
  Worcester: [52.192, -2.22], Truro: [50.263, -5.051], Durham: [54.777, -1.575],
  __UK: [54.5, -3], // fallback for unknown cities
};

// Species descriptions, keyed by Latin name
const INFO = {
  "Ixodes ricinus": "The most common UK tick. Small, dark brown to grey with 8 legs, found in woodland, heath, parks and gardens. The main carrier of Lyme disease.",
  "Ixodes hexagonus": "Often found on hedgehogs but will bite dogs and cats. Smaller and paler than the castor bean tick. Common in gardens.",
  "Ixodes canisuga": "Lives in kennels and dog bedding. Light brown and usually found in warm, sheltered places rather than open land.",
  "Ixodes trianguliceps": "A small tick that lives in the burrows of mice and voles. Rarely bites people.",
  "Ixodes frontalis": "Mainly found on birds, so it can turn up in gardens and woodland edges. Rarely bites people.",
  "Dermacentor reticulatus": "Ornate marbled silver-white pattern on its back. Can pass babesiosis to dogs. Found in coastal and western grassland.",
  "Haemaphysalis punctata": "Reddish-brown tick of chalk grassland and coastal pasture, mostly affecting sheep and cattle.",
  "Rhipicephalus sanguineus": "The brown dog tick. Prefers warm homes and kennels and can breed indoors.",
};
const info = (latin) =>
  INFO[latin] || "Recorded in the sightings data. Compare body size, colour and the pattern on the back shield, and ask a vet if you are unsure.";

// Deterministic string hash -> number between 0 and 1 (used for stable marker offsets)
const hash = (s) => {
  let h = 2166136261;
  for (const c of String(s)) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
};

// Convert an API record into the shape the app uses
function norm(r) {
  const c = CITIES[r.location] || CITIES.__UK;
  const a = hash(r.id);
  const b = hash(r.id + "x");
  return {
    id: r.id,
    date: new Date(r.date).getTime(),
    city: r.location,
    species: r.species,
    latin: r.latinName,
    lat: c[0] + (a - 0.5) * 0.12, // small offset so pins in one city don't stack
    lng: c[1] + (b - 0.5) * 0.16,
    notes: "",
    img: null,
    mapped: !!CITIES[r.location],
  };
}

// The API has no severity field, so derive it from local activity:
// sightings in the same city during the 30 days up to each sighting
function addSeverity(list) {
  const byCity = {};
  list.forEach((s) => (byCity[s.city] ||= []).push(s));

  // Count nearby sightings for each record
  Object.values(byCity).forEach((arr) =>
    arr.forEach((s) => {
      s.density = arr.filter((x) => x.date <= s.date && s.date - x.date < 30 * DAY).length;
    })
  );

  // Low = bottom 40%, Medium = next 40%, High = top 20%
  const sorted = list.map((s) => s.density).sort((a, b) => a - b);
  const t1 = sorted[Math.floor(sorted.length * 0.4)];
  const t2 = sorted[Math.floor(sorted.length * 0.8)];
  list.forEach((s) => {
    s.sev = s.density <= t1 ? "Low" : s.density <= t2 ? "Medium" : "High";
  });
}

// Turn raw API data into app data and set "now" to the newest record
function build(raw, mode, note) {
  const data = raw.map(norm).filter((x) => isFinite(x.date));
  NOW = Math.max(...data.map((x) => x.date));
  addSeverity(data);
  return { data, mode, note };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Fetch raw records from the API (CORS is enabled)
async function fetchRaw() {
  let last;
  for (const u of [API + "/tick-sightings"]) {
    try {
      const r = await fetch(u);
      if (r.status === 429) { last = new Error("The API rate limit was reached."); continue; }
      if (!r.ok) { last = new Error(`The API returned an error (${r.status}).`); continue; }
      const j = await r.json();
      if (Array.isArray(j)) return j;
      last = new Error("Unexpected API response.");
    } catch {
      last = new Error("Could not reach the API (network, CORS or rate limit).");
    }
  }
  throw last;
}

// Offline sample in the same shape as the API.
// Only used when both the API and the saved copy are unavailable.
function demoRaw() {
  // Small seeded random generator so the sample is always the same
  let s = 11;
  const R = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const sp = [
    ["Castor bean tick", "Ixodes ricinus"],
    ["Hedgehog tick", "Ixodes hexagonus"],
    ["Ornate dog tick", "Dermacentor reticulatus"],
    ["Southern rodent tick", "Ixodes acuminatus"],
    ["Fox/badger tick", "Ixodes canisuga"],
  ];
  const cs = ["London", "Manchester", "Birmingham", "Edinburgh", "Glasgow", "Bristol", "Cardiff", "Leeds", "Bournemouth", "Exeter", "Newcastle", "Inverness"];
  const end = new Date("2025-08-30T12:00:00").getTime();
  const out = [];
  while (out.length < 600) {
    const t = end - R() * 365 * DAY;
    const m = new Date(t).getMonth();
    if (R() < 0.6 && (m < 3 || m > 9)) continue; // fewer sightings in winter
    const [name, latin] = sp[Math.floor(R() ** 2 * sp.length)];
    out.push({
      id: "demo" + out.length,
      date: new Date(t).toISOString().slice(0, 19),
      location: cs[Math.floor(R() * cs.length)],
      species: name,
      latinName: latin,
    });
  }
  return out;
}

// Load order: live API (3 tries) -> saved copy -> offline sample
async function loadSightings(onWait = () => {}) {
  let err;
  for (const [i, delay] of [0, 3000, 8000].entries()) {
    if (delay) {
      onWait(`API busy, retrying (${i + 1}/3)…`);
      await wait(delay);
    }
    try {
      const raw = await fetchRaw();
      try { localStorage.setItem("tw_cache", JSON.stringify(raw)); } catch { /* storage full */ }
      return build(raw, "live");
    } catch (e) {
      err = e;
    }
  }
  const cached = localStorage.getItem("tw_cache");
  if (cached) return build(JSON.parse(cached), "cached", err.message);
  return build(demoRaw(), "demo", err.message);
}

// User-submitted reports are kept in localStorage
const loadMine = () => JSON.parse(localStorage.getItem("tw_reports") || "[]");
const saveMine = (a) => localStorage.setItem("tw_reports", JSON.stringify(a));

// Map tiles: CARTO needs a key (set in config.js), otherwise use OpenStreetMap
const CARTO_KEY = (window.TICKWATCH_CONFIG || {}).cartoKey;
const TILE = CARTO_KEY
  ? `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(CARTO_KEY)}`
  : "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTR = CARTO_KEY ? "© OpenStreetMap contributors © CARTO" : "© OpenStreetMap contributors";

const SEV = { Low: "var(--low)", Medium: "var(--med)", High: "var(--high)" }; // severity colours
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const noMotion = () => document.documentElement.classList.contains("a11y-motion"); // animations paused?
const fmt = (t) => new Date(t).toLocaleDateString("en-GB");
const abbr = (l = "") => l.split(" ").map((w) => w[0]).join("").slice(0, 2); // "Ixodes ricinus" -> "IR"

// Animates a number counting up to v
function useCount(v) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (noMotion()) { setN(v); return; }
    let raf, t0;
    const frame = (t) => {
      t0 ??= t;
      const p = Math.min(1, (t - t0) / 900); // progress 0 -> 1 over 900ms
      setN(Math.round(v * (1 - (1 - p) ** 3))); // ease-out
      if (p < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [v]);
  return n;
}

const Stat = ({ v, label }) => (
  <div className="stat"><b>{useCount(v)}</b><span>{label}</span></div>
);

function MapView({ items, onSelect, selected }) {
  const el = useRef(), map = useRef(), grp = useRef();
  const [ready, setReady] = useState(false);

  // Create the map and marker cluster group once
  useEffect(() => {
    let dead = false;
    map.current = L.map(el.current).setView([54.3, -2.5], 6);
    L.tileLayer(TILE, { attribution: ATTR, maxZoom: 18 }).addTo(map.current);
    (async () => {
      let g;
      try {
        g = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 45 });
      } catch (e) {
        console.warn("Marker clustering unavailable, using plain markers", e);
        g = L.layerGroup();
      }
      if (dead) return;
      grp.current = g;
      map.current.addLayer(g);
      setReady(true);
    })();
    return () => { dead = true; map.current.remove(); };
  }, []);

  // Redraw markers whenever the filtered items change
  useEffect(() => {
    if (!ready) return;
    grp.current.clearLayers();
    const markers = items.map((s) => {
      const recent = NOW - s.date < 14 * DAY;
      const icon = L.divIcon({
        className: "",
        iconSize: [26, 26],
        html: `<div class="mk ${recent ? "recent" : ""}" style="background:${SEV[s.sev]}">${abbr(s.latin)}</div>`,
      });
      return L.marker([s.lat, s.lng], { icon, title: `${s.city} · ${s.species} · ${s.sev}` })
        .on("click", () => onSelect(s));
    });
    grp.current.addLayers ? grp.current.addLayers(markers) : markers.forEach((m) => grp.current.addLayer(m));
  }, [items, ready]);

  // Zoom to the selected sighting
  useEffect(() => {
    if (!selected) return;
    const pos = [selected.lat, selected.lng];
    if (noMotion()) map.current.setView(pos, 11, { animate: false });
    else map.current.flyTo(pos, 11, { duration: 1.2 });
  }, [selected]);

  return (
    <div style={{ position: "relative" }}>
      <div id="map" ref={el} role="application" aria-label="Map of tick sightings" />
      <div className="legend">
        {Object.keys(SEV).map((k) => <span key={k}><i className="dot" style={{ background: SEV[k] }} />{k}</span>)}
        <span>Pulsing = last 14 days · Letters = species</span>
      </div>
    </div>
  );
}

function Sidebar({ s, all, onClose, onReport }) {
  const closeRef = useRef();
  const [toast, setToast] = useState("");

  // Focus the close button and let Escape close the panel
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s]);

  // Latest 8 sightings in the same city
  const near = s ? all.filter((x) => x.city === s.city).sort((a, b) => b.date - a.date).slice(0, 8) : [];

  // Use the native share sheet, or copy the link instead
  const share = async () => {
    const text = `${s.species} (${s.latin}) tick sighting in ${s.city} on TickWatch UK`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "TickWatch UK", text, url: location.href });
      } else {
        await navigator.clipboard.writeText(`${text} ${location.href}`);
        setToast("Link copied");
        setTimeout(() => setToast(""), 2000);
      }
    } catch { /* cancelled */ }
  };

  return (
    <aside className={s ? "open" : ""} aria-hidden={!s} aria-label="Sighting details">
      {s && <>
        <button ref={closeRef} className="btn ghost" onClick={onClose}>Close</button>
        <h2 style={{ margin: "16px 0 4px" }}>{s.city}</h2>
        <span className="sp" style={{ marginLeft: 0 }}>{s.latin}</span>
        <span className="tag" style={{ background: SEV[s.sev] }}>{s.sev} activity</span>
        <p><b>{s.species}</b><br />{info(s.latin)}</p>
        <p>
          Reported {new Date(s.date).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" })}.
          {s.notes && <><br />{s.notes}</>}
        </p>
        {s.img && <img src={s.img} alt="Submitted tick" style={{ maxWidth: "100%", borderRadius: 8 }} />}

        <div className="row">
          <button className="btn" onClick={() => onReport(s)}>Report a sighting</button>
          <a className="btn ghost" target="_blank" rel="noopener noreferrer"
            href={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`}>Get directions</a>
          <button className="btn ghost" onClick={share}>Share</button>
        </div>
        {toast && <div className="msg ok" role="status">{toast}</div>}

        <h3>Recent activity in {s.city}</h3>
        <div className="tl">
          {near.map((x) => <div key={x.id} style={{ "--c": SEV[x.sev] }}><b>{fmt(x.date)}</b> · {x.species}</div>)}
        </div>
      </>}
    </aside>
  );
}

function Explore({ all, sp, selected, setSelected }) {
  const [f, setF] = useState({ days: 99999, sp: "", sev: "", rec: false });

  // Update one filter (works for selects and the checkbox)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  // Apply filters, newest first
  const view = useMemo(
    () =>
      all
        .filter((s) =>
          NOW - s.date <= (f.rec ? 14 : +f.days) * DAY &&
          (!f.sp || s.species === f.sp) &&
          (!f.sev || s.sev === f.sev)
        )
        .sort((a, b) => b.date - a.date),
    [all, f]
  );

  return (
    <div className="panel">
      <div className="filters" role="search" aria-label="Filters">
        <label>Date range
          <select value={f.days} onChange={set("days")}>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last year</option>
            <option value="99999">All time</option>
          </select>
        </label>
        <label>Species
          <select value={f.sp} onChange={set("sp")}>
            <option value="">Any</option>
            {sp.map((s) => <option key={s.name}>{s.name}</option>)}
          </select>
        </label>
        <label>Activity level
          <select value={f.sev} onChange={set("sev")}>
            <option value="">Any</option><option>Low</option><option>Medium</option><option>High</option>
          </select>
        </label>
        <label className="switch"><input type="checkbox" checked={f.rec} onChange={set("rec")} /> Recent only (14 days)</label>
      </div>

      <div className="layout">
        <MapView items={view} onSelect={setSelected} selected={selected} />
        <div>
          <h3 style={{ margin: "0 0 10px" }}>Results ({view.length})</h3>
          <div id="list">
            {/* Show the first 80 results only */}
            {view.slice(0, 80).map((s) => (
              <button key={s.id} className={"item" + (selected?.id === s.id ? " sel" : "")} onClick={() => setSelected(s)}>
                <b><i className="dot" style={{ background: SEV[s.sev] }} />{s.city}</b>
                {NOW - s.date < 14 * DAY && <span className="tag">Recent</span>}
                <span className="sp">{s.latin}</span>
                <small>{fmt(s.date)} · {s.species}</small>
              </button>
            ))}
            {!view.length && <p>No sightings match. Try widening the date range.</p>}
          </div>
          <p className="note">
            Activity level is derived from how many sightings were logged in the same city in the 30 days before each one. Pins sit at city centres.
          </p>
        </div>
      </div>
    </div>
  );
}

function Learn({ all, sp }) {
  const cities = useMemo(() => [...new Set(all.map((s) => s.city))].sort(), [all]);
  const years = useMemo(() => [...new Set(all.map((s) => new Date(s.date).getFullYear()))].sort().reverse(), [all]);
  const [city, setCity] = useState(cities.includes("London") ? "London" : cities[0]);
  const [year, setYear] = useState(years[0]);
  const cv = useRef();

  // Draw the monthly bar chart for the chosen city and year
  useEffect(() => {
    const monthly = Array(12).fill(0);
    all
      .filter((s) => s.city === city && new Date(s.date).getFullYear() === +year)
      .forEach((s) => monthly[new Date(s.date).getMonth()]++);

    const chart = new Chart(cv.current, {
      type: "bar",
      data: {
        labels: MONTHS,
        datasets: [{ label: `Sightings in ${city}, ${year}`, data: monthly, backgroundColor: "#0077c8", borderRadius: 6 }],
      },
      options: {
        animation: { duration: noMotion() ? 0 : 900 },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    });
    return () => chart.destroy();
  }, [all, city, year]);

  return (
    <div className="panel">
      <h2>Seasonal activity</h2>
      <div className="filters">
        <label>City
          <select value={city} onChange={(e) => setCity(e.target.value)}>
            {cities.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label>Year
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            {years.map((y) => <option key={y}>{y}</option>)}
          </select>
        </label>
      </div>
      <canvas ref={cv} height="90" role="img" aria-label={`Bar chart of monthly tick sightings in ${city} in ${year}`} />

      <h2>Species identification guide</h2>
      <div className="grid">
        {sp.map((s) => (
          <article className="card" key={s.name}>
            <h4>{s.name}</h4>
            <em>{s.latin}</em>
            <p>{info(s.latin)}</p>
            <small>{s.count} sightings recorded</small>
          </article>
        ))}
      </div>

      <h2>Prevention tips</h2>
      <ul className="tips">
        <li><b>Cover up:</b> wear long trousers tucked into socks on heathland, woods and long grass.</li>
        <li><b>Repel:</b> use tick repellent on skin and clothes, and a vet-recommended treatment on pets.</li>
        <li><b>Check daily:</b> look at skin folds, behind knees, groin, hairline, and your pet's ears, armpits and belly.</li>
        <li><b>Remove fast:</b> grip close to the skin with a tick remover and pull steadily. Clean the bite afterwards.</li>
        <li><b>Watch for symptoms:</b> a spreading red rash or flu-like illness in the weeks after a bite needs a GP visit.</li>
      </ul>
    </div>
  );
}

// Small map where the user clicks to place a pin
function PickMap({ value, onChange }) {
  const el = useRef(), map = useRef(), marker = useRef();

  // Create the map once
  useEffect(() => {
    map.current = L.map(el.current).setView([54.3, -2.5], 5);
    L.tileLayer(TILE, { attribution: ATTR }).addTo(map.current);
    map.current.on("click", (e) => onChange([e.latlng.lat, e.latlng.lng]));
    return () => map.current.remove();
  }, []);

  // Move the pin when the position changes
  useEffect(() => {
    if (!value) return;
    marker.current ? marker.current.setLatLng(value) : (marker.current = L.marker(value).addTo(map.current));
    map.current.setView(value, 9);
  }, [value]);

  return <div id="pick" ref={el} role="application" aria-label="Pick the sighting location on the map" />;
}

function Report({ onAdd, preset, sp }) {
  const cityNames = useMemo(() => Object.keys(CITIES).filter((c) => c !== "__UK").sort(), []);
  const [v, setV] = useState({ date: "", time: "", city: preset?.city || "London", species: "", sev: "Low", notes: "" });
  const [pos, setPos] = useState(preset ? [preset.lat, preset.lng] : null);
  const [file, setFile] = useState(null);
  const [err, setErr] = useState({});
  const [msgs, setMsgs] = useState([]);

  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  const submit = (e) => {
    e.preventDefault();

    // Validate fields
    const x = {};
    if (!v.date) x.date = "Choose the date you found the tick.";
    else if (new Date(v.date) > new Date()) x.date = "Date can't be in the future.";
    if (!v.time) x.time = "Add an approximate time.";
    if (!v.species) x.species = "Select a species, or 'Not sure'.";
    if (!pos) x.loc = "Click the map to mark where you found it.";
    if (file && !file.type.startsWith("image/")) x.img = "File must be an image.";
    else if (file && file.size > 3e6) x.img = "Image is over 3 MB. Choose a smaller photo.";
    setErr(x);
    if (Object.keys(x).length) return setMsgs([["err", "Please fix the highlighted fields and submit again."]]);

    // Non-blocking warnings
    const m = [];
    if (!file) m.push(["warn", "No photo added. Photos help others identify the species."]);
    if (v.species === "Not sure") m.push(["warn", "Species saved as unidentified. Add a photo next time to help identify it."]);

    // Save the report and reset the form
    const found = sp.find((s) => s.name === v.species);
    const done = (img) => {
      onAdd({
        id: "u" + Date.now(),
        lat: pos[0],
        lng: pos[1],
        city: v.city,
        species: found?.name || "Unidentified tick",
        latin: found?.latin || "Unknown",
        sev: v.sev,
        date: new Date(`${v.date}T${v.time}`).getTime(),
        notes: v.notes,
        img,
        mine: true,
      });
      setMsgs([...m, ["ok", "Thank you! Your sighting is saved and now on the map."]]);
      setV({ ...v, date: "", time: "", species: "", notes: "" });
      setPos(null);
      setFile(null);
    };

    // Convert the photo to a data URL so it can be stored
    if (file) {
      const reader = new FileReader();
      reader.onload = () => done(reader.result);
      reader.readAsDataURL(file);
    } else {
      done(null);
    }
  };

  // Inline field error
  const E = ({ k }) => <span className="fe" role={err[k] ? "alert" : undefined}>{err[k]}</span>;

  return (
    <div className="panel">
      <h2>Report a sighting</h2>
      <form onSubmit={submit} noValidate>
        <label>Date
          <input type="date" max={new Date().toISOString().slice(0, 10)} value={v.date} onChange={set("date")} />
          <E k="date" />
        </label>
        <label>Time
          <input type="time" value={v.time} onChange={set("time")} />
          <E k="time" />
        </label>
        <label>City
          <select value={v.city} onChange={(e) => { setV({ ...v, city: e.target.value }); setPos(CITIES[e.target.value]); }}>
            {cityNames.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label>Species
          <select value={v.species} onChange={set("species")}>
            <option value="">Select…</option>
            {sp.map((s) => <option key={s.name}>{s.name}</option>)}
            <option>Not sure</option>
          </select>
          <E k="species" />
        </label>
        <label>Activity level
          <select value={v.sev} onChange={set("sev")}><option>Low</option><option>Medium</option><option>High</option></select>
        </label>
        <label>Photo (max 3 MB)
          <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files[0] || null)} />
          <E k="img" />
          {preview && <img id="prev" src={preview} alt="Preview of your photo" />}
        </label>
        <div className="full">
          <b style={{ fontSize: ".78rem" }}>Location: click the map to place the pin</b>
          <PickMap value={pos} onChange={setPos} />
          <E k="loc" />
        </div>
        <label className="full">Notes
          <textarea rows="3" maxLength="300" value={v.notes} onChange={set("notes")} />
        </label>
        <div className="full">
          <button className="btn" type="submit">Submit sighting</button>{" "}
          <button type="button" className="btn ghost"
            onClick={() => navigator.geolocation?.getCurrentPosition(
              (p) => setPos([p.coords.latitude, p.coords.longitude]),
              () => setErr({ loc: "Location blocked. Click the map instead." })
            )}>
            Use my location
          </button>
          <div aria-live="assertive">{msgs.map(([c, t]) => <div key={t} className={"msg " + c}>{t}</div>)}</div>
        </div>
      </form>
    </div>
  );
}

// Settings are saved in localStorage ("tw_a11y") and applied as a11y-* classes on <html>.
// splash.js re-applies them before first paint to avoid a flash of the default style.
const A11Y_KEY = "tw_a11y";
const SIZES = [100, 112, 125, 150, 175]; // text size steps (%)
const A11Y_DEFAULT = { size: 0, contrast: false, gray: false, dys: false, lines: false, letters: false, links: false, focus: false, cursor: false, motion: false };

// [key, label, description]
const A11Y_SWITCHES = [
  ["contrast", "High contrast", "Black and yellow for maximum legibility"],
  ["gray", "Greyscale", "Removes all colour from the page"],
  ["dys", "Readable font", "Atkinson Hyperlegible, designed for low vision"],
  ["lines", "Line spacing", "More space between lines of text"],
  ["letters", "Letter spacing", "More space between letters and words"],
  ["links", "Highlight links", "Makes every link stand out"],
  ["focus", "Strong focus ring", "Thick outline on the item you tab to"],
  ["cursor", "Large cursor", "Bigger mouse pointer"],
  ["motion", "Pause animations", "Stops movement, intro and map fly-to"],
];

// Load saved settings, or default to reduced motion if the system asks for it
const loadA11y = () => {
  try {
    const raw = localStorage.getItem(A11Y_KEY);
    if (raw) return { ...A11Y_DEFAULT, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...A11Y_DEFAULT, motion: !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) };
};

// Apply settings to the <html> element
const applyA11y = (p) => {
  const h = document.documentElement;
  Object.keys(A11Y_DEFAULT).forEach((k) => k !== "size" && h.classList.toggle("a11y-" + k, !!p[k]));
  h.style.fontSize = SIZES[p.size] + "%";
};

function A11yPanel() {
  const [p, setP] = useState(loadA11y);
  const [open, setOpen] = useState(false);
  const [say, setSay] = useState(""); // screen reader announcement
  const [speaking, setSpeaking] = useState(false);
  const btn = useRef(), box = useRef();
  const synth = window.speechSynthesis;

  // Apply and save settings whenever they change
  useEffect(() => {
    applyA11y(p);
    try { localStorage.setItem(A11Y_KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
  }, [p]);

  // While open: focus the panel, close on Escape or outside click
  useEffect(() => {
    if (!open) return;
    box.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    const onOutside = (e) => {
      if (!box.current?.contains(e.target) && !btn.current?.contains(e.target)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onOutside);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onOutside);
    };
  }, [open]);

  // Stop speech when the panel unmounts
  useEffect(() => () => synth?.cancel(), []);

  const toggle = (k, label) => {
    const v = !p[k];
    setP({ ...p, [k]: v });
    setSay(`${label} ${v ? "on" : "off"}`);
  };

  const resize = (d) => {
    const n = Math.min(SIZES.length - 1, Math.max(0, p.size + d));
    setP({ ...p, size: n });
    setSay(`Text size ${SIZES[n]} percent`);
  };

  const reset = () => {
    synth?.cancel();
    setSpeaking(false);
    setP({ ...A11Y_DEFAULT });
    setSay("All accessibility settings reset to default");
  };

  // Read the selected text, or the page if nothing is selected
  const read = () => {
    if (!synth) { setSay("Read aloud is not supported in this browser"); return; }
    if (speaking || synth.speaking) { synth.cancel(); setSpeaking(false); setSay("Stopped reading"); return; }

    const sel = String(window.getSelection()).trim();
    const pick = (q) => document.querySelector(q)?.innerText || "";
    const text = (sel || [pick(".hero h2"), pick(".hero p"), pick("#content")].join(". ")).replace(/\s+/g, " ").slice(0, 3000);

    // Speak sentence by sentence
    const parts = text.match(/[^.!?]+[.!?]*\s*/g) || [text];
    parts.forEach((t, i) => {
      const u = new SpeechSynthesisUtterance(t);
      u.lang = "en-GB";
      if (i === parts.length - 1) u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      synth.speak(u);
    });
    setSpeaking(true);
    setSay(sel ? "Reading selected text" : "Reading the page");
  };

  return (
    <>
      {/* Floating button */}
      <button ref={btn} className="a11y-fab" aria-label="Accessibility options" aria-expanded={open} aria-controls="a11y-panel" onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="4.2" r="2.2" /><path d="M4 8.2c0-.6.5-1 1-1h14c.6 0 1 .5 1 1s-.5 1-1 1h-5v4.2l2.3 6.6c.2.6-.1 1.2-.7 1.4-.6.2-1.2-.1-1.4-.7L12 15.4l-1.2 4.3c-.2.6-.8.9-1.4.7-.6-.2-.9-.8-.7-1.4L11 13.4V9.2H6c-.6 0-1-.5-1-1Z" /></svg>
      </button>

      {/* Panel */}
      <div id="a11y-panel" ref={box} className="a11y-panel" role="dialog" aria-label="Accessibility options" tabIndex={-1} hidden={!open}>
        <div className="a11y-head">
          <h2>Accessibility</h2>
          <button className="btn ghost" onClick={() => { setOpen(false); btn.current?.focus(); }}>Close</button>
        </div>

        <div className="a11y-size" role="group" aria-label="Text size">
          <span>Text size</span>
          <button className="btn ghost" aria-label="Decrease text size" disabled={p.size === 0} onClick={() => resize(-1)}>A−</button>
          <output>{SIZES[p.size]}%</output>
          <button className="btn ghost" aria-label="Increase text size" disabled={p.size === SIZES.length - 1} onClick={() => resize(1)}>A+</button>
        </div>

        <div className="a11y-grid">
          {A11Y_SWITCHES.map(([k, label, desc]) => (
            <button key={k} role="switch" aria-checked={!!p[k]} className="a11y-sw" onClick={() => toggle(k, label)}>
              <b>{label}</b><small>{desc}</small><i aria-hidden="true">{p[k] ? "On" : "Off"}</i>
            </button>
          ))}
        </div>

        <div className="row">
          <button className="btn" onClick={read} aria-pressed={speaking}>{speaking ? "Stop reading" : "Read aloud"}</button>
          <button className="btn ghost" onClick={reset}>Reset all</button>
        </div>
        <p className="note">Read aloud reads any text you have selected, or the page if nothing is selected. Your choices are saved on this device.</p>
        <div className="sr-only" role="status" aria-live="polite">{say}</div>
      </div>
    </>
  );
}

function App() {
  const [tab, setTab] = useState("map");
  const [all, setAll] = useState([]);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState("");
  const [sel, setSel] = useState(null); // selected sighting
  const [preset, setPreset] = useState(null); // sighting used to prefill the report form
  const [busy, setBusy] = useState(true);
  const [waitMsg, setWaitMsg] = useState("");

  // Load API data plus the user's saved reports
  const load = () => {
    setBusy(true);
    setError("");
    loadSightings(setWaitMsg)
      .then((r) => { setAll([...r.data, ...loadMine()]); setMeta(r); })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };
  useEffect(load, []);

  // Unique species with counts, most common first
  const sp = useMemo(() => {
    const m = {};
    all.forEach((s) => {
      m[s.species] ||= { name: s.species, latin: s.latin, count: 0 };
      m[s.species].count++;
    });
    return Object.values(m).filter((s) => s.latin !== "Unknown").sort((a, b) => b.count - a.count);
  }, [all]);

  const mine = all.filter((s) => s.mine).length;
  const tabs = [["map", "Map"], ["learn", "Learn"], ["report", "Report a sighting"]];

  // Data source badge text
  const badge = busy
    ? waitMsg || "Loading sightings…"
    : error
      ? "API unavailable"
      : meta.mode === "live"
        ? `Live Elanco API · ${all.length - mine} records`
        : meta.mode === "cached"
          ? `Saved copy of API data · ${meta.note}`
          : `Offline sample data · ${meta.note}`;

  return (
    <>
      <a className="skip" href="#content">Skip to content</a>

      <header>
        <img src="logo.png" alt="Elanco" />
        <h1>TickWatch UK</h1>
        <nav role="tablist" aria-label="Sections">
          {tabs.map(([k, t]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{t}</button>)}
        </nav>
      </header>

      <div className="hero">
        <h2>Spot ticks before they spot you.</h2>
        <p>A community map of tick sightings across the UK. Check risk near you, learn to identify species, and report what you find to protect pets and people.</p>
        <div className="stats" aria-live="polite">
          <Stat v={all.length} label="sightings recorded" />
          <Stat v={all.filter((s) => NOW - s.date < 14 * DAY).length} label="in the latest 14 days" />
          <Stat v={all.filter((s) => s.sev === "High").length} label="high-activity" />
          <Stat v={mine} label="your reports" />
        </div>
        <span className="badge" role="status">{badge}</span>
        {!busy && meta?.mode !== "live" && (
          <button className="btn ghost" style={{ marginLeft: 8, padding: "5px 12px" }} onClick={load}>Retry live API</button>
        )}
      </div>

      <main id="content">
        {error && (
          <div className="panel">
            <div className="msg err" role="alert">{error}</div>
            <button className="btn" onClick={load}>Retry</button>
          </div>
        )}
        {!error && !busy && tab === "map" && <Explore all={all} sp={sp} selected={sel} setSelected={setSel} />}
        {!error && !busy && tab === "learn" && <Learn all={all} sp={sp} />}
        {!error && !busy && tab === "report" && (
          <Report
            sp={sp}
            preset={preset}
            onAdd={(s) => { saveMine([...loadMine(), s]); setAll((a) => [s, ...a]); }}
          />
        )}
      </main>

      <Sidebar
        s={sel}
        all={all}
        onClose={() => setSel(null)}
        onReport={(s) => { setPreset(s); setSel(null); setTab("report"); }}
      />

      <footer>
        <p className="foot-t"><b>TickWatch UK</b> · Built by <b>Mohammed Zuoriki</b> for the Elanco Placement Programme</p>
        <div className="social" role="group" aria-label="Developer profiles">
          <a href="https://github.com/Code-tech77" target="_blank" rel="noopener noreferrer" aria-label="GitHub profile of Mohammed Zuoriki (opens in a new tab)">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>
            <span>GitHub</span>
          </a>
          <a href="https://www.linkedin.com/in/mohammed-zuoriki-856133250/" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn profile of Mohammed Zuoriki (opens in a new tab)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" /></svg>
            <span>LinkedIn</span>
          </a>
        </div>
        <small>Elanco and its logo are trademarks of Elanco or its affiliates, used here for this application task only.</small>
      </footer>

      <A11yPanel />
    </>
  );
}

// Shows the error on screen instead of a blank page
class Boundary extends Component {
  state = { err: null };
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    return this.state.err ? (
      <div style={{ padding: 32, fontFamily: "sans-serif" }}>
        <h2>Something went wrong</h2>
        <pre style={{ whiteSpace: "pre-wrap", color: "#a3122a" }}>{String(this.state.err.stack || this.state.err)}</pre>
        <button onClick={() => location.reload()}>Reload</button>
      </div>
    ) : this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(<Boundary><App /></Boundary>);
