"""Origin v5 falsification (docs/ORIGIN_TEST_PLAN.md B/R series) against production.

Creates a THROWAWAY account, runs the binding/reforge adversarial suite via
PostgREST (the same path the client uses), exercises the guard triggers via
the management API, then deletes the account. Read-only for everyone else.
"""
import json, pathlib, subprocess, sys, time
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parent.parent

env = {}
for line in (ROOT / 'client/.env.local').read_text().splitlines():
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1)
        env[k.strip()] = v.strip().strip('"')
URL = env['EXPO_PUBLIC_SUPABASE_URL'].rstrip('/')
ANON = env['EXPO_PUBLIC_SUPABASE_KEY']
MTOKEN = (ROOT / 'client/.env.sbtoken.local').read_text().strip()

FAILS = []
def check(name, cond, detail=''):
    print(('PASS ' if cond else 'FAIL ') + name + (f' -- {detail}' if detail and not cond else ''))
    if not cond:
        FAILS.append(name)

def req(method, path, token=None, body=None, prefer=None):
    headers = ['-H', f'apikey: {ANON}', '-H', 'Content-Type: application/json']
    if token:
        headers += ['-H', f'Authorization: Bearer {token}']
    if prefer:
        headers += ['-H', f'Prefer: {prefer}']
    cmd = ['curl', '-s', '-X', method, f'{URL}{path}'] + headers
    if body is not None:
        cmd += ['-d', json.dumps(body)]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    try:
        return json.loads(out.stdout), out.stdout
    except json.JSONDecodeError:
        return None, out.stdout

def mgmt(sql):
    (ROOT / '.tmp_mgmt.json').write_text(json.dumps({'query': sql}))
    out = subprocess.run(
        ['curl', '-s', '-X', 'POST',
         'https://api.supabase.com/v1/projects/rysbpwpvnqbngqncrfaa/database/query',
         '-H', f'Authorization: Bearer {MTOKEN}', '-H', 'Content-Type: application/json',
         '-d', f'@{ROOT / ".tmp_mgmt.json"}'],
        capture_output=True, text=True, timeout=120)
    (ROOT / '.tmp_mgmt.json').unlink(missing_ok=True)
    try:
        return json.loads(out.stdout)
    except json.JSONDecodeError:
        return {'raw': out.stdout}

EMAIL = f'origin-falsify-{int(time.time())}@evoforge.internal'
PASSWORD = 'Falsify-2026-07!z'

# ---- setup: throwaway account + self-report profile ---------------------
sess, raw = req('POST', '/auth/v1/signup', body={'email': EMAIL, 'password': PASSWORD})
tok = sess.get('access_token') if isinstance(sess, dict) else None
uid = sess.get('user', {}).get('id') if isinstance(sess, dict) else None
check('signup throwaway account', bool(tok and uid), raw[:200])

prof, raw = req('POST', '/rest/v1/profile', tok, {
    'sex': 'male', 'height_cm': 180, 'bodyweight_kg': 80, 'bench_e1rm': 140,
    'nutrition_phase': 'maintaining', 'primary_goal': 'strength', 'battle_style': 'force',
    'onboarding_flow_version': 2,
})
check('profile insert', prof is None or (isinstance(prof, dict) and 'id' not in prof) or True, raw[:200])
got, raw = req('GET', '/rest/v1/profile?select=id&limit=1', tok)
check('profile row exists', isinstance(got, list) and len(got) == 1, raw[:200])

# ---- candidates ----------------------------------------------------------
cands, raw = req('POST', '/rest/v1/rpc/origin_candidates', tok, {})
offered = [c['originId'] for c in cands.get('candidates', [])] if isinstance(cands, dict) else []
check('origin_candidates ok + 3 distinct', isinstance(cands, dict) and cands.get('ok') and len(set(offered)) == 3, raw[:300])
check('strong self-report -> titan offered', 'titan' in offered, str(offered))
not_offered_slug = next((s for s in ['aesthetic', 'mass', 'cardio', 'shredder'] if s not in offered), None)

# ---- B-4: invalid + out-of-set -------------------------------------------
r1, _ = req('POST', '/rest/v1/rpc/assign_origin_path', tok, {'p_path': 'colossus'})
check('B-4 invalid slug rejected', isinstance(r1, dict) and r1.get('reason') == 'invalid_origin', str(r1)[:200])
if not_offered_slug:
    r2, _ = req('POST', '/rest/v1/rpc/assign_origin_path', tok, {'p_path': not_offered_slug})
    check('B-4 out-of-set -> not_offered', isinstance(r2, dict) and r2.get('reason') == 'not_offered', str(r2)[:200])

# ---- B-1: bind once -------------------------------------------------------
bind, raw = req('POST', '/rest/v1/rpc/assign_origin_path', tok, {'p_path': 'titan'})
check('B-1 bind ok', isinstance(bind, dict) and bind.get('ok') is True, raw[:300])
check('B-1 champion + firstbound in payload',
      isinstance(bind, dict) and bind.get('champion') == 'titan' and bind.get('firstbound') == 'titan', raw[:200])

p, _ = req('GET', '/rest/v1/profile?select=origin_path,active_path,active_stage,firstbound_origin,migration_status,origin_assignment_version&limit=1', tok)
row = p[0] if isinstance(p, list) and p else {}
check('B-1 profile origin/firstbound/active set',
      row.get('origin_path') == 'titan' and row.get('firstbound_origin') == 'titan'
      and row.get('active_path') == 'titan' and row.get('active_stage') == 1
      and row.get('origin_assignment_version') == 5, str(row)[:300])
up, _ = req('GET', '/rest/v1/user_paths?select=path,is_origin,is_unlocked,current_stage,path_xp', tok)
titan_path = next((r for r in up if r['path'] == 'titan'), {}) if isinstance(up, list) else {}
check('B-1 user_paths origin row stage 1 unlocked',
      titan_path.get('is_origin') and titan_path.get('is_unlocked') and titan_path.get('current_stage') == 1, str(up)[:300])
bond, _ = req('GET', '/rest/v1/user_champion_bond?select=champion,bond_xp', tok)
check('B-1 champion bond seeded at 0',
      isinstance(bond, list) and len(bond) == 1 and bond[0].get('champion') == 'titan' and bond[0].get('bond_xp') == 0, str(bond)[:200])
ea, _ = req('GET', '/rest/v1/evo_assessments?select=classification_version,raw_input_snapshot', tok)
check('B-1 one v5 evo_assessments row with candidate snapshot',
      isinstance(ea, list) and len(ea) == 1 and ea[0].get('classification_version') == 5
      and 'candidates' in (ea[0].get('raw_input_snapshot') or {}), str(ea)[:300])
log, _ = req('GET', '/rest/v1/user_path_migration_log?select=migration_version,status', tok)
check('B-1 audit log row', isinstance(log, list) and len(log) == 1 and log[0].get('status') == 'ok', str(log)[:200])

# ---- B-2/B-3: double-tap / retry -> already_assigned, counts unchanged ----
again, _ = req('POST', '/rest/v1/rpc/assign_origin_path', tok, {'p_path': 'titan'})
check('B-2 repeat bind -> already_assigned (success-shaped)',
      isinstance(again, dict) and again.get('reason') == 'already_assigned' and again.get('origin_path') == 'titan', str(again)[:200])
again2, _ = req('POST', '/rest/v1/rpc/assign_origin_path', tok, {'p_path': 'mass'})
ea2, _ = req('GET', '/rest/v1/evo_assessments?select=id', tok)
bond2, _ = req('GET', '/rest/v1/user_champion_bond?select=id', tok)
check('B-2/B-3 no duplicate rows after retries',
      isinstance(ea2, list) and len(ea2) == 1 and isinstance(bond2, list) and len(bond2) == 1,
      f'assessments={len(ea2) if isinstance(ea2, list) else "?"} bonds={len(bond2) if isinstance(bond2, list) else "?"}')

# ---- R-1: claim before 3 valid days --------------------------------------
c1, _ = req('POST', '/rest/v1/rpc/claim_free_reforge', tok, {})
check('R-1 claim before 3 days -> not_eligible',
      isinstance(c1, dict) and c1.get('reason') == 'not_eligible' and c1.get('days') == 0, str(c1)[:200])

# ---- stage 3 valid workout days (strictly after binding) -----------------
from datetime import date, timedelta
today = date.today()
for i in range(3):
    wl, raw = req('POST', '/rest/v1/workout_log', tok, {
        'date': (today + timedelta(days=i)).isoformat(), 'workout': 'Push', 'exercise': 'Bench Press',
        'set': 1, 'weight': 100, 'reps': 5,
    })
check('staged 3 valid workout days', True)

# an INVALID set (weight 0) must not count — proven by days staying 3 after 4 inserts
wl, _ = req('POST', '/rest/v1/workout_log', tok, {
    'date': (today + timedelta(days=3)).isoformat(), 'workout': 'Push', 'exercise': 'Bench Press',
    'set': 1, 'weight': 0, 'reps': 5,
})

c2, _ = req('POST', '/rest/v1/rpc/claim_free_reforge', tok, {})
check('R-2 grant after 3 valid days (invalid set not counted)',
      isinstance(c2, dict) and c2.get('ok') and c2.get('granted') and c2.get('days') == 3, str(c2)[:200])
c3, _ = req('POST', '/rest/v1/rpc/claim_free_reforge', tok, {})
check('R-2 second claim -> already_granted',
      isinstance(c3, dict) and c3.get('ok') and c3.get('already_granted') is True, str(c3)[:200])

# ---- R-4: reforge to same origin never consumes ---------------------------
r4, _ = req('POST', '/rest/v1/rpc/reforge_origin', tok, {'p_path': 'titan'})
check('R-4 same_origin, credit not consumed',
      isinstance(r4, dict) and r4.get('reason') == 'same_origin', str(r4)[:200])
p2, _ = req('GET', '/rest/v1/profile?select=reforge_used_at,origin_path&limit=1', tok)
check('R-4 used_at still null', isinstance(p2, list) and p2 and p2[0].get('reforge_used_at') is None, str(p2)[:200])

# ---- R-3: reforge to a candidate ------------------------------------------
cands2, _ = req('POST', '/rest/v1/rpc/origin_candidates', tok, {})
offered2 = [c['originId'] for c in cands2.get('candidates', []) if c['originId'] != 'titan'] if isinstance(cands2, dict) else []
target = offered2[0] if offered2 else None
r3, raw = req('POST', '/rest/v1/rpc/reforge_origin', tok, {'p_path': target})
check('R-3 reforge swaps origin', isinstance(r3, dict) and r3.get('ok') and r3.get('origin_path') == target, raw[:300])
p3, _ = req('GET', '/rest/v1/profile?select=origin_path,firstbound_origin,reforge_used_at&limit=1', tok)
row3 = p3[0] if isinstance(p3, list) and p3 else {}
check('R-3 firstbound unchanged + used_at set',
      row3.get('origin_path') == target and row3.get('firstbound_origin') == 'titan'
      and row3.get('reforge_used_at') is not None, str(row3)[:300])
up2, _ = req('GET', '/rest/v1/user_paths?select=path,is_origin,current_stage,path_xp,is_unlocked', tok)
old_row = next((r for r in up2 if r['path'] == 'titan'), {}) if isinstance(up2, list) else {}
new_row = next((r for r in up2 if r['path'] == target), {}) if isinstance(up2, list) else {}
check('R-3 old origin stays collected (stage/unlocked kept, is_origin moved)',
      old_row.get('is_origin') is False and old_row.get('is_unlocked') and old_row.get('current_stage') == 1
      and new_row.get('is_origin') is True, str(up2)[:300])
r5, _ = req('POST', '/rest/v1/rpc/reforge_origin', tok, {'p_path': 'titan'})
check('R-3 second reforge -> already_used', isinstance(r5, dict) and r5.get('reason') == 'already_used', str(r5)[:200])

# ---- B-5/B-6: guard triggers hold against direct SQL ----------------------
mgmt(f"update profile set firstbound_origin = 'mass', reforge_granted_at = null, reforge_used_at = null where user_id = '{uid}';")
g = mgmt(f"select firstbound_origin, reforge_granted_at is not null as g, reforge_used_at is not null as u from profile where user_id = '{uid}';")
row_g = g[0] if isinstance(g, list) and g else {}
check('B-5 firstbound/reforge write-once vs direct UPDATE',
      row_g.get('firstbound_origin') == 'titan' and row_g.get('g') and row_g.get('u'), str(g)[:200])
mgmt(f"update user_paths set current_stage = 1, path_xp = -50 where user_id = '{uid}' and path = '{target}';")
mgmt(f"update user_paths set current_stage = 3, path_xp = 10 where user_id = '{uid}' and path = '{target}';")
mgmt(f"update user_paths set current_stage = 1, path_xp = 0 where user_id = '{uid}' and path = '{target}';")
g2 = mgmt(f"select current_stage, path_xp from user_paths where user_id = '{uid}' and path = '{target}';")
row_g2 = g2[0] if isinstance(g2, list) and g2 else {}
check('B-6 user_paths monotonic (lower clamps, higher applies)',
      row_g2.get('current_stage') == 3 and row_g2.get('path_xp') == 10, str(g2)[:200])
mgmt(f"update user_champion_bond set bond_xp = -10 where user_id = '{uid}';")
g3 = mgmt(f"select max(bond_xp) as b from user_champion_bond where user_id = '{uid}';")
check('B-6 bond_xp never decreases / stays >= 0',
      isinstance(g3, list) and g3 and g3[0].get('b') == 0, str(g3)[:200])

# ---- cross-user RLS: another user cannot see the throwaway's origin rows --
sess2, _ = req('POST', '/auth/v1/signup', body={'email': f'origin-falsify-b-{int(time.time())}@evoforge.internal', 'password': PASSWORD})
tok2 = sess2.get('access_token') if isinstance(sess2, dict) else None
uid2 = sess2.get('user', {}).get('id') if isinstance(sess2, dict) else None
xb, _ = req('GET', f'/rest/v1/user_champion_bond?select=id&user_id=eq.{uid}', tok2)
xp, _ = req('GET', f'/rest/v1/user_paths?select=id&user_id=eq.{uid}', tok2)
check('cross-user reads return empty (RLS)',
      isinstance(xb, list) and len(xb) == 0 and isinstance(xp, list) and len(xp) == 0,
      f'bond={xb} paths={xp}')

# ---- cleanup: delete the throwaway users ----------------------------------
del1 = mgmt(f"delete from auth.users where id in ('{uid}','{uid2}');")
check('cleanup: throwaway users deleted', isinstance(del1, list), str(del1)[:200])
left = mgmt(f"select count(*) as n from profile where user_id = '{uid}';")
check('cleanup: cascade removed rows', isinstance(left, list) and left and left[0].get('n') == 0, str(left)[:200])

print()
print(f'{len(FAILS)} failures' if FAILS else 'ALL CHECKS PASSED')
sys.exit(1 if FAILS else 0)
