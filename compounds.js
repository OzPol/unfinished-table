import { formulaMatches, parseFormula } from "./model.js";

const PUG = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound";

export function readMix(value, symbols) {
  return new Map(value.split(",").flatMap(item => {
    const [symbol, number = "1"] = item.split(":");
    const amount = Number(number);
    return symbols.has(symbol) && Number.isInteger(amount) && amount >= 1 && amount <= 99 ? [[symbol, amount]] : [];
  }));
}

export function encodeMix(mix) {
  return [...mix].map(([symbol, count]) => symbol + ":" + count).join(",");
}

export function formulaFromMix(mix) {
  return [...mix].map(([symbol, count]) => symbol + (count === 1 ? "" : count)).join("");
}

export function findCompounds(rows, query, mix, exact, symbols) {
  const term = query.trim();
  const formula = parseFormula(term, symbols);
  return rows.filter(row => {
    const composition = parseFormula(row.formula, symbols);
    const matchesFilter = !mix.size || (exact ? formulaMatches(composition, mix, true)
      : composition && [...mix].every(([symbol, count]) => (composition.get(symbol) ?? 0) >= count));
    if (!matchesFilter || !term) return matchesFilter;
    if (formula) return formulaMatches(composition, formula, exact || /[\d₀-₉]/.test(term));
    const search = term.toLowerCase();
    return [row.name, ...row.aliases ?? [], ...row.cas ?? []].some(value => value.toLowerCase().includes(search));
  });
}

async function queryJson(url, signal) {
  const response = await fetch(url, { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`PubChem returned HTTP ${response.status}`);
  return response.json();
}

export async function searchPubChem(term, mix, exact, symbols, signal) {
  const input = term.trim() || formulaFromMix(mix);
  if (!input) return [];
  const formula = parseFormula(input, symbols);
  const key = encodeURIComponent(formula ? formulaFromMix(formula) : input);
  const mode = formula ? "fastformula" : "name";
  const options = formula ? `?AllowOtherElements=${!exact}&MaxRecords=45` : "";
  const matches = await queryJson(`${PUG}/${mode}/${key}/cids/JSON${options}`, signal);
  const ids = matches?.IdentifierList?.CID?.slice(0, 45) ?? [];
  if (!ids.length) return [];
  const data = await queryJson(`${PUG}/cid/${ids.join(",")}/property/Title,MolecularFormula,MolecularWeight/JSON`, signal);
  const compounds = (data?.PropertyTable?.Properties ?? []).map(row => ({
    cid: row.CID, name: row.Title ?? "Compound " + row.CID,
    formula: row.MolecularFormula, weight: Number(row.MolecularWeight),
  }));
  return findCompounds(compounds, "", mix, exact, symbols);
}
