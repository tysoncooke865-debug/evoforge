"""Golden replay: SQL origin_candidates_compute must reproduce every TS fixture."""
import json, pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
token = (ROOT / 'client/.env.sbtoken.local').read_text().strip()
fixtures = json.loads((ROOT / 'contracts/fixtures/origin_candidates.json').read_text())

cases = fixtures['cases']
inputs = [c['input'] for c in cases.values()]
query = (
    "select jsonb_agg(origin_candidates_compute(value) order by ord) "
    "from jsonb_array_elements($in$" + json.dumps(inputs) + "$in$::jsonb) "
    "with ordinality as t(value, ord)"
)
(ROOT / '.tmp_replay.json').write_text(json.dumps({'query': query}))
r = subprocess.run(
    ['bash', '-c',
     f'curl -s -X POST "https://api.supabase.com/v1/projects/rysbpwpvnqbngqncrfaa/database/query" '
     f'-H "Authorization: Bearer {token}" -H "Content-Type: application/json" '
     f'-d @"{ROOT / ".tmp_replay.json"}"'],
    capture_output=True, text=True, timeout=180)
(ROOT / '.tmp_replay.json').unlink()
resp = r.stdout
if not resp.startswith('['):
    print('SQL ERROR:', resp[:500]); sys.exit(1)
rows = json.loads(resp)
results = rows[0]['jsonb_agg']

def norm(o):
    if isinstance(o, dict):
        return {k: norm(v) for k, v in o.items()}
    if isinstance(o, list):
        return [norm(v) for v in o]
    if isinstance(o, (int, float)) and not isinstance(o, bool):
        return round(float(o), 6)
    return o

fails = 0
for (name, case), got in zip(cases.items(), results):
    exp = norm(case['expected'])
    gotn = norm(got)
    if exp != gotn:
        fails += 1
        print(f'MISMATCH {name}:')
        for k in exp:
            if exp[k] != gotn.get(k):
                print(f'  {k}: expected={json.dumps(exp[k])[:200]} got={json.dumps(gotn.get(k))[:200]}')
print(f'{len(cases) - fails}/{len(cases)} golden cases match the SQL twin')
sys.exit(1 if fails else 0)
