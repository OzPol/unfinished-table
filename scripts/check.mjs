import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import {
  parseRows, indexFacts, selectedFact, tablePosition, tableCells, phaseFor,
  searchElements, temperatureIn, toKelvin, readState, stateParams, expandConfiguration, electronShells,
  predictionBaseline, isotopeValue, colorFraction,
} from "../model.js";
import { findCompounds } from "../compounds.js";

const read = path => readFileSync(new URL("../" + path, import.meta.url));
const compressedRows = path => parseRows(gunzipSync(read(path)).toString("utf8"));
const catalog = JSON.parse(read("data/catalog.json"));
const records = compressedRows("data/facts.ndjson.gz");
const isotopes = compressedRows("data/isotopes.ndjson.gz");
const compounds = JSON.parse(read("data/compounds.json"));
const { elements, phases, candidates, properties, sources } = catalog;
const symbols = new Set(elements.map(element => element.symbol));
const index = indexFacts(records);
const firstIon = z => selectedFact(index, z, "ionization", 1);

assert.deepEqual(elements.map(el => el.z), Array.from({ length: 118 }, (_, i) => i + 1));
assert.equal(symbols.size, 118);
assert.equal(new Set(records.map(record => record.id)).size, records.length);
assert.equal(new Set(isotopes.map(row => row.z + ":" + row.a)).size, isotopes.length);
assert.ok(elements.every(el => el.weightLabel !== "??"));
for (const row of records) {
  assert.ok(properties.some(prop => prop.id === row.property), row.id);
  assert.ok(sources[row.source], row.id);
  assert.ok(row.z >= 1 && row.z <= 118 && row.value != null, row.id);
}
for (const wide of [false, true]) {
  const positions = elements.map(element => tablePosition(element, wide)).map(({ row, col }) => row + ":" + col);
  assert.equal(new Set(positions).size, 118);
  for (const gaps of [false, true]) {
    const cells = tableCells(elements, candidates, wide, gaps);
    assert.equal(cells.filter(cell => cell.kind === "element").length, 118);
    assert.equal(cells.filter(cell => cell.kind === "candidate").length, gaps ? 2 : 0);
    assert.equal(cells.filter(cell => cell.kind === "series").length, wide ? 0 : 2);
    assert.equal(new Set(cells.map(cell => cell.row + ":" + cell.col)).size, cells.length);
  }
}

assert.deepEqual(selectedFact(index, 1, "weight").value, [1.00784, 1.00811]);
assert.equal(selectedFact(index, 43, "weight"), undefined);
assert.equal(selectedFact(index, 43, "mass-number").value, 97);
assert.equal(phaseFor(80, 223.15, phases), "Solid");
assert.equal(phaseFor(80, 293.15, phases), "Liquid");
assert.equal(phaseFor(80, 673.15, phases), "Gas");
assert.equal(phaseFor(2, 1.2, phases), "Liquid");
assert.equal(phaseFor(2, 5, phases), "Gas");
assert.equal(phaseFor(6, 4500, phases), "Gas");
assert.equal(phaseFor(118, 293.15, phases), "Unknown");
assert.equal(toKelvin(68, "°F"), 293.15);
assert.equal(temperatureIn(373.15, "°C"), 100);
assert.ok(colorFraction(10, 1, 100, true) > .49 && colorFraction(10, 1, 100, true) < .51);

const numbers = element => element.z;
assert.deepEqual([...searchElements("aluminum", elements, numbers)], [13]);
assert.deepEqual([...searchElements("35", elements, numbers)], [35]);
assert.deepEqual([...searchElements("34-36", elements, numbers)], [34, 35, 36]);
assert.deepEqual([...searchElements("~35.6", elements, numbers)], [36]);

const configuration = symbol => selectedFact(index, elements.find(el => el.symbol === symbol).z, "configuration").value;
const expanded = expandConfiguration(configuration("Cr"), configuration);
assert.deepEqual(electronShells(expanded), [2, 8, 13, 1]);

const carbon14 = isotopes.find(row => row.z === 6 && row.a === 14);
assert.ok(isotopeValue(carbon14, "seconds") > 1e11 && isotopeValue(carbon14, "seconds") < 2e11);
assert.equal(isotopeValue(carbon14, "decay"), "B-");
assert.ok(isotopeValue(carbon14, "binding") > 100);
assert.ok(isotopeValue(carbon14, "activity") > 0);
assert.ok(isotopeValue(carbon14, "width") > 0);

assert.equal(findCompounds(compounds, "7732-18-5", new Map(), false, symbols)[0].name, "Water");
const matches = findCompounds(compounds, "OH2", new Map(), true, symbols);
assert.deepEqual(matches.map(row => row.name), ["Water"]);
assert.deepEqual(findCompounds(compounds, "", new Map([["C", 1], ["O", 2]]), true, symbols).map(row => row.name), ["Carbon Dioxide"]);

const state = readState(new URLSearchParams("wide=1&gaps=1&temp=900&property=phase&theme=dark&view=properties"));
assert.equal(state.gaps, true);
assert.equal(readState(stateParams(state)).temp, 900);
assert.equal(readState(stateParams(state)).theme, "dark");
assert.equal(readState(new URLSearchParams("temp=-100&view=bad")).temp, 0);
const prediction = predictionBaseline(elements, 1, firstIon);
assert.ok(prediction.n >= 7 && prediction.mae >= 0);
assert.ok(prediction.mae < prediction.medianMae);
console.log(`Validated ${elements.length} elements, ${records.length} facts, ${isotopes.length} isotopes and core interactions.`);
