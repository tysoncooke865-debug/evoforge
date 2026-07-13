# Generates client/src/domain/exercise-library-imported.ts from the public
# domain exercise dataset (873 exercises, name + primary muscles).
#
# The dataset's 17 muscle labels are mapped onto the app's OWN tag vocabulary
# (the 17 tags LIBRARY_SECTIONS already collapses into six gym-familiar
# sections) — a tag outside that vocabulary would render in no section and be
# unpickable, so the generator asserts every mapped tag is legal.
#
# "shoulders" and "chest" are split by NAME, because the dataset does not
# distinguish them and the app does: a lateral raise is not an overhead press,
# and an incline press is not a flat one.
import json, re, sys

RAW = "exercises_raw.json"
OUT = r"C:\Users\tyson\Downloads\Previous_Code\evoforge\client\src\domain\exercise-library-imported.ts"
CORE = r"C:\Users\tyson\Downloads\Previous_Code\evoforge\client\src\domain\exercise-library.ts"

# The app's legal tags (must match LIBRARY_SECTIONS in exercise-library.ts).
LEGAL = {
    "Chest", "Upper Chest", "Back Width", "Back Thickness", "Traps",
    "Side Delts", "Rear Delts", "Front Delts", "Biceps", "Triceps",
    "Forearms", "Quads", "Hamstrings", "Glutes", "Calves", "Adductors", "Abs",
}

SIMPLE = {
    "abdominals": "Abs",
    "hamstrings": "Hamstrings",
    "adductors": "Adductors",
    "abductors": "Adductors",
    "quadriceps": "Quads",
    "biceps": "Biceps",
    "triceps": "Triceps",
    "calves": "Calves",
    "glutes": "Glutes",
    "forearms": "Forearms",
    "lats": "Back Width",
    "middle back": "Back Thickness",
    "lower back": "Back Thickness",
    "traps": "Traps",
    "neck": "Traps",
}

REAR = re.compile(r"rear|reverse|face pull|bent[- ]over lateral|posterior", re.I)
SIDE = re.compile(r"lateral|side|upright row|egyptian", re.I)
INCLINE = re.compile(r"incline", re.I)


def muscle_for(name: str, primaries: list) -> str | None:
    if not primaries:
        return None
    p = primaries[0].lower()
    if p in SIMPLE:
        return SIMPLE[p]
    if p == "shoulders":
        if REAR.search(name):
            return "Rear Delts"
        if SIDE.search(name):
            return "Side Delts"
        return "Front Delts"
    if p == "chest":
        return "Upper Chest" if INCLINE.search(name) else "Chest"
    return None


def clean(name: str) -> str:
    n = " ".join(name.split()).strip()
    return n


def main():
    data = json.load(open(RAW, encoding="utf-8"))
    core_src = open(CORE, encoding="utf-8").read()
    core_names = set(re.findall(r"\{ name: '([^']+)'", core_src))
    core_lower = {n.lower() for n in core_names}

    seen = set(core_lower)
    rows = []
    skipped_dupe = 0
    skipped_nomuscle = 0

    for e in data:
        name = clean(e.get("name", ""))
        if len(name) < 2 or len(name) > 60:
            continue
        if "'" in name:
            name = name.replace("'", "’")  # keep the TS string literal safe
        key = name.lower()
        if key in seen:
            skipped_dupe += 1
            continue
        muscle = muscle_for(name, e.get("primaryMuscles", []))
        if muscle is None:
            skipped_nomuscle += 1
            continue
        assert muscle in LEGAL, f"illegal tag {muscle}"
        seen.add(key)
        rows.append((name, muscle))

    rows.sort(key=lambda r: (r[1], r[0]))

    header = f"""/**
 * GENERATED — do not hand-edit. Regenerate with the scratchpad script
 * (gen_library.py) over the public-domain exercise dataset
 * (github.com/yuhonas/free-exercise-db, Unlicense).
 *
 * {len(rows)} exercises the hand-curated core (exercise-library.ts) did not
 * already carry. EXACT-NAME DUPLICATES ARE EXCLUDED, case-insensitively: the
 * core's names win, because they are the ones DAY_PRESETS seeds and the ones
 * whose wording the substitution engine was tuned against.
 *
 * The dataset's muscle labels are mapped onto THIS APP'S tag vocabulary (the
 * 17 tags LIBRARY_SECTIONS collapses into six sections). A tag outside that
 * vocabulary would render in no section and be unpickable, so the generator
 * asserts every tag is legal and a test re-asserts it here.
 *
 * "shoulders" and "chest" are split by NAME because the dataset does not
 * distinguish what the app does: a lateral raise is not an overhead press,
 * and an incline press is not a flat one.
 */

/** Structurally a LibraryExercise — declared inline so the generated file
 *  imports nothing and cannot form a cycle with exercise-library.ts. */
export const IMPORTED_EXERCISES: readonly {{ name: string; muscle: string }}[] = [
"""
    body = "".join(f"  {{ name: '{n}', muscle: '{m}' }},\n" for n, m in rows)
    open(OUT, "w", encoding="utf-8", newline="\n").write(header + body + "];\n")

    from collections import Counter
    print(f"wrote {len(rows)} exercises")
    print(f"skipped {skipped_dupe} exact duplicates of the core, {skipped_nomuscle} with no usable muscle")
    print("by tag:", dict(Counter(m for _, m in rows).most_common()))


main()
