# Regenerates client/src/domain/exercise-library-imported.ts with the FULL
# taxonomy the Add Exercise redesign needs — not just name + muscle.
#
# The source dataset (yuhonas/free-exercise-db, Unlicense) already carries
# equipment, mechanic (compound/isolation), level (difficulty), force
# (push/pull/static) and secondary muscles. We were throwing all of it away.
#
# Muscle labels map onto the app's OWN 17-tag vocabulary (unchanged — the
# picker's sections, the heat map and every logged row depend on it).
import json, re
from collections import Counter

RAW = "exercises_raw.json"
OUT = r"C:\Users\tyson\Downloads\Previous_Code\evoforge\client\src\domain\exercise-library-imported.ts"
CORE = r"C:\Users\tyson\Downloads\Previous_Code\evoforge\client\src\domain\exercise-library.ts"

LEGAL = {
    "Chest", "Upper Chest", "Back Width", "Back Thickness", "Traps",
    "Side Delts", "Rear Delts", "Front Delts", "Biceps", "Triceps",
    "Forearms", "Quads", "Hamstrings", "Glutes", "Calves", "Adductors", "Abs",
}

SIMPLE = {
    "abdominals": "Abs", "hamstrings": "Hamstrings", "adductors": "Adductors",
    "abductors": "Adductors", "quadriceps": "Quads", "biceps": "Biceps",
    "triceps": "Triceps", "calves": "Calves", "glutes": "Glutes",
    "forearms": "Forearms", "lats": "Back Width", "middle back": "Back Thickness",
    "lower back": "Back Thickness", "traps": "Traps", "neck": "Traps",
}

REAR = re.compile(r"rear|reverse|face pull|bent[- ]over lateral|posterior", re.I)
SIDE = re.compile(r"lateral|side|upright row|egyptian", re.I)
INCLINE = re.compile(r"incline", re.I)

# The dataset's equipment strings -> the app's equipment vocabulary.
EQUIP = {
    "barbell": "Barbell",
    "dumbbell": "Dumbbell",
    "cable": "Cable",
    "machine": "Machine",
    "body only": "Bodyweight",
    "bands": "Band",
    "kettlebells": "Kettlebell",
    "e-z curl bar": "EZ Bar",
    "medicine ball": "Other",
    "exercise ball": "Other",
    "foam roll": "Other",
    "other": "Other",
    None: "Other",
}


def muscle_for(name, primaries):
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


def secondaries_for(name, secs):
    out = []
    for s in secs or []:
        m = muscle_for(name, [s])
        if m and m not in out:
            out.append(m)
    return out


# Popularity: the dataset has no score, so derive an honest one from how
# canonical a movement is. Compound beginner barbell/dumbbell basics are what
# most people log; obscure variations are not. This only ever BREAKS TIES —
# nothing is hidden by it.
POPULAR = re.compile(
    r"^(barbell |dumbbell |cable |machine )?(bench press|squat|deadlift|overhead press|"
    r"pull-?up|chin-?up|row|lat pulldown|curl|dip|lunge|press|fly|raise|extension|pushdown|"
    r"leg press|calf raise|crunch|plank|hip thrust)",
    re.I,
)


def popularity(name, mechanic, level):
    score = 50
    if mechanic == "compound":
        score += 20
    if level == "beginner":
        score += 15
    elif level == "expert":
        score -= 10
    if POPULAR.search(name):
        score += 15
    # Long, qualifier-heavy names are variations, not staples.
    score -= max(0, len(name.split()) - 3) * 3
    return max(1, min(100, score))


def main():
    data = json.load(open(RAW, encoding="utf-8"))
    core_src = open(CORE, encoding="utf-8").read()
    core_lower = {n.lower() for n in re.findall(r"\{ name: '([^']+)'", core_src)}

    seen = set(core_lower)
    rows = []
    for e in data:
        name = " ".join(e.get("name", "").split()).strip().replace("'", "’")
        if not (2 <= len(name) <= 60) or name.lower() in seen:
            continue
        muscle = muscle_for(name, e.get("primaryMuscles", []))
        if muscle is None:
            continue
        assert muscle in LEGAL
        seen.add(name.lower())
        equip = EQUIP.get(e.get("equipment"), "Other")
        mech = (e.get("mechanic") or "").lower()
        level = (e.get("level") or "").lower()
        category = "Compound" if mech == "compound" else "Isolation" if mech == "isolation" else "Other"
        difficulty = {"beginner": "Beginner", "intermediate": "Intermediate", "expert": "Advanced"}.get(level, "Intermediate")
        secs = secondaries_for(name, e.get("secondaryMuscles"))
        rows.append({
            "name": name, "muscle": muscle, "equipment": equip,
            "category": category, "difficulty": difficulty,
            "secondary": secs, "popularity": popularity(name, mech, level),
        })

    rows.sort(key=lambda r: (r["muscle"], r["name"]))

    header = f"""/**
 * GENERATED — do not hand-edit. Regenerate with tools/gen_exercise_library.py
 * over the public-domain dataset (github.com/yuhonas/free-exercise-db,
 * Unlicense).
 *
 * {len(rows)} exercises the curated core does not already carry, with the FULL
 * taxonomy the Add Exercise menu needs: equipment, category, difficulty,
 * secondary muscles and a popularity score.
 *
 * EXACT-NAME DUPLICATES OF THE CORE ARE EXCLUDED (case-insensitively) — the
 * core's names win, because they are what DAY_PRESETS seeds and what the
 * substitution engine was tuned against.
 *
 * Muscle tags are the app's OWN 17-tag vocabulary. Popularity is DERIVED
 * (compound + beginner + canonical-movement + short-name), because the dataset
 * has no score; it only ever BREAKS TIES in ranking — it hides nothing.
 */

import type {{ LibraryExercise }} from './exercise-taxonomy';

export const IMPORTED_EXERCISES: readonly LibraryExercise[] = [
"""
    def fmt(r):
        secs = "".join(f"'{s}', " for s in r["secondary"])
        secs = f"[{secs.rstrip(', ')}]" if r["secondary"] else "[]"
        return (
            f"  {{ name: '{r['name']}', muscle: '{r['muscle']}', equipment: '{r['equipment']}', "
            f"category: '{r['category']}', difficulty: '{r['difficulty']}', "
            f"secondary: {secs}, popularity: {r['popularity']} }},\n"
        )

    open(OUT, "w", encoding="utf-8", newline="\n").write(header + "".join(fmt(r) for r in rows) + "];\n")
    print(f"wrote {len(rows)} exercises")
    print("equipment:", dict(Counter(r["equipment"] for r in rows).most_common()))
    print("category:", dict(Counter(r["category"] for r in rows).most_common()))
    print("difficulty:", dict(Counter(r["difficulty"] for r in rows).most_common()))


main()
