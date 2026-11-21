"""Build the queryable data snapshots from independently sourced upstream data."""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import html
import io
import json
import re
import sqlite3
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
WHEEL_SHA = "76f415767b654634e51dead755513ef431abf200e892eab8468aa659ff218d1c"

SOURCES = {
    "iupac": ("IUPAC periodic table", "https://iupac.org/what-we-do/periodic-table-of-elements/"),
    "ciaaw": ("CIAAW standard atomic weights (2024)", "https://www.ciaaw.org/atomic-weights.htm"),
    "abridged": ("CIAAW abridged atomic weights (2024)", "https://www.ciaaw.org/abridged-atomic-weights.htm"),
    "radioactive": ("CIAAW radioactive elements", "https://ciaaw.org/radioactive-elements.htm"),
    "mendeleev": ("mendeleev 1.3.0", "https://mendeleev.readthedocs.io/en/stable/data.html"),
    "pubchem": ("PubChem element data", "https://pubchem.ncbi.nlm.nih.gov/periodic-table/"),
    "nist": ("NIST Atomic Spectra Database via mendeleev", "https://physics.nist.gov/PhysRefData/ASD/ionEnergy.html"),
    "pymatgen": ("pymatgen v2024.10.29 element data", "https://github.com/materialsproject/pymatgen/blob/v2024.10.29/src/pymatgen/core/periodic_table.json"),
    "media": ("Periodic-Table-JSON media index", "https://github.com/Bowserinator/Periodic-Table-JSON"),
    "extension": ("Pyykkö, proposed extended table (2011)", "https://doi.org/10.1039/C0CP01575J"),
    "helium": ("NIST helium fluid properties", "https://webbook.nist.gov/cgi/fluid.cgi?ID=C7440597&Action=Page"),
}

INPUTS = {
    "pubchem.csv": "https://pubchem.ncbi.nlm.nih.gov/rest/pug/periodictable/CSV",
    "ciaaw.html": SOURCES["ciaaw"][1],
    "abridged.html": SOURCES["abridged"][1],
    "radioactive.html": SOURCES["radioactive"][1],
    "images.json": "https://raw.githubusercontent.com/Bowserinator/Periodic-Table-JSON/master/PeriodicTableJSON.json",
    "mendeleev.json": "https://pypi.org/pypi/mendeleev/1.3.0/json",
    "pymatgen.json": "https://raw.githubusercontent.com/materialsproject/pymatgen/v2024.10.29/src/pymatgen/core/periodic_table.json",
    "PYMATGEN-LICENSE": "https://raw.githubusercontent.com/materialsproject/pymatgen/v2024.10.29/LICENSE",
}

# Column names, vocabulary, units and explicitly comparable conditions.
COLUMNS = [
    ("density", "Density at 295 K", "Physical", "g/cm³", "density", "295 K, as reported"),
    ("thermal", "Thermal conductivity", "Physical", "W/(m·K)", "thermal_conductivity", "25 °C"),
    ("specific-heat", "Specific heat capacity", "Physical", "J/(g·K)", "specific_heat_capacity", "25 °C, 1 bar"),
    ("fusion", "Enthalpy of fusion", "Physical", "kJ/mol", "fusion_heat", None),
    ("vaporization", "Enthalpy of vaporization", "Physical", "kJ/mol", "evaporation_heat", None),
    ("pauling", "Electronegativity · Pauling", "Atomic", "", "en_pauling", "Pauling scale"),
    ("allen", "Electronegativity · Allen", "Atomic", "", "en_allen", "Allen scale"),
    ("affinity", "Electron affinity", "Atomic", "eV", "electron_affinity", "Neutral gas-phase atom"),
    ("radius-slater", "Atomic radius · empirical", "Atomic", "pm", "atomic_radius", "Slater"),
    ("radius-rahm", "Atomic radius · calculated", "Atomic", "pm", "atomic_radius_rahm", "Rahm, Hoffmann and Ashcroft"),
    ("radius-covalent", "Covalent radius · single bond", "Atomic", "pm", "covalent_radius_pyykko", "Pyykkö"),
    ("radius-vdw", "Van der Waals radius", "Atomic", "pm", "vdw_radius", None),
    ("crust", "Abundance · Earth’s crust", "Abundance", "mg/kg", "abundance_crust", "Earth’s crust, mass basis"),
    ("seawater", "Abundance · seawater", "Abundance", "mg/kg", "abundance_sea", "Seawater, mass basis"),
    ("discovery", "Discovery year", "History", "CE", "discovery_year", "Negative years denote BCE; chronology follows the source"),
]

MATERIALS = [
    ("hardness-brinell", "Hardness · Brinell", "MPa", "Brinell hardness"),
    ("hardness-mohs", "Hardness · Mohs", "", "Mineral hardness"),
    ("hardness-vickers", "Hardness · Vickers", "MPa", "Vickers hardness"),
    ("modulus-bulk", "Modulus · bulk", "GPa", "Bulk modulus"),
    ("modulus-shear", "Modulus · shear", "GPa", "Rigidity modulus"),
    ("modulus-young", "Modulus · Young’s", "GPa", "Youngs modulus"),
    ("resistivity", "Electrical resistivity", "Ω·m", "Electrical resistivity"),
]

FAMILIES = {
    1: "Nonmetal", 2: "Noble gas", 3: "Alkali metal", 4: "Alkaline earth",
    5: "Metalloid", 6: "Halogen", 7: "Post-transition metal", 8: "Transition metal",
    9: "Lanthanide", 10: "Actinide",
}

HALF_LIFE_SECONDS = {
    "ysec": 1e-24, "zsec": 1e-21, "asec": 1e-18, "psec": 1e-12,
    "nsec": 1e-9, "usec": 1e-6, "msec": 1e-3, "sec": 1,
    "minute": 60, "hour": 3600, "day": 86400, "year": 31557600,
    **{p + "year": 31557600 * 10**e for p, e in zip("kMGTPEZY", range(3, 25, 3))},
}


def download(url):
    request = urllib.request.Request(url, headers={"User-Agent": "UnfinishedTable/0.1 (chemical data import)"})
    with urllib.request.urlopen(request, timeout=40) as response:
        return response.read()


def read_inputs(snapshots):
    snapshots.mkdir(exist_ok=True, parents=True)
    for filename, url in INPUTS.items():
        path = snapshots / filename
        if not path.exists():
            path.write_bytes(download(url))
    database = snapshots / "elements.db"
    if not database.exists():
        wheel = snapshots / "mendeleev.whl"
        if not wheel.exists():
            files = json.loads((snapshots / "mendeleev.json").read_text())["urls"]
            wheel.write_bytes(download(next(f["url"] for f in files if f["filename"].endswith(".whl"))))
        if hashlib.sha256(wheel.read_bytes()).hexdigest() != WHEEL_SHA:
            raise ValueError("mendeleev wheel digest differs from the pinned release")
        with zipfile.ZipFile(wheel) as release:
            for name in release.namelist():
                if name.endswith(("elements.db", "/LICENSE")):
                    (snapshots / Path(name).name).write_bytes(release.read(name))
    return database


def table_cells(markup):
    for tr in re.findall(r"<tr\b[^>]*>(.*?)</tr>", markup, re.I | re.S):
        yield [html.unescape(re.sub(r"<[^>]+>", "", cell)).strip()
               for cell in re.findall(r"<td\b[^>]*>(.*?)</td>", tr, re.I | re.S)]


def standard_weights(markup):
    weights = {}
    for row in table_cells(markup):
        if len(row) < 4 or not row[0].isdigit():
            continue
        z = int(row[0])
        value = re.sub(r"\s+", "", row[3])
        if match := re.fullmatch(r"\[([\d.]+),([\d.]+)\]", value):
            weights[z] = {"value": [float(part) for part in match.groups()], "range_kind": "natural interval", "reported": value}
        elif match := re.fullmatch(r"([\d.]+)\((\d+)\)", value):
            number, uncertainty = match.groups()
            places = len(number.partition(".")[2])
            weights[z] = {"value": float(number), "uncertainty": int(uncertainty) / 10**places, "reported": value}
    return weights


def abridged_weights(markup):
    return {
        int(row[0]): row[3].split("±")[0].strip()
        for row in table_cells(markup)
        if len(row) > 3 and row[0].isdigit() and "±" in row[3]
    }


def number_with_unit(value, unit):
    if not isinstance(value, str):
        return None
    match = re.fullmatch(r"\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s*(.*?)\s*", value)
    if match is None:
        return None
    number, symbol = match.groups()
    expected = {
        "MPa": {"MPa": 1, "MN m<sup>-2</sup>": 1}, "GPa": {"GPa": 1},
        "Ω·m": {"10<sup>-8</sup> &Omega; m": 1e-8, "10<sup>-8</sup> Ω m": 1e-8, "Ω m": 1},
        "": {"": 1},
    }
    factor = expected.get(unit, {}).get(symbol)
    return float(number) * factor if factor is not None else None


def dump_json(name, value):
    text = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    (DATA / name).write_text(text + "\n", encoding="utf-8")


def dump_rows(name, rows):
    lines = (json.dumps(row, ensure_ascii=False, allow_nan=False, separators=(",", ":")) for row in rows)
    payload = ("\n".join(lines) + "\n").encode("utf-8")
    (DATA / (name + ".gz")).write_bytes(gzip.compress(payload, mtime=0))


def build(snapshots):
    db = sqlite3.connect(f"file:{read_inputs(snapshots)}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    pub = {int(row["AtomicNumber"]): row for row in csv.DictReader(io.StringIO((snapshots / "pubchem.csv").read_text()))}
    weights = standard_weights((snapshots / "ciaaw.html").read_text())
    abridged = abridged_weights((snapshots / "abridged.html").read_text())
    radioisotopes = {
        int(row[0]): int(row[3]) for row in table_cells((snapshots / "radioactive.html").read_text())
        if len(row) >= 5 and row[0].isdigit() and row[3].isdigit()
    }
    images = {row["number"]: row.get("image") for row in json.loads((snapshots / "images.json").read_text())["elements"]}
    materials_path = snapshots / "pymatgen.json"
    materials = json.loads(materials_path.read_text()) if materials_path.exists() else {}
    metadata = {
        (row["table_name"], row["column_name"]): row["citation_keys"]
        for row in db.execute("SELECT * FROM propertymetadata") if row["citation_keys"]
    }
    properties = [
        {"id": key, "label": label, "group": group, "unit": unit}
        for key, label, group, unit, _, _ in COLUMNS
    ]
    properties.extend([
        {"id": key, "label": label, "group": group, "unit": unit}
        for key, label, group, unit in [
            ("z", "Atomic number", "Atomic", ""),
            ("weight", "Standard atomic weight", "Atomic", ""),
            ("melting", "Melting point", "Physical", "K"),
            ("boiling", "Boiling point", "Physical", "K"),
            ("sublimation", "Sublimation point", "Physical", "K"),
            ("ionization", "Ionization energy", "Atomic", "eV"),
            ("density-pubchem", "Density · PubChem", "Physical", "g/cm³"),
            ("configuration", "Electron configuration", "Electrons", ""),
            ("shells", "Electrons per shell", "Electrons", ""),
            ("oxidation", "Oxidation states", "Electrons", ""),
            ("mass-number", "Reference isotope mass number", "Atomic", ""),
        ]
    ])
    if materials:
        properties.extend({"id": key, "label": label, "group": "Materials", "unit": unit}
                          for key, label, unit, _ in MATERIALS)
        properties.append({"id": "conductivity", "label": "Electrical conductivity", "group": "Materials", "unit": "S/m"})
    elements, facts, phases, media = [], [], {}, {}
    units = {prop["id"]: prop["unit"] for prop in properties}

    def add(z, key, value, source, *, variant=None, conditions=None, status="reported", **extra):
        if value is None or value == "":
            return
        record = {
            "id": ":".join(str(part) for part in (z, key, source, variant) if part is not None),
            "z": z, "property": key, "value": value, "unit": units[key],
            "status": status, "source": source,
        }
        for name, field in [("variant", variant), ("conditions", conditions), *extra.items()]:
            if field is not None:
                record[name] = field
        facts.append(record)

    for row in db.execute("SELECT * FROM elements ORDER BY atomic_number"):
        z, symbol, name = row["atomic_number"], row["symbol"], row["name"]
        pub_row = pub[z]
        if pub_row["Symbol"] != symbol:
            raise ValueError(f"Element symbol differs across imports at Z={z}")
        image = images.get(z)
        if image and image.get("url", "").startswith("https://") and image["title"] != "No Image Found":
            credit = image.get("attribution", "")
            if re.search(r"CC[ -]BY|CC0|public domain|Creative Commons Attribution", credit, re.I):
                media[z] = {"url": image["url"], "caption": image["title"], "credit": credit}
        family = FAMILIES[row["series_id"]]
        reference_mass = radioisotopes.get(z) if z not in weights else None
        identity = {
            "z": z, "symbol": symbol, "name": name, "period": row["period"],
            "group": row["group_id"], "block": row["block"], "family": family,
            "weightLabel": abridged.get(z) or (f"[{reference_mass}]" if reference_mass else "??"),
            "nameOrigin": row["name_origin"], "discoveryLocation": row["discovery_location"],
            "discoverers": row["discoverers"], "cas": row["cas"],
            "aliases": {"13": ["Aluminum"], "16": ["Sulphur"], "55": ["Cesium"], "74": ["Wolfram"]}.get(str(z), []),
        }
        elements.append(identity)
        add(z, "z", z, "iupac", status="accepted")
        weight = weights.get(z)
        if weight:
            add(z, "weight", weight["value"], "ciaaw", status="recommended",
                conditions="Normal terrestrial materials", **{key: value for key, value in weight.items() if key != "value"})
        add(z, "mass-number", reference_mass, "radioactive", conditions="First reference isotope listed by CIAAW for this element")
        for key, _, _, _, column, conditions in COLUMNS:
            value = row[column]
            # Densities for the short-lived transactinides need explicit evidence.
            if z >= 104 and key == "density":
                continue
            add(z, key, value, "mendeleev", conditions=conditions,
                reference=metadata.get(("elements", column)), status="calculated" if key == "radius-rahm" else "reported")
        config = row["electronic_configuration"]
        add(z, "configuration", config, "mendeleev", conditions="Neutral atom, ground state",
            reference=metadata.get(("elements", "electronic_configuration")), status="predicted" if z >= 108 else "reported")
        states = [r[0] for r in db.execute("SELECT DISTINCT oxidation_state FROM oxidationstates WHERE atomic_number = ? ORDER BY oxidation_state", (z,))]
        add(z, "oxidation", states or None, "mendeleev", status="predicted" if z >= 109 else "reported")
        alternate_density = pub_row.get("Density", "")
        if alternate_density and z < 104:
            add(z, "density-pubchem", float(alternate_density), "pubchem", conditions="See the linked element page for conditions")
        for key, _, unit, column in MATERIALS:
            value = number_with_unit(materials.get(symbol, {}).get(column), unit)
            add(z, key, value, "pymatgen", conditions="Conditions depend on the source measurement")
            if key == "resistivity" and value and value > 0:
                add(z, "conductivity", 1 / value, "pymatgen", status="calculated", conditions="Reciprocal of reported resistivity")
        transitions = list(db.execute("SELECT * FROM phasetransitions WHERE atomic_number = ? ORDER BY id", (z,)))
        for transition in transitions:
            allotrope = transition["allotrope"]
            variant = str(transition["id"])
            context = f"{allotrope.capitalize()} allotrope" if allotrope else "Elemental substance"
            if transition["is_transition"]:
                context += "; solid-phase transition (source assignment)"
            if z >= 104:
                confidence = "reported; verification needed"
            else:
                confidence = "reported"
            add(z, "melting", transition["melting_point"], "mendeleev", variant=variant, conditions=context,
                status=confidence, reference=metadata.get(("phasetransitions", "melting_point")))
            key = "sublimation" if transition["is_sublimation_point"] else "boiling"
            add(z, key, transition["boiling_point"], "mendeleev", variant=variant, conditions=context,
                status=confidence, reference=metadata.get(("phasetransitions", "boiling_point")))
        candidates = [t for t in transitions if not t["is_transition"]]
        if candidates and z < 104:
            t = candidates[0]
            phases[z] = {
                "melting": t["melting_point"], "boiling": t["boiling_point"],
                "sublimes": bool(t["is_sublimation_point"]), "form": t["allotrope"],
                "source": "mendeleev",
            }
        for ion in db.execute("SELECT * FROM ionizationenergies WHERE atomic_number = ? AND ion_charge < 30 ORDER BY ion_charge", (z,)):
            status = "predicted" if ion["is_theoretical"] else "estimated" if ion["is_semi_empirical"] else "reported"
            add(z, "ionization", ion["ionization_energy"], "nist", variant=1 + ion["ion_charge"],
                conditions=f"Initial ion charge +{ion['ion_charge']}", uncertainty=ion["uncertainty"],
                reference=ion["references"], status=status)

    isotopes = []
    decays = {}
    for decay in db.execute("SELECT * FROM isotopedecaymodes ORDER BY isotope_id, intensity DESC"):
        decays.setdefault(decay["isotope_id"], []).append({
            "mode": decay["mode"], "intensity": decay["intensity"],
            "relation": decay["relation"], "unobserved": bool(decay["is_allowed_not_observed"]),
        })
    for row in db.execute("SELECT * FROM isotopes ORDER BY atomic_number, mass_number"):
        value, unit = row["half_life"], row["half_life_unit"]
        duration = value * HALF_LIFE_SECONDS[unit] if value is not None and unit in HALF_LIFE_SECONDS else None
        isotope = {
            "z": row["atomic_number"], "a": row["mass_number"], "mass": row["mass"],
            "massUncertainty": row["mass_uncertainty"], "abundance": row["abundance"],
            "abundanceUncertainty": row["abundance_uncertainty"], "seconds": duration,
            "halfLife": value, "halfLifeUnit": unit, "halfLifeUncertainty": row["half_life_uncertainty"],
            "stable": row["is_radioactive"] == 0, "spin": row["spin"], "parity": row["parity"],
            "g": row["g_factor"], "gUncertainty": row["g_factor_uncertainty"],
            "quadrupole": row["quadrupole_moment"], "quadrupoleUncertainty": row["quadrupole_moment_uncertainty"],
            "decays": decays.get(row["id"]), "source": "mendeleev",
        }
        isotopes.append({key: value for key, value in isotope.items() if value is not None})

    DATA.mkdir(exist_ok=True)
    dump_json("catalog.json", {
        "elements": elements, "properties": properties, "sources": SOURCES,
        "phases": phases, "media": media,
        "candidates": [
            {"z": 119, "period": 8, "group": 1, "source": "extension"},
            {"z": 120, "period": 8, "group": 2, "source": "extension"},
        ],
        "datasets": {"mendeleev": "1.3.0", "ciaaw": "Standard and Abridged Standard Atomic Weights 2024"},
    })
    dump_rows("facts.ndjson", facts)
    dump_rows("isotopes.ndjson", isotopes)
    for name in ["LICENSE", "PYMATGEN-LICENSE"]:
        if (snapshots / name).exists():
            target = "MENDELEEV-LICENSE.txt" if name == "LICENSE" else name + ".txt"
            (DATA / target).write_bytes((snapshots / name).read_bytes())
    if len(elements) != 118 or len({fact["id"] for fact in facts}) != len(facts) or len(weights) < 80:
        raise ValueError("Data validation failed")
    print(f"Built {len(elements)} elements, {len(facts)} fact records and {len(isotopes)} isotopes.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshots", type=Path, default=ROOT.parent / "periodic-research")
    build(parser.parse_args().snapshots.resolve())
