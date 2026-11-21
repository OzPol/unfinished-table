# The Unfinished Table

> For Oz and Axiom, who wanted the questions to be as visible as the answers.

Explore the 118 recognized elements, compare properties, and inspect the evidence behind each value.

## Run locally

Start the buildless app with Python 3, then open [localhost:8000](http://localhost:8000).

```sh
npm run serve
```

Run the data and interaction logic checks with `npm run check`. There are no Node package dependencies. The browser needs ES modules, `DecompressionStream`, and `Map.groupBy`.

## Data and interpretation

- [IUPAC](https://iupac.org/what-we-do/periodic-table-of-elements/) identifies recognized elements. The [CIAAW tables](https://www.ciaaw.org/atomic-weights.htm) supply standard atomic weights and ranges. Brackets on a tile identify a CIAAW reference isotope mass number.
- [PubChem](https://pubchem.ncbi.nlm.nih.gov/periodic-table/), [mendeleev](https://mendeleev.readthedocs.io/en/stable/data.html), [NIST ASD](https://physics.nist.gov/PhysRefData/ASD/ionEnergy.html), and [pymatgen](https://github.com/materialsproject/pymatgen) supply property data. The in-app sources and individual fact records include attribution and source metadata. mendeleev and pymatgen notices are under `data/`.
- Photo records come from the [Periodic-Table-JSON media index](https://github.com/Bowserinator/Periodic-Table-JSON) under CC BY-SA 3.0. It indexes photos under separate licenses. Each displayed photo retains its caption, individual credit, and source link. Photos and PubChem live queries require internet access.
- The temperature slider models phase at 1 atm using reported transition points. Material form and pressure affect real phase boundaries. The phase rendering marks missing or insufficient inputs with `??`. It models sublimation for the source's flagged allotropes and uses helium's pressure-specific behavior.
- A layout gap is a grid coordinate. The candidate cells for Z = 119 and 120 use [Pyykkö's proposed extension](https://doi.org/10.1039/C0CP01575J). Their first-ionization-energy baseline and held-out errors are illustrative and have no validated extrapolation interval.
- Nulls and absent records represent unavailable data. Standard atomic-weight intervals are retained. The chart uses their midpoint and exported measurements retain the interval and canonical units. Photos are available when a credited source is listed.

Each row in `data/facts.ndjson.gz` is a sourced assertion with a stable ID, atomic number, property, value or range, unit, conditions, uncertainty where reported, status, and citation metadata. `data/catalog.json` holds the element identities, property definitions, phase inputs and source URLs. `data/isotopes.ndjson.gz` holds one evaluated nuclide record per line, including the reported uncertainty fields and decay branches. The viewer exports visible data as CSV and JSON.

```sh
gzip -dc data/facts.ndjson.gz | jq -c 'select(.z == 26 and .property == "density")'
```

Regenerate the snapshots with `python3 scripts/import_data.py`. The importer fetches the upstream files into a sibling scratch directory and verifies the pinned mendeleev wheel before extraction.

## Reference feature audit

The [Ptable reference](https://ptable.com/about/) informed the feature inventory.

| Area | Prototype coverage |
|---|---|
| Table layout | Compact and inline f-block layouts, responsive scrolling, tile density, controls above/beside/hidden, light and dark palettes |
| Cell interactions | Hover/focus preview, click/tap summary, close with Escape or button, full element view with an option to open it in a new tab, arrow navigation, interactive family and phase legends |
| Missing cells | Optional rectangle with clickable layout gaps and proposed elements, separate missing-property markers |
| Numeric properties | Property maps, linear/log scales, customizable low/high/zero/missing colors, unit conversions, 30 ionization steps, radii, hardness, moduli, conductivities, heat, density and two abundance media |
| Temperature and history | Live phase slider, editable Celsius/Fahrenheit/Kelvin and step/reset controls, discovery-year cutoff |
| Electron structure | Oxidation states, shorthand and expanded configuration, shell populations, blocks, orbital occupancy and rotatable angular surfaces |
| Isotopes | Element isotope selection, radioactive/stable filtering, decay indicators and 12 metrics, with measured and derived quantities identified |
| Compounds | Select elements from the table, adjust counts, match exact formulas, search names/CAS/formula, see matching counts, query PubChem live or browse the offline index |
| Compare and export | Interactive scatter plots, numeric/name/symbol/Z search, CSV/JSON/image exports, print styling, shareable view links, and offline caching |
| Reference coverage still open | Additional abundance media, liquid densities, full-language editions, docked write-ups, draggable isotope overlays, and full data coverage |

The app's navigation and outputs live in this repo. The reference site's store, social channels, lesson plans, and promotions are external content.
