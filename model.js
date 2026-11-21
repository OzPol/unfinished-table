export const FAMILIES = [
  "Alkali metal", "Alkaline earth", "Transition metal", "Post-transition metal", "Metalloid",
  "Nonmetal", "Halogen", "Noble gas", "Lanthanide", "Actinide",
];

export const PHASES = ["Solid", "Liquid", "Gas", "Unknown"];

const SUBSHELLS = "spdfg";
const SUBSCRIPT = "₀₁₂₃₄₅₆₇₈₉";
const SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const ENERGY_FACTOR = 96.48533212;
const ATOMIC_MASS_MEV = 931.49410242;

export const ISOTOPE_FIELDS = [
  ["a", "Mass number", ""], ["mass", "Isotopic mass", "Da"],
  ["excess", "Mass excess", "MeV"], ["binding", "Binding energy", "MeV"],
  ["abundance", "Natural abundance", "%"], ["seconds", "Half-life", "s"],
  ["decay", "Decay mode", ""], ["width", "Decay width", "MeV"],
  ["activity", "Specific activity", "Bq/g"], ["magnetic", "Magnetic moment", "μN"],
  ["quadrupole", "Quadrupole moment", "b"], ["spin", "Spin and parity", ""],
];

const views = ["properties", "electrons", "isotopes", "compounds", "compare"];

export const defaults = {
  view: "properties",
  property: "family",
  electron: "oxidation",
  nuclide: "seconds",
  ion: 1,
  temp: 293.15,
  year: 2026,
  wide: false,
  gaps: false,
  theme: "light",
  panel: "top",
  labels: "full",
  scale: "linear",
  energy: "eV",
  temperatureUnit: "K",
  densityUnit: "g/cm³",
  query: "",
  family: "",
  phase: "",
  x: "z",
  y: "ionization",
  compound: "",
  mix: "",
  exact: false,
  allNuclides: true,
  low: "",
  high: "",
  zero: "",
  missing: "",
  element: 0,
  detail: false,
};

export function limit(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

export function readState(params) {
  const state = { ...defaults };
  for (const [key, defaultValue] of Object.entries(defaults)) {
    const value = params.get(key);
    if (value === null) continue;
    if (typeof defaultValue === "boolean") state[key] = value === "1";
    else if (typeof defaultValue === "number" && Number.isFinite(Number(value))) state[key] = Number(value);
    else if (typeof defaultValue === "string") state[key] = value;
  }
  state.view = views.includes(state.view) ? state.view : defaults.view;
  state.temp = limit(state.temp, 0, 6000);
  state.year = limit(Math.round(state.year), -10000, 2026);
  state.ion = limit(Math.round(state.ion), 1, 30);
  state.element = Number.isInteger(state.element) && state.element >= 1 && state.element <= 120 ? state.element : 0;
  for (const [key, choices] of Object.entries({
    theme: ["light", "dark"], panel: ["top", "side", "hidden"],
    labels: ["full", "symbol", "configuration"], scale: ["linear", "log"],
    energy: ["eV", "kJ/mol"], temperatureUnit: ["K", "°C", "°F"], densityUnit: ["g/cm³", "kg/m³"],
    nuclide: ISOTOPE_FIELDS.map(([id]) => id),
  })) if (!choices.includes(state[key])) state[key] = defaults[key];
  for (const key of ["low", "high", "zero", "missing"]) {
    if (!/^#[0-9a-f]{6}$/i.test(state[key])) state[key] = "";
  }
  return state;
}

export function stateParams(state) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(defaults)) {
    if (state[key] !== value) params.set(key, typeof value === "boolean" ? Number(state[key]) : state[key]);
  }
  return params;
}

export function parseRows(text) {
  return text.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
}

export function indexFacts(rows) {
  const index = new Map();
  for (const row of rows) {
    const key = `${row.z}:${row.property}`;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(row);
  }
  return index;
}

export function selectedFact(index, z, property, ion = 1) {
  const rows = index.get(`${z}:${property}`) ?? [];
  if (property === "ionization") return rows.find(item => item.variant === ion);
  return rows.find(item => !item.conditions?.includes("solid-phase transition")) ?? rows[0];
}

export function scalar(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value) && value.length === 2 && value.every(Number.isFinite)) return (value[0] + value[1]) / 2;
  return null;
}

export function temperatureIn(kelvin, unit) {
  if (unit === "°C") return kelvin - 273.15;
  if (unit === "°F") return (kelvin - 273.15) * 1.8 + 32;
  return kelvin;
}

export function toKelvin(value, unit) {
  if (unit === "°C") return value + 273.15;
  if (unit === "°F") return (value - 32) / 1.8 + 273.15;
  return value;
}

export function displayUnit(property, fact, state) {
  if (["melting", "boiling", "sublimation"].includes(property)) return state.temperatureUnit;
  if (["ionization", "affinity"].includes(property)) return state.energy;
  if (["density", "density-pubchem", "liquid-density"].includes(property)) return state.densityUnit;
  return fact?.unit ?? "";
}

export function convertValue(property, value, state) {
  if (typeof value !== "number") return value;
  if (["melting", "boiling", "sublimation"].includes(property)) return temperatureIn(value, state.temperatureUnit);
  if (["ionization", "affinity"].includes(property) && state.energy === "kJ/mol") return value * ENERGY_FACTOR;
  if (["density", "density-pubchem", "liquid-density"].includes(property) && state.densityUnit === "kg/m³") return value * 1000;
  return value;
}

export function phaseFor(z, kelvin, transitions) {
  const entry = transitions[z];
  if (!entry) return "Unknown";
  const { melting, boiling, sublimes } = entry;
  if (sublimes && boiling !== null) return kelvin < boiling ? "Solid" : "Gas";
  if (boiling !== null && kelvin >= boiling) return "Gas";
  // Helium's solid phase requires pressure above the one-atmosphere model.
  if (z === 2 && kelvin > 0 && boiling !== null) return "Liquid";
  if (melting !== null && kelvin < melting) return "Solid";
  if (melting !== null && boiling !== null && melting < boiling) return "Liquid";
  return "Unknown";
}

export function tablePosition(element, wide) {
  const { z, period, group } = element;
  const seriesStart = period === 6 ? 57 : period === 7 ? 89 : 0;
  if (seriesStart && z >= seriesStart && z < seriesStart + 15) {
    return wide
      ? { row: period, col: 3 + z - seriesStart }
      : { row: period + 3, col: 3 + z - seriesStart };
  }
  return { row: period, col: wide && group >= 3 ? group + 14 : group };
}

export function tableCells(elements, candidates, wide, gaps) {
  const result = [];
  const columns = wide ? 32 : 18;
  const occupied = new Map(elements.map(element => {
    const position = tablePosition(element, wide);
    return [`${position.row}/${position.col}`, element];
  }));
  const totalRows = wide ? (gaps ? 8 : 7) : 10;
  for (let row = 1; row <= totalRows; row += 1) {
    if (row === 8 && !gaps) continue;
    for (let col = 1; col <= columns; col += 1) {
      const element = occupied.get(`${row}/${col}`);
      const candidate = gaps && row === 8 ? candidates.find(item => item.group === col) : undefined;
      if (element) result.push({ row, col, kind: "element", element });
      else if (candidate) result.push({ row, col, kind: "candidate", candidate });
      else if (!wide && col === 3 && (row === 6 || row === 7)) result.push({ row, col, kind: "series" });
      else if (gaps && row <= 8) result.push({ row, col, kind: "gap" });
    }
  }
  return result;
}

export function formatNumber(value, precision = 6) {
  if (value === null || value === undefined) return "??";
  if (typeof value !== "number") return String(value);
  if (value === 0) return "0";
  if (Math.abs(value) < 0.001 || Math.abs(value) >= 1e6) return Number(value.toPrecision(precision)).toExponential();
  return Number(value.toPrecision(precision)).toLocaleString("en-US", { maximumFractionDigits: 12 });
}

export function formatFact(fact, state, precision = 6) {
  if (!fact) return "??";
  if (Array.isArray(fact.value)) {
    if (fact.range_kind) return fact.value.map(value => formatNumber(value, precision)).join("–");
    return fact.value.map(value => formatNumber(value, precision)).join(", ");
  }
  return formatNumber(convertValue(fact.property, fact.value, state), precision);
}

export function searchElements(query, elements, valueFor, localeNames = {}) {
  const term = query.trim().toLowerCase().replaceAll("−", "-");
  if (!term) return null;
  const threshold = term.match(/^(<=|>=|<|>|=|~)\s*(-?\d+(?:\.\d+)?)$/);
  const interval = term.match(/^(-?\d+(?:\.\d+)?)\s*(?:\.\.|–|-)\s*(-?\d+(?:\.\d+)?)$/);
  if (!threshold && !interval) {
    if (/^\d+$/.test(term)) return new Set(elements.filter(element => element.z === Number(term)).map(element => element.z));
    return new Set(elements.filter(element =>
      [element.name, element.symbol, localeNames[element.z], ...element.aliases].some(value => value?.toLowerCase().includes(term))
    ).map(element => element.z));
  }
  const values = elements.flatMap(element => {
    const value = valueFor(element);
    const items = Array.isArray(value) ? value : [value];
    const numbers = items.filter(Number.isFinite);
    return numbers.length ? [[element.z, numbers]] : [];
  });
  if (interval) {
    const [min, max] = interval.slice(1).map(Number).sort((a, b) => a - b);
    return new Set(values.filter(([, nums]) => nums.some(n => min <= n && n <= max)).map(([z]) => z));
  }
  const [, sign, number] = threshold;
  const target = Number(number);
  if (sign === "~") {
    const pairs = values.map(([z, numbers]) => [z, Math.min(...numbers.map(value => Math.abs(value - target)))]);
    const closest = Math.min(...pairs.map(([, error]) => error));
    return new Set(pairs.filter(([, error]) => error === closest).map(([z]) => z));
  }
  const comparisons = { "<": n => n < target, ">": n => n > target, "<=": n => n <= target, ">=": n => n >= target, "=": n => n === target };
  return new Set(values.filter(([, nums]) => nums.some(comparisons[sign])).map(([z]) => z));
}

export function colorFraction(value, min, max, logarithmic) {
  if (value === null) return null;
  if (logarithmic) {
    if (value <= 0 || min <= 0) return null;
    value = Math.log(value);
    min = Math.log(min);
    max = Math.log(max);
  }
  if (min === max) return 0.5;
  return limit((value - min) / (max - min), 0, 1);
}

export function expandConfiguration(configuration, configurationFor, seen = new Set()) {
  if (!configuration) return [];
  const prefix = configuration.match(/\[([A-Z][a-z]?)\]/)?.[1];
  const start = prefix && !seen.has(prefix)
    ? expandConfiguration(configurationFor(prefix), configurationFor, new Set([...seen, prefix]))
    : [];
  return start.concat(Array.from(configuration.matchAll(/(\d)([spdfg])\s*(\d+)?/g), ([, n, kind, count]) => ({
    n: Number(n), kind, l: SUBSHELLS.indexOf(kind), count: Number(count || 1),
  })));
}

export function electronShells(subshells) {
  const counts = [];
  for (const { n, count } of subshells) counts[n - 1] = (counts[n - 1] ?? 0) + count;
  return Array.from(counts, count => count ?? 0);
}

export function configurationText(subshells) {
  return subshells.map(({ n, kind, count }) => n + kind + String(count).replace(/\d/g, digit => SUPERSCRIPT[Number(digit)])).join(" ");
}

export function formulaText(formula) {
  const [atoms, charge = ""] = formula.split(/(?=[+-]\d*$)/);
  return atoms.replace(/\d/g, digit => SUBSCRIPT[Number(digit)])
    + charge.replace(/\d/g, digit => SUPERSCRIPT[Number(digit)]).replaceAll("-", "⁻").replaceAll("+", "⁺");
}

export function parseFormula(input, allowedSymbols) {
  const value = input.trim().replace(/[₀-₉]/g, char => String(SUBSCRIPT.indexOf(char))).replace(/[+-]\d*$/, "");
  const tokens = [...value.matchAll(/([A-Z][a-z]?)([1-9]\d*)?/g)];
  if (!tokens.length || tokens.map(item => item[0]).join("") !== value) return null;
  if (tokens.some(([, symbol, quantity]) => !allowedSymbols.has(symbol) || Number(quantity || 1) > 10000)) return null;
  const result = new Map();
  for (const [, symbol, count] of tokens) result.set(symbol, (result.get(symbol) ?? 0) + Number(count || 1));
  return result;
}

export function formulaMatches(formula, selected, exact = false, checkShares = false) {
  if (!formula) return false;
  if ((exact || checkShares) && formula.size !== selected.size) return false;
  return [...selected].every(([symbol, quantity]) => {
    if (!formula.has(symbol)) return false;
    if (exact) return formula.get(symbol) === quantity;
    return !checkShares || formula.get(symbol) >= quantity;
  });
}

export function isotopeValue(row, metric) {
  const { z, a, mass, seconds, spin, decays } = row;
  if (metric === "seconds") return row.stable ? "Stable" : seconds;
  if (metric === "decay") return row.stable ? "Stable" : decays?.find(decay => !decay.unobserved)?.mode;
  if (metric === "excess" && mass) return (mass - a) * ATOMIC_MASS_MEV;
  if (metric === "binding" && mass) return (z * 1.007825031898 + (a - z) * 1.00866491606 - mass) * ATOMIC_MASS_MEV;
  if (metric === "activity" && mass) return row.stable ? 0 : seconds > 0 ? 6.02214076e23 * Math.LN2 / (mass * seconds) : undefined;
  if (metric === "width") return row.stable ? 0 : seconds > 0 ? 6.582119569e-22 * Math.LN2 / seconds : undefined;
  if (metric === "magnetic" && row.g !== undefined && spin) {
    const parts = spin.match(/^(\d+)(?:\/(\d+))?$/);
    return parts ? row.g * Number(parts[1]) / Number(parts[2] ?? 1) : undefined;
  }
  if (metric === "spin" && spin) return spin + (row.parity ?? "");
  return row[metric];
}

export function predictionBaseline(elements, candidateGroup, factFor) {
  const examples = elements.flatMap(element => {
    const fact = factFor(element.z);
    return element.group && fact?.status === "reported" ? [{ ...element, value: fact.value }] : [];
  });
  const train = examples.filter(example => example.period <= 5);
  const test = examples.filter(example => example.period === 6 && example.group !== 3);
  if (!train.length) return null;
  const median = [...train].sort((a, b) => a.value - b.value)[Math.floor(train.length / 2)].value;
  const homolog = (rows, group) => rows.filter(example => example.group === group).sort((a, b) => b.period - a.period)[0];
  const losses = test.flatMap(row => {
    const reference = homolog(train, row.group);
    return reference ? [{ homolog: Math.abs(reference.value - row.value), median: Math.abs(median - row.value) }] : [];
  });
  const reference = homolog(examples, candidateGroup);
  if (!reference || !losses.length) return null;
  return {
    estimate: reference.value,
    reference,
    n: losses.length,
    mae: losses.reduce((sum, loss) => sum + loss.homolog, 0) / losses.length,
    medianMae: losses.reduce((sum, loss) => sum + loss.median, 0) / losses.length,
  };
}
