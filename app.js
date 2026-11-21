import {
  FAMILIES, PHASES, ISOTOPE_FIELDS, defaults, readState, stateParams, limit, parseRows, indexFacts,
  selectedFact, scalar, temperatureIn, toKelvin, displayUnit, convertValue, phaseFor,
  tableCells, formatNumber, formatFact, searchElements, colorFraction, expandConfiguration, electronShells,
  configurationText, formulaText, isotopeValue, predictionBaseline,
} from "./model.js";
import { bindOrbital } from "./orbitals.js";
import { readMix, encodeMix, findCompounds, searchPubChem } from "./compounds.js";

const byId = id => document.getElementById(id);
const escaped = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);

function external(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

const option = (value, label) => `<option value="${escaped(value)}">${escaped(label)}</option>`;
const link = (href, label) => `<a href="${escaped(external(href))}" target="_blank" rel="noopener noreferrer">${escaped(label)}</a>`;
const PHASE_NOTE = "Approximate phases at 1 atm. Transitions depend on pressure and material form.";
const TEMP_FIELDS = new Map([["celsius", "°C"], ["fahrenheit", "°F"], ["kelvin", "K"]]);
const PROPERTIES = [["family", "Element family"], ["phase", "Phase at temperature"]];
const COLOR_KEYS = ["low", "high", "zero", "missing"];

let state = initialState();
let catalog, elements, rows, facts, byZ, symbols, properties, numericProperties, compounds, shellsByZ;
let nuclides, isotopeRequest, remoteRequest, remoteMatches;
let filters, colorWindow, mapData, chosenIsotope, summaryFocus;
let noticeTimer;

function initialState() {
  const params = new URLSearchParams(location.search);
  if (!params.has("theme")) {
    try {
      const theme = localStorage.getItem("unfinished-theme");
      if (theme) params.set("theme", theme);
    } catch {
      // Shared links work even when browser storage is disabled.
    }
  }
  return readState(params);
}

function urlFor(patch = {}) {
  const url = new URL(location.href);
  url.search = stateParams({ ...state, ...patch }).toString();
  url.hash = "";
  return url.href;
}

function change(patch, historyStep = false) {
  state = readState(stateParams({ ...state, ...patch }));
  const url = urlFor();
  if (url !== location.href) {
    if (historyStep) history.pushState(null, "", url);
    else history.replaceState(null, "", url);
  }
  render();
}

async function fetchData(path, type = "json") {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Unable to load ${path} (HTTP ${response.status})`);
  if (type !== "rows") return response.json();
  const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
  return parseRows(await new Response(stream).text());
}

function ensureIsotopes() {
  if (nuclides || isotopeRequest) return;
  isotopeRequest = fetchData("data/isotopes.ndjson.gz", "rows").then(data => {
    nuclides = Map.groupBy(data, row => row.z);
    render();
  }).catch(() => {
    nuclides = new Map();
    render();
  });
}

function unitOf(property) {
  return displayUnit(property, properties.get(property), state);
}

function factOf(z, property) {
  return selectedFact(facts, z, property, state.ion);
}

function familyColor(family) {
  const idx = FAMILIES.indexOf(family);
  return idx >= 0 ? `var(--category-${idx})` : "var(--category-neutral)";
}

function phaseOf(z) {
  return phaseFor(z, state.temp, catalog.phases);
}

function phaseLine(z) {
  const form = catalog.phases[z]?.form;
  return phaseOf(z) + (form ? ` · ${form}` : "");
}

function labelFor(property) {
  const base = properties.get(property)?.label ?? new Map(PROPERTIES).get(property) ?? property;
  return property === "ionization" ? `${base} · step ${state.ion}` : base;
}

function formatTemperature(kelvin, unit) {
  return String(Number(temperatureIn(kelvin, unit).toFixed(2)));
}

function formatYear(year) {
  if (year === undefined) return "??";
  return year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`;
}

function colorSetting(key) {
  return `var(--scale-${key})`;
}

function syncField(id, value) {
  const element = byId(id);
  if (document.activeElement !== element) element.value = value;
}

function metricOf(element) {
  const { z } = element;
  if (state.view === "electrons") {
    if (state.electron === "oxidation") return factOf(z, "oxidation")?.value;
    if (state.electron === "shells") return electronShells(shellsByZ.get(z));
    return null;
  }
  if (state.view === "isotopes") {
    const isotope = (nuclides?.get(z) ?? []).find(row => row.a === chosenIsotope?.a && row.z === chosenIsotope?.z);
    return isotope ? isotopeValue(isotope, state.nuclide) : nuclides?.get(z)?.length;
  }
  const property = ["family", "phase"].includes(state.property) ? "weight" : state.property;
  const value = factOf(z, property)?.value;
  return Array.isArray(value) ? value.map(item => convertValue(property, item, state)) : convertValue(property, value, state);
}

function inHistory(z) {
  if (state.property !== "discovery" || state.year === defaults.year || state.view !== "properties") return true;
  const year = factOf(z, "discovery")?.value;
  return Number.isFinite(year) && year <= state.year;
}

function getMix() {
  return readMix(state.mix, symbols);
}

function visibleCompounds() {
  if (remoteMatches !== undefined) return remoteMatches;
  return findCompounds(compounds, state.compound, getMix(), state.exact, symbols);
}

function renderControls() {
  document.documentElement.dataset.theme = state.theme;
  byId("theme").textContent = state.theme === "dark" ? "Light mode" : "Dark mode";
  byId("theme").setAttribute("aria-pressed", state.theme === "dark");
  for (const tab of byId("views").querySelectorAll("button")) {
    if (tab.dataset.view === state.view && !state.detail) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  }
  byId("compact").setAttribute("aria-pressed", !state.wide);
  byId("wide").setAttribute("aria-pressed", state.wide);
  byId("gaps").checked = state.gaps;
  byId("exact").checked = state.exact;
  byId("allNuclides").checked = state.allNuclides;
  for (const key of ["panel", "labels", "scale", "property", "ion", "electron", "nuclide", "x", "y", "compound"]) {
    syncField(key, state[key]);
  }
  syncField("search", state.query);
  byId("search").placeholder = state.view === "properties" && !["family", "phase"].includes(state.property)
    ? "Name, Z, or a range" : "Search name, symbol, or Z";
  for (const key of COLOR_KEYS) {
    const name = `--scale-${key}`;
    if (state[key]) document.documentElement.style.setProperty(name, state[key]);
    else document.documentElement.style.removeProperty(name);
    syncField(key, getComputedStyle(document.documentElement).getPropertyValue(name).trim());
  }
  byId("explorer").classList.toggle("beside", state.panel === "side");
  byId("controls").hidden = state.panel === "hidden";
  for (const [view, id] of Object.entries({
    properties: "property-controls", electrons: "electron-controls", isotopes: "isotope-controls",
    compounds: "compound-controls", compare: "compare-controls",
  })) byId(id).hidden = state.view !== view;

  const temperature = ["melting", "boiling", "sublimation"].includes(state.property);
  const energy = ["ionization", "affinity"].includes(state.property);
  const density = ["density", "density-pubchem", "liquid-density"].includes(state.property);
  const choices = temperature ? ["K", "°C", "°F"] : energy ? ["eV", "kJ/mol"] : density ? ["g/cm³", "kg/m³"] : [];
  byId("unit-label").hidden = !choices.length;
  if (byId("unit").dataset.options !== choices.join("/")) {
    byId("unit").innerHTML = choices.map(unit => option(unit, unit)).join("");
    byId("unit").dataset.options = choices.join("/");
  }
  syncField("unit", unitOf(state.property));
  byId("ion-label").hidden = state.property !== "ionization";
  byId("timeline").hidden = state.property !== "discovery";
  byId("temperature").hidden = state.property === "discovery";
  syncField("temp-range", state.temp);
  for (const [id, unit] of TEMP_FIELDS) syncField(id, formatTemperature(state.temp, unit));
  syncField("year-range", state.year);
  syncField("year-input", state.year);
  byId("year-era").textContent = state.year < 0 ? "BCE" : "CE";
  if (state.view === "compounds") renderMix();
}

function renderMix() {
  const holder = byId("mix");
  const mix = getMix();
  if (holder.dataset.mix === state.mix) return;
  holder.dataset.mix = state.mix;
  holder.innerHTML = [...mix].map(([symbol, count]) => `<div class="mix-item"><strong>${escaped(symbol)}</strong>
    <input type="number" min="1" max="99" aria-label="${escaped(symbol)} atom count" data-amount="${escaped(symbol)}" value="${count}">
    <button type="button" data-remove="${escaped(symbol)}" aria-label="Remove ${escaped(symbol)}">×</button></div>`).join("");
}

function computeMap() {
  filters = searchElements(state.query, elements, metricOf);
  const propertyMap = state.view === "properties" && !["family", "phase"].includes(state.property);
  const values = propertyMap ? elements.flatMap(element => {
    const number = scalar(factOf(element.z, state.property)?.value);
    return number === null ? [] : [convertValue(state.property, number, state)];
  }).filter(value => state.scale !== "log" || value > 0) : [];
  colorWindow = values.length ? { min: Math.min(...values), max: Math.max(...values) } : null;
  const compoundCounts = new Map();
  if (state.view === "compounds") {
    for (const compound of visibleCompounds()) {
      const symbolsInFormula = new Set(compound.formula.match(/[A-Z][a-z]?/g));
      for (const symbol of symbolsInFormula) compoundCounts.set(symbol, (compoundCounts.get(symbol) ?? 0) + 1);
    }
  }
  mapData = { propertyMap, compoundCounts, mix: getMix() };
}

function measurementColor(value) {
  const scaleMissing = colorSetting("missing");
  if (!colorWindow) return scaleMissing;
  if (value === 0 && state.scale === "linear") return colorSetting("zero");
  const fraction = colorFraction(value, colorWindow.min, colorWindow.max, state.scale === "log");
  if (fraction === null) return scaleMissing;
  return `color-mix(in srgb, ${colorSetting("low")} ${(100 - fraction * 100).toFixed(1)}%, ${colorSetting("high")})`;
}

function configFor(z) {
  return factOf(z, "configuration")?.value;
}

function electronLabel(z) {
  const subshells = shellsByZ.get(z);
  if (state.electron === "oxidation") return formatFact(factOf(z, "oxidation"), state);
  if (state.electron === "configuration") return configFor(z) ?? "??";
  if (state.electron === "expanded") return configurationText(subshells) || "??";
  if (state.electron === "shells") return electronShells(subshells).join(" · ") || "??";
  if (state.electron === "block") return byZ.get(z).block + " block";
  const orbital = subshells.at(-1);
  return orbital ? `n ${orbital.n} · ℓ ${orbital.l}` : "??";
}

function tile(element, row, col) {
  const { z, symbol, name, weightLabel, family } = element;
  const phase = phaseOf(z);
  const fact = factOf(z, state.property);
  const departure = !inHistory(z) || (filters && !filters.has(z)) || (state.family && state.family !== family)
    || (state.phase && state.view === "properties" && phase !== state.phase);
  const matches = mapData.compoundCounts.get(symbol);
  const compoundMuted = state.view === "compounds" && (state.compound || state.mix || remoteMatches !== undefined) && !matches;
  const fill = mapData.propertyMap ? measurementColor(scalar(fact?.value) === null ? null
    : convertValue(state.property, scalar(fact.value), state)) : familyColor(family);
  let value = weightLabel;
  let secondary = "";
  if (state.view === "properties") {
    if (state.property === "phase") value = phase === "Unknown" ? "??" : phase;
    else if (state.property === "discovery") value = formatYear(fact?.value);
    else if (mapData.propertyMap) value = formatFact(fact, state, 4);
  } else if (state.view === "electrons") {
    value = electronLabel(z);
  } else if (state.view === "isotopes") {
    const available = (nuclides?.get(z) ?? []).filter(item => state.allNuclides || item.stable).length;
    value = nuclides ? `${available} isotopes` : "…";
  } else if (state.view === "compounds") {
    value = `${matches ?? 0} matches`;
    if (mapData.mix.has(symbol)) secondary = " · selected";
  }
  if (state.labels === "configuration" && state.view === "properties" && state.property === "family") value = configFor(z) ?? "??";
  const text = `${name}, atomic number ${z}, ${value}${secondary}`;
  const selected = state.view === "compounds" ? mapData.mix.has(symbol) : state.element === z;
  return `<button type="button" data-z="${z}" data-row="${row}" data-col="${col}" class="tile${departure || compoundMuted ? " is-muted" : ""}${selected ? " is-selected" : ""}"
    style="grid-area:${row + 1}/${col + 1};--tile-fill:${fill}" aria-label="${escaped(text)}" title="${escaped(text)}"
    ${state.view === "properties" && !mapData.propertyMap ? `data-phase="${phase}"` : ""}>
    <span class="tile-number">${z}</span><span class="symbol">${escaped(symbol)}</span>
    ${state.labels === "full" ? `<span class="tile-name">${escaped(name)}</span>` : ""}
    <span class="tile-value">${escaped(value)}</span></button>`;
}

function renderGrid() {
  const grid = byId("grid");
  const width = state.wide ? 32 : 18;
  const height = state.wide ? (state.gaps ? 8 : 7) : 10;
  const all = tableCells(elements, catalog.candidates, state.wide, state.gaps);
  grid.dataset.wide = state.wide;
  grid.dataset.gaps = state.gaps;
  grid.dataset.labels = state.labels;
  grid.style.setProperty("--columns", width);
  grid.style.setProperty("--rows", height);
  const headers = Array.from({ length: 18 }, (_, index) => {
    const group = index + 1;
    const col = state.wide && group >= 3 ? group + 14 : group;
    return `<span class="axis" style="grid-area:1/${col + 1}" title="Group ${group}">${group}</span>`;
  }).join("");
  const periods = Array.from({ length: state.gaps ? 8 : 7 }, (_, index) =>
    `<span class="axis" style="grid-area:${index + 2}/1" title="Period ${index + 1}">${index + 1}</span>`).join("");
  const ladder = state.wide ? "" : `<span class="series-label" style="grid-area:10/1/11/4">Lanthanides</span>
    <span class="series-label" style="grid-area:11/1/12/4">Actinides</span>`;
  grid.innerHTML = headers + periods + ladder + all.map(cell => {
    const { row, col, kind, candidate, element } = cell;
    const position = `data-row="${row}" data-col="${col}" style="grid-area:${row + 1}/${col + 1}"`;
    if (kind === "element") return tile(element, row, col);
    if (kind === "candidate") return `<button type="button" class="tile tile--candidate" data-z="${candidate.z}" ${position}
      aria-label="Proposed element ${candidate.z}"><span class="tile-number">${candidate.z}</span><span class="symbol">??</span></button>`;
    if (kind === "series") return `<button type="button" class="tile tile--series" data-series="${row}" ${position}
      aria-label="Show ${row === 6 ? "lanthanides" : "actinides"} inline"><span>${row === 6 ? "57–71" : "89–103"}</span><span>Series</span></button>`;
    return `<button type="button" class="tile tile--gap" data-gap ${position} aria-label="${row === 8 ? "Unassigned proposed layout" : "Layout gap"}, displayed row ${row}, column ${col}">??</button>`;
  }).join("");
  const matching = elements.filter(element => (!filters || filters.has(element.z)) && inHistory(element.z)
    && (!state.family || state.family === element.family) && (!state.phase || state.view !== "properties" || phaseOf(element.z) === state.phase)).length;
  const legend = (state.gaps ? " · open cells visible" : "") + (state.wide ? " · 32 columns" : " · 18 columns");
  byId("map-status").textContent = (matching === elements.length ? `${matching} recognized elements` : `${matching} of ${elements.length} elements match`) + legend;
  byId("map-title").textContent = state.view === "properties" ? "Periodic table" : {
    electrons: "Electron structure", isotopes: "Isotope explorer", compounds: "Compound explorer",
  }[state.view];
}

function renderLegend() {
  const family = FAMILIES.map(label => `<button type="button" data-family="${escaped(label)}" aria-pressed="${state.family === label}">
    <span class="swatch" style="--swatch:${familyColor(label)}" aria-hidden="true"></span>${escaped(label)}</button>`).join("");
  const phases = PHASES.map(phase => `<button type="button" data-phase-filter="${phase}" aria-pressed="${state.phase === phase}">
    <span class="swatch" style="--swatch:var(--phase-${phase.toLowerCase()})" aria-hidden="true"></span>${phase}</button>`).join("");
  const gapKey = state.gaps ? `<span class="legend-note">Dashed ?? tiles are layout gaps. Tinted ?? tiles mark proposed elements.</span>` : "";
  const showPhases = state.view === "properties" && state.property === "phase";
  if (mapData.propertyMap) {
    const windowLabel = colorWindow ? `<span>${escaped(formatNumber(colorWindow.min, 4))}</span>
      <span class="scale-bar" style="background:linear-gradient(90deg,${colorSetting("low")},${colorSetting("high")})"></span>
      <span>${escaped(formatNumber(colorWindow.max, 4))}</span>` : "<span>No numeric values under this scale</span>";
    byId("legend").innerHTML = `<strong>${escaped(labelFor(state.property))}</strong>${windowLabel}
      <span>${escaped(unitOf(state.property))}</span><span class="legend-note">${state.scale === "log" ? "Log scale · positive values" : "Linear scale"} · ?? missing</span>${gapKey}`;
  } else {
    const explanation = showPhases ? `<span class="legend-note">${PHASE_NOTE}</span>` : "";
    byId("legend").innerHTML = (showPhases ? phases : family) + explanation + gapKey;
  }
}

function quickFacts(entries) {
  return `<dl class="facts-quick">${entries.map(([name, value]) =>
    `<div><dt>${escaped(name)}</dt><dd>${escaped(value)}</dd></div>`).join("")}</dl>`;
}

function heading(element) {
  return `<div class="card-heading"><div class="card-tile" style="--tile-fill:${familyColor(element.family)}" aria-hidden="true">
    <span>${element.z}</span><strong>${escaped(element.symbol)}</strong></div>
    <div><h2>${escaped(element.name)}</h2><p class="muted">${escaped(element.family)} · Period ${element.period}${element.group ? ` · Group ${element.group}` : ""}</p></div></div>`;
}

function photo(element) {
  const image = catalog.media[element.z];
  if (!image || !external(image.url)) return "";
  return `<figure class="element-photo"><img src="${escaped(external(image.url))}" alt="${escaped(image.caption)}" loading="lazy" referrerpolicy="no-referrer">
    <figcaption>${escaped(image.caption)} <details><summary>Photo credit</summary>${escaped(image.credit)} · ${link(image.url, "Image source")}</details></figcaption></figure>`;
}

function bindMedia(root) {
  for (const image of root.querySelectorAll(".element-photo img")) {
    image.addEventListener("error", () => { image.hidden = true; });
  }
}

function fromSource(id) {
  const source = catalog.sources[id];
  return source ? link(source[1], source[0]) : "—";
}

function baseFacts(element) {
  const { z } = element;
  const phase = phaseLine(z);
  const temp = formatTemperature(state.temp, "°C");
  const weight = element.weightLabel.startsWith("[") ? ["Reference isotope A", element.weightLabel] : ["Abridged atomic weight", element.weightLabel];
  return quickFacts([weight, [`Phase at ${temp} °C`, phase], ["Electron configuration", configFor(z) ?? "??"]]);
}

function isoFormat(row, key) {
  if (key === "seconds" && row.stable) return "Stable";
  if (key === "seconds" && row.halfLifeUnit) return `${formatNumber(row.halfLife)} ${row.halfLifeUnit}`;
  const value = isotopeValue(row, key);
  return formatNumber(value);
}

function decayColor(row) {
  if (row.stable) return "var(--phase-solid)";
  const value = isotopeValue(row, "decay") ?? "";
  if (value.startsWith("A")) return "var(--phase-gas)";
  if (value.startsWith("B")) return "var(--phase-liquid)";
  return "var(--line)";
}

function isotopeSection(z) {
  const element = byZ.get(z);
  if (!nuclides) return '<p role="status">Loading evaluated isotope records…</p>';
  const all = nuclides.get(z) ?? [];
  const list = all.filter(item => state.allNuclides || item.stable);
  if (!list.length) return `<p>${all.length ? "No stable isotopes are recorded. Include radioactive isotopes to see the series." : "Isotope records are unavailable."}</p>`;
  const current = list.find(item => chosenIsotope?.z === z && item.a === chosenIsotope.a) ?? list.find(item => item.stable) ?? list[0];
  const metric = ISOTOPE_FIELDS.find(([key]) => key === state.nuclide);
  const points = list.map(row => `<button type="button" data-isotope="${row.a}" data-for="${z}" aria-pressed="${current === row}" style="--decay:${decayColor(row)}">
    <span>${escaped(element.symbol)}-${row.a}</span><span class="nuclide-subtitle">${escaped(isoFormat(row, metric[0]))}</span></button>`).join("");
  const metrics = ISOTOPE_FIELDS.map(([key, label, unit]) => `<tr><th scope="row">${escaped(label)}</th><td>${escaped(isoFormat(current, key))}${unit && key !== "seconds" && isotopeValue(current, key) !== undefined ? " " + escaped(unit) : ""}</td></tr>`).join("");
  const decays = current.decays?.map(row => `${row.mode}${row.intensity != null ? ` ${row.relation ?? ""} ${formatNumber(row.intensity)}%` : ""}${row.unobserved ? " (unobserved)" : ""}`) ?? [];
  return `<h3>${escaped(element.name)} isotopes</h3><div class="nuclide-list" aria-label="Isotope cards">${points}</div>
    <h3>${escaped(element.symbol)}-${current.a}</h3>
    <div class="table-scroll"><table class="data-table"><tbody>${metrics}</tbody></table></div>
    ${decays.length ? `<p class="muted">Decay branches ${escaped(decays.join(" · "))}</p>` : ""}
    <p class="muted">Mass excess, binding energy, decay width, specific activity and magnetic moment use derived values where inputs exist. ${fromSource("mendeleev")}</p>`;
}

function orbitalSection(z) {
  const items = shellsByZ.get(z);
  if (!items.length) return "<p>Electron configuration is unavailable.</p>";
  const boxes = [...items].reverse().map(item => {
    const orbitals = 2 * item.l + 1;
    const electrons = Array.from({ length: orbitals }, (_, index) => item.count > index + orbitals ? "↑↓" : item.count > index ? "↑" : "·");
    return `<div class="orbit-row"><span class="orbit-sub">${item.n}${item.kind}</span>${electrons.map(pair => `<span class="orbit-box">${pair}</span>`).join("")}</div>`;
  }).join("");
  const count = electronShells(items).join(" · ");
  return `<h3>Electron structure</h3>
    <p>${escaped(configurationText(items))}</p><p class="muted">Shell populations ${escaped(count)}</p>
    <div class="orbital-controls">
      <label>Subshell <select data-orbit-sub>${items.map((item, index) => `<option value="${index}" ${index === items.length - 1 ? "selected" : ""}>${item.n}${item.kind}</option>`).join("")}</select></label>
      <label>Angular component m <select data-orbit-proj></select></label>
    </div>
    <canvas class="orbit-canvas" width="360" height="250" data-orbit tabindex="0" aria-label="Rotatable orbital angular surface. Use arrow keys to rotate."></canvas>
    <p class="muted">Drag or use the arrow keys to rotate the angular surface. Colors show opposite wavefunction phases. The surface omits radial structure.</p>
    <details><summary>Orbital occupancy diagram</summary>${boxes}</details>`;
}

function hydrateOrbit(root, z) {
  const canvas = root.querySelector("[data-orbit]");
  if (canvas) bindOrbital(canvas, root.querySelector("[data-orbit-sub]"), root.querySelector("[data-orbit-proj]"), shellsByZ.get(z));
}

function candidateSection(z) {
  const data = catalog.candidates.find(candidate => candidate.z === z);
  if (!data) return "";
  const result = predictionBaseline(elements, data.group, atomicNumber => selectedFact(facts, atomicNumber, "ionization", 1));
  const validation = result
    ? `<p>First ionization energy baseline <strong>${formatNumber(result.estimate, 5)} eV</strong> using the last reported value in group ${data.group} (${escaped(result.reference.name)}). The held-out period-6 mean absolute error was ${formatNumber(result.mae, 3)} eV (${result.n} examples), versus ${formatNumber(result.medianMae, 3)} eV for a global median.</p>
      <p class="muted">This baseline has no validated uncertainty interval at Z = ${z}.</p>` : "";
  return `<h2>Proposed element ${z}</h2><p>Period ${data.period} · Group ${data.group} in the proposed extension. ${fromSource(data.source)}</p>
    ${validation}`;
}

function showDialog(content, focus = document.activeElement) {
  const dialog = byId("summary");
  summaryFocus = focus;
  byId("summary-content").innerHTML = content;
  const heading = byId("summary-content").querySelector("h2");
  if (heading) heading.id = "summary-title";
  bindMedia(byId("summary-content"));
  if (!dialog.open) dialog.showModal();
}

function openSummary(z) {
  const element = byZ.get(z);
  if (!element) {
    const content = candidateSection(z);
    if (content) showDialog(content);
    return;
  }
  if (state.view === "isotopes") ensureIsotopes();
  const additional = state.view === "electrons" ? orbitalSection(z)
    : state.view === "isotopes" ? `<section id="iso-summary" data-z="${z}">${isotopeSection(z)}</section>` : "";
  showDialog(heading(element) + baseFacts(element) + photo(element)
    + `<p class="card-links"><a class="primary" data-detail="${z}" href="${escaped(urlFor({ detail: true, element: z }))}">Open element page</a>
      <a href="${escaped(urlFor({ detail: true, element: z }))}" target="_blank" rel="noopener">Open in new tab</a></p>`
    + (additional ? `<div class="section-head"></div>${additional}` : ""));
  hydrateOrbit(byId("summary-content"), z);
}

function factTable(element) {
  const relevant = rows.filter(fact => fact.z === element.z);
  const formatted = relevant.map(fact => {
    const shown = fact.property === "discovery" ? formatYear(fact.value) : formatFact(fact, state, 9);
    const label = fact.property === "ionization" ? `Ionization energy · step ${fact.variant}` : properties.get(fact.property)?.label;
    const uncertainty = fact.uncertainty ? ` ± ${formatNumber(fact.uncertainty * (convertValue(fact.property, 1, state) - convertValue(fact.property, 0, state)), 4)}` : "";
    return `<tr><th scope="row">${escaped(label)}</th><td>${escaped(shown + uncertainty)} ${escaped(unitOf(fact.property))}</td>
      <td>${escaped(fact.conditions ?? "—")}</td><td>${escaped(fact.status)}</td>
      <td>${fromSource(fact.source)}${fact.reference ? `<br><small>${escaped(fact.reference)}</small>` : ""}</td></tr>`;
  }).join("");
  return `<div class="table-scroll"><table class="data-table"><thead><tr><th>Property</th><th>Value</th><th>Conditions</th><th>Evidence</th><th>Source</th></tr></thead><tbody>${formatted}</tbody></table></div>`;
}

function renderDetail() {
  const root = byId("detail");
  const element = byZ.get(state.element);
  const back = `<button type="button" class="quiet" id="back">Back to table</button>`;
  if (!element) {
    root.innerHTML = back + candidateSection(state.element);
    return;
  }
  ensureIsotopes();
  root.innerHTML = `<div class="detail-content">${back}${heading(element)}${baseFacts(element)}${photo(element)}
    ${element.nameOrigin ? `<p><strong>Name origin</strong> ${escaped(element.nameOrigin)}</p>` : ""}
    ${element.discoverers ? `<p><strong>Discovery</strong> ${escaped(element.discoverers)}${element.discoveryLocation ? " · " + escaped(element.discoveryLocation) : ""}</p>` : ""}
    <div class="section-head"><h3>Element facts</h3>${link(`https://pubchem.ncbi.nlm.nih.gov/element/${element.z}`, "PubChem element page")}</div>${factTable(element)}
    <details><summary>Electron orbitals</summary>${orbitalSection(element.z)}</details>
    <details id="detail-isotopes" ${state.view === "isotopes" ? "open" : ""}><summary>Isotopes</summary>${isotopeSection(element.z)}</details></div>`;
  bindMedia(root);
  hydrateOrbit(root, element.z);
}

function comparePoints() {
  return elements.flatMap(element => {
    const xf = factOf(element.z, state.x);
    const yf = factOf(element.z, state.y);
    const a = scalar(xf?.value), b = scalar(yf?.value);
    return a === null || b === null || (filters && !filters.has(element.z)) ? [] : [{
      z: element.z, x: convertValue(state.x, a, state), y: convertValue(state.y, b, state),
      xStatus: xf.status, yStatus: yf.status, element,
    }];
  });
}

function renderChart(root) {
  const points = comparePoints();
  const heading = `<h2>Compare properties</h2><p>${points.length} elements with values on both axes. Chart points use the midpoint of published ranges.</p>`;
  if (!points.length) {
    root.innerHTML = heading;
    return;
  }
  const xMin = Math.min(...points.map(point => point.x)), xMax = Math.max(...points.map(point => point.x));
  const yMin = Math.min(...points.map(point => point.y)), yMax = Math.max(...points.map(point => point.y));
  const W = 900, H = 400, left = 84, right = W - 24, top = 18, bottom = H - 55;
  const xAt = value => left + (xMax === xMin ? .5 : (value - xMin) / (xMax - xMin)) * (right - left);
  const yAt = value => bottom - (yMax === yMin ? .5 : (value - yMin) / (yMax - yMin)) * (bottom - top);
  const guide = Array.from({ length: 6 }, (_, i) => {
    const xpos = left + (right - left) * i / 5;
    const ypos = bottom - (bottom - top) * i / 5;
    return `<line x1="${left}" x2="${right}" y1="${ypos}" y2="${ypos}"/><text x="${left - 8}" y="${ypos + 4}" text-anchor="end">${escaped(formatNumber(yMin + (yMax - yMin) * i / 5, 4))}</text>
      <text x="${xpos}" y="${bottom + 21}" text-anchor="middle">${escaped(formatNumber(xMin + (xMax - xMin) * i / 5, 4))}</text>`;
  }).join("");
  const dots = points.map(({ x, y, z, element: el }) => {
    const description = `${el.name} · ${formatNumber(x)} · ${formatNumber(y)}`;
    return `<circle cx="${xAt(x)}" cy="${yAt(y)}" r="5.5" fill="${familyColor(el.family)}" tabindex="0" role="button" aria-label="${escaped(description)}" data-chart-z="${z}"><title>${escaped(description)}</title></circle>`;
  }).join("");
  root.innerHTML = heading + `<svg class="chart" viewBox="0 0 ${W} ${H}" aria-label="Scatter plot">
    ${guide}<line x1="${left}" x2="${left}" y1="${top}" y2="${bottom}"/>${dots}
    <text x="${(left + right) / 2}" y="${H - 11}" text-anchor="middle">${escaped(labelFor(state.x))} ${escaped(unitOf(state.x))}</text>
    <text x="16" y="${H / 2}" transform="rotate(-90 16 ${H / 2})" text-anchor="middle">${escaped(labelFor(state.y))} ${escaped(unitOf(state.y))}</text></svg>
    <details><summary>View plotted rows</summary><div class="table-scroll"><table class="data-table"><thead><tr><th>Element</th><th>${escaped(labelFor(state.x))}</th><th>${escaped(labelFor(state.y))}</th></tr></thead><tbody>
    ${points.map(({ element, x, y }) => `<tr><th scope="row">${escaped(element.name)}</th><td>${escaped(formatNumber(x))}</td><td>${escaped(formatNumber(y))}</td></tr>`).join("")}</tbody></table></div></details>`;
}

function renderCompounds(root) {
  const matches = visibleCompounds();
  root.innerHTML = `<h2>Matching compounds</h2><p>${matches.length} ${remoteMatches !== undefined ? "matching PubChem results" : "matches in the offline catalog"}.
    Select elements on the grid or filter by name, formula or CAS number.</p>
    <div class="compound-results">${matches.map(row => `<article class="compound-record">
      <h3>${link(`https://pubchem.ncbi.nlm.nih.gov/compound/${row.cid}`, row.name)}</h3>
      <p>${escaped(formulaText(row.formula))} · ${escaped(formatNumber(row.weight))} g/mol</p></article>`).join("")}</div>`;
}

function render() {
  if (!catalog) return;
  renderControls();
  const showDetail = state.detail && (byZ.has(state.element) || catalog.candidates.some(item => item.z === state.element));
  byId("explorer").hidden = showDetail;
  byId("detail").hidden = !showDetail;
  byId("image").hidden = showDetail || state.view === "compare";
  if (showDetail) {
    renderDetail();
    return;
  }
  if (state.view === "isotopes") ensureIsotopes();
  computeMap();
  byId("map").hidden = state.view === "compare";
  const extra = byId("extra");
  extra.hidden = !["compare", "compounds"].includes(state.view);
  if (state.view !== "compare") {
    renderGrid();
    renderLegend();
    byId("peek").textContent = "";
  }
  if (state.view === "compare") renderChart(extra);
  else if (state.view === "compounds") renderCompounds(extra);
  const area = byId("iso-summary");
  if (area) area.innerHTML = isotopeSection(Number(area.dataset.z));
}

function setNotice(message) {
  const box = byId("notice");
  box.textContent = message;
  box.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { box.hidden = true; }, 6500);
}

function download(name, value, type) {
  const anchor = document.createElement("a");
  const objectUrl = URL.createObjectURL(new Blob([value], { type }));
  anchor.href = objectUrl;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
}

function exportedRows() {
  if (state.detail && byZ.has(state.element)) return rows.filter(row => row.z === state.element);
  if (state.view === "compare") {
    return comparePoints().flatMap(({ z }) => [factOf(z, state.x), factOf(z, state.y)]).filter((row, index, values) =>
      values.findIndex(other => row.id === other.id) === index);
  }
  if (state.view === "compounds") return visibleCompounds().map(row => ({ ...row, source: `https://pubchem.ncbi.nlm.nih.gov/compound/${row.cid}` }));
  if (state.view === "isotopes") return [...nuclides?.values() ?? []].flat().filter(row => (state.allNuclides || row.stable) && (!filters || filters.has(row.z)))
    .map(row => ({ z: row.z, a: row.a, property: state.nuclide, value: isotopeValue(row, state.nuclide), source: "mendeleev" }));
  if (state.view === "properties" && state.property === "phase") {
    return elements.filter(element => (!filters || filters.has(element.z)) && (!state.family || element.family === state.family) && (!state.phase || phaseOf(element.z) === state.phase))
      .map(({ z }) => ({ z, property: "phase", value: phaseOf(z), conditions: `${state.temp} K; 1 atm, modeled`,
        status: phaseOf(z) === "Unknown" ? "missing" : "calculated", source: catalog.phases[z]?.source }));
  }
  const key = state.view === "electrons" ? state.electron === "oxidation" ? "oxidation" : "configuration"
    : state.property === "family" ? null : state.property;
  return rows.filter(row => (!key || row.property === key) && (!filters || filters.has(row.z)) && inHistory(row.z)
    && (!state.family || byZ.get(row.z).family === state.family) && (key !== "ionization" || row.variant === state.ion));
}

function exportData(kind) {
  const records = exportedRows().map(row => ({
    ...row, symbol: byZ.get(row.z)?.symbol, sourceUrl: catalog.sources[row.source]?.[1] ?? row.source,
  }));
  if (kind === "json") {
    download("unfinished-table.json", JSON.stringify(records, null, 2), "application/json");
    return;
  }
  const keys = [...new Set(records.flatMap(Object.keys))];
  const cell = value => {
    const string = value === undefined || value === null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
    const checked = typeof value === "string" && /^[=+@\-\t\r]/.test(string) ? "'" + string : string;
    return '"' + checked.replaceAll('"', '""') + '"';
  };
  const csv = [keys.join(","), ...records.map(row => keys.map(key => cell(row[key])).join(","))].join("\r\n");
  download("unfinished-table.csv", csv, "text/csv;charset=utf-8");
}

function saveTableImage() {
  const grid = byId("grid");
  const bounds = grid.getBoundingClientRect();
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(bounds.width + 48);
  canvas.height = Math.ceil(bounds.height + 90);
  const ctx = canvas.getContext("2d");
  const page = getComputedStyle(document.documentElement);
  ctx.fillStyle = page.getPropertyValue("--surface");
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = page.getPropertyValue("--ink");
  ctx.font = "28px Georgia";
  ctx.fillText("The Unfinished Table", 24, 36);
  ctx.font = "13px system-ui";
  ctx.fillText(byId("map-title").textContent + " · " + labelFor(state.property), 24, 56);
  for (const item of grid.children) {
    const box = item.getBoundingClientRect();
    const x = box.left - bounds.left + 24, y = box.top - bounds.top + 69;
    const style = getComputedStyle(item);
    ctx.globalAlpha = Number(style.opacity);
    ctx.fillStyle = style.backgroundColor;
    ctx.fillRect(x, y, box.width, box.height);
    ctx.strokeStyle = page.getPropertyValue("--line");
    if (item.classList.contains("tile")) ctx.strokeRect(x + .5, y + .5, box.width - 1, box.height - 1);
    ctx.fillStyle = style.color;
    const main = item.querySelector(".symbol");
    const lines = main ? [item.querySelector(".tile-number")?.textContent, main.textContent, item.querySelector(".tile-value")?.textContent] : [item.innerText];
    lines.filter(Boolean).forEach((line, index) => {
      ctx.font = (index === 1 ? "bold 15px" : "10px") + " system-ui";
      ctx.fillText(line, x + 4, y + 12 + index * 15, box.width - 6);
    });
  }
  canvas.toBlob(blob => { if (blob) download("unfinished-table.png", blob, "image/png"); });
}

async function runRemoteSearch() {
  remoteRequest?.abort();
  const request = new AbortController();
  remoteRequest = request;
  const button = byId("remote-search");
  button.disabled = true;
  try {
    const matches = await searchPubChem(state.compound, getMix(), state.exact, symbols, request.signal);
    if (remoteRequest !== request) return;
    remoteMatches = matches;
    render();
  } catch (error) {
    if (error.name !== "AbortError") setNotice("PubChem is unavailable for this query. The offline catalog remains available.");
  } finally {
    if (remoteRequest === request) button.disabled = false;
  }
}

function resetRemoteSearch() {
  remoteRequest?.abort();
  remoteMatches = undefined;
}

function setTemperature(value) {
  if (!Number.isFinite(value)) return renderControls();
  change({ temp: Number(limit(value, 0, 6000).toFixed(4)), property: "phase", family: "" });
}

function toggleMix(symbol) {
  const mix = getMix();
  if (mix.has(symbol)) mix.delete(symbol);
  else mix.set(symbol, 1);
  resetRemoteSearch();
  change({ mix: encodeMix(mix) });
}

function chooseElement(z) {
  if (state.view === "compounds" && byZ.has(z)) toggleMix(byZ.get(z).symbol);
  else openSummary(z);
}

function handleGridKey(event) {
  if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  const tile = event.target.closest(".tile");
  if (!tile) return;
  const row = Number(tile.dataset.row), col = Number(tile.dataset.col);
  const vertical = event.key === "ArrowUp" || event.key === "ArrowDown";
  const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
  const prop = vertical ? "row" : "col", fixed = vertical ? "col" : "row";
  const start = vertical ? row : col;
  const choices = [...byId("grid").querySelectorAll(`.tile[data-${fixed}="${vertical ? col : row}"]`)]
    .filter(next => (Number(next.dataset[prop]) - start) * direction > 0)
    .sort((a, b) => (Number(a.dataset[prop]) - Number(b.dataset[prop])) * direction);
  if (choices.length) {
    event.preventDefault();
    choices[0].focus();
  }
}

function wireEvents() {
  const on = (id, event, callback) => byId(id).addEventListener(event, callback);
  on("views", "click", event => {
    const view = event.target.closest("[data-view]")?.dataset.view;
    if (view) change({ view, element: 0, detail: false, family: "", phase: "", query: "" }, true);
  });
  on("theme", "click", () => {
    const theme = state.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("unfinished-theme", theme); } catch { /* Browser storage is optional. */ }
    change({ theme });
  });
  on("compact", "click", () => change({ wide: false }));
  on("wide", "click", () => change({ wide: true }));
  for (const key of ["gaps", "allNuclides", "exact"]) {
    on(key, "change", event => {
      if (key === "exact") resetRemoteSearch();
      change({ [key]: event.target.checked });
    });
  }
  for (const key of ["panel", "labels", "scale", "electron", "nuclide", "x", "y", ...COLOR_KEYS]) {
    on(key, "change", event => change({ [key]: event.target.value }));
  }
  on("property", "change", event => change({ property: event.target.value, family: "", phase: "" }));
  on("ion", "change", event => change({ ion: Number(event.target.value) }));
  on("unit", "change", event => {
    const unit = event.target.value;
    const key = ["K", "°C", "°F"].includes(unit) ? "temperatureUnit" : ["eV", "kJ/mol"].includes(unit) ? "energy" : "densityUnit";
    change({ [key]: unit });
  });
  on("reset-colors", "click", () => change({ low: "", high: "", zero: "", missing: "" }));
  on("temp-range", "input", event => setTemperature(event.target.valueAsNumber));
  on("temp-back", "click", () => setTemperature(state.temp - 1));
  on("temp-forward", "click", () => setTemperature(state.temp + 1));
  on("temp-reset", "click", () => setTemperature(defaults.temp));
  for (const [id, unit] of TEMP_FIELDS) on(id, "change", event => setTemperature(toKelvin(event.target.valueAsNumber, unit)));
  on("year-range", "input", event => change({ year: event.target.valueAsNumber }));
  on("year-input", "change", event => {
    if (Number.isFinite(event.target.valueAsNumber)) change({ year: event.target.valueAsNumber });
    else renderControls();
  });
  on("year-reset", "click", () => change({ year: defaults.year }));
  on("search", "input", event => change({ query: event.target.value, detail: false, element: 0 }));
  on("search", "keydown", event => {
    if (event.key === "Enter" && filters?.size === 1) chooseElement([...filters][0]);
  });
  on("compound", "input", event => { resetRemoteSearch(); change({ compound: event.target.value }); });
  on("compound", "keydown", event => { if (event.key === "Enter") runRemoteSearch(); });
  on("remote-search", "click", runRemoteSearch);
  on("clear-mix", "click", () => { resetRemoteSearch(); change({ mix: "", compound: "" }); });
  on("mix", "click", event => { if (event.target.dataset.remove) toggleMix(event.target.dataset.remove); });
  on("mix", "change", event => {
    if (!event.target.dataset.amount) return;
    const mix = getMix();
    const value = Number(event.target.value);
    mix.set(event.target.dataset.amount, Number.isFinite(value) ? limit(Math.round(value), 1, 99) : 1);
    resetRemoteSearch();
    change({ mix: encodeMix(mix) });
  });
  on("grid", "click", event => {
    const tile = event.target.closest(".tile");
    if (!tile) return;
    if (tile.dataset.z) chooseElement(Number(tile.dataset.z));
    else if (tile.dataset.series) {
      change({ wide: true });
      const first = byId("grid").querySelector(`[data-z="${tile.dataset.series === "6" ? 57 : 89}"]`);
      first?.focus();
    } else if ("gap" in tile.dataset) {
      const proposed = Number(tile.dataset.row) === 8;
      showDialog(`<h2>${proposed ? "Unassigned position" : "Layout gap"}</h2><p>${proposed
        ? "This slot has no assigned atomic number in the displayed period-eight proposal."
        : "This position is empty in this layout. Open a neighboring element to see its period and group."}</p>`, tile);
    }
  });
  on("grid", "keydown", handleGridKey);
  for (const action of ["pointerover", "focusin"]) on("grid", action, event => {
    const z = Number(event.target.closest(".tile")?.dataset.z);
    const element = byZ.get(z);
    if (element) byId("peek").textContent = `${element.name} · ${element.z} · ${phaseOf(z)} at ${formatTemperature(state.temp, "°C")} °C`;
  });
  on("grid", "pointerleave", () => { byId("peek").textContent = ""; });
  on("legend", "click", event => {
    const target = event.target.closest("button");
    if (target?.dataset.family) change({ family: state.family === target.dataset.family ? "" : target.dataset.family });
    if (target?.dataset.phaseFilter) change({ phase: state.phase === target.dataset.phaseFilter ? "" : target.dataset.phaseFilter });
  });
  on("extra", "click", event => {
    const z = Number(event.target.closest("[data-chart-z]")?.dataset.chartZ);
    if (z) openSummary(z);
  });
  on("extra", "keydown", event => {
    if (["Enter", " "].includes(event.key) && event.target.dataset.chartZ) {
      event.preventDefault();
      openSummary(Number(event.target.dataset.chartZ));
    }
  });
  on("summary", "close", () => {
    if (summaryFocus?.isConnected && !state.detail) summaryFocus.focus();
  });
  on("summary", "click", event => {
    if (event.target === byId("summary")) byId("summary").close();
    const anchor = event.target.closest("a[data-detail]");
    if (anchor && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      byId("summary").close();
      change({ detail: true, element: Number(anchor.dataset.detail) }, true);
      byId("detail").querySelector("button")?.focus();
    }
  });
  document.addEventListener("click", event => {
    const isotope = event.target.closest("button[data-isotope]");
    if (isotope) {
      chosenIsotope = { z: Number(isotope.dataset.for), a: Number(isotope.dataset.isotope) };
      const area = isotope.closest("#iso-summary") || isotope.closest("#detail-isotopes");
      if (area.id === "iso-summary") area.innerHTML = isotopeSection(chosenIsotope.z);
      else area.innerHTML = '<summary>Isotopes</summary>' + isotopeSection(chosenIsotope.z);
      area.querySelector(`button[data-isotope="${chosenIsotope.a}"]`)?.focus();
    }
    if (event.target.id === "back") {
      const z = state.element;
      change({ detail: false, element: 0 }, true);
      byId("grid").querySelector(`[data-z="${z}"]`)?.focus();
    }
  });
  window.addEventListener("popstate", () => {
    if (byId("summary").open) byId("summary").close();
    resetRemoteSearch();
    state = initialState();
    render();
  });
  on("csv", "click", () => exportData("csv"));
  on("json", "click", () => exportData("json"));
  on("image", "click", saveTableImage);
  on("print", "click", () => window.print());
  on("share", "click", async () => {
    try {
      await navigator.clipboard.writeText(urlFor());
      setNotice("View link copied.");
    } catch {
      showDialog(`<h2>Share this view</h2><p><input type="text" readonly aria-label="Shareable URL" value="${escaped(urlFor())}"></p>`);
      byId("summary-content").querySelector("input").select();
    }
  });
  on("sources", "click", () => showDialog(`<h2>Data sources</h2><ul class="source-list">${Object.keys(catalog.sources).map(id => `<li>${fromSource(id)}</li>`).join("")}</ul>
    <p>A bracketed number identifies a reference isotope. A double question mark labels an unavailable value or an open position, depending on the tile.</p>`));
}

async function start() {
  [catalog, rows, compounds] = await Promise.all([
    fetchData("data/catalog.json"), fetchData("data/facts.ndjson.gz", "rows"), fetchData("data/compounds.json"),
  ]);
  elements = catalog.elements;
  byZ = new Map(elements.map(element => [element.z, element]));
  symbols = new Set(elements.map(element => element.symbol));
  facts = indexFacts(rows);
  properties = new Map(catalog.properties.map(prop => [prop.id, prop]));
  numericProperties = catalog.properties.filter(prop => ["Atomic", "Physical", "Abundance", "History", "Materials"].includes(prop.group))
    .filter(prop => rows.some(row => row.property === prop.id));
  const configurationOfSymbol = new Map(elements.map(el => [el.symbol, configFor(el.z)]));
  shellsByZ = new Map(elements.map(el => [el.z, expandConfiguration(configFor(el.z), symbol => configurationOfSymbol.get(symbol))]));
  const groups = Map.groupBy(numericProperties, prop => prop.group);
  byId("property").innerHTML = PROPERTIES.map(([id, label]) => option(id, label)).join("")
    + [...groups].map(([group, list]) => `<optgroup label="${escaped(group)}">${list.map(prop => option(prop.id, prop.label)).join("")}</optgroup>`).join("");
  for (const id of ["x", "y"]) byId(id).innerHTML = numericProperties.map(prop => option(prop.id, prop.label)).join("");
  byId("ion").innerHTML = Array.from({ length: 30 }, (_, index) => option(index + 1, `Step ${index + 1}`)).join("");
  byId("nuclide").innerHTML = ISOTOPE_FIELDS.map(([key, label]) => option(key, label)).join("");
  wireEvents();
  byId("loading").hidden = true;
  render();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
}

start().catch(error => {
  byId("loading").textContent = error.message + ". Reload to try again.";
});
