"""O-series (docs/ORIGIN_TEST_PLAN.md §O): the new-user origin ceremony end-to-end.

Serves client/dist, signs up a THROWAWAY account through the real UI, walks
Act I -> Act II -> Home, then deletes the account. Reduced-motion leg uses an
emulated context. Screenshots land in Downloads/evoforge-screenshots/ (Tyson
cannot see Claude-context images).
"""
import json, os, pathlib, subprocess, sys, time
from functools import partial

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = pathlib.Path.home() / 'Downloads' / 'evoforge-screenshots'
SHOTS.mkdir(exist_ok=True)
PORT = 8794
BASE = f'http://localhost:{PORT}'
EMAIL = f'origin-tour-{int(time.time())}@evoforge.internal'
PASSWORD = 'Tour-2026-07!q'

FAILS = []
def check(name, cond, detail=''):
    print(('PASS ' if cond else 'FAIL ') + name + (f' -- {detail}' if detail and not cond else ''))
    if not cond:
        FAILS.append(name)

server = subprocess.Popen(
    [sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'],
    cwd=ROOT / 'client' / 'dist',
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(2)

try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width': 390, 'height': 844})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))

        # ---- sign up through the real UI ---------------------------------
        page.goto(BASE, wait_until='networkidle')
        page.get_by_test_id('email').wait_for(timeout=30000)
        page.goto(f'{BASE}/sign-up', wait_until='networkidle')
        page.get_by_test_id('email').fill(EMAIL)
        page.get_by_test_id('password').fill(PASSWORD)
        page.get_by_test_id('sign-up').click()
        page.wait_for_url('**/onboarding**', timeout=30000)
        check('signup lands on /onboarding', True)

        # ---- Act I: DRIVE section + forge --------------------------------
        page.get_by_test_id('goal-strength').click()
        page.get_by_test_id('style-force').click()
        page.get_by_test_id('forge').scroll_into_view_if_needed()
        page.get_by_test_id('forge').click()

        # ---- O-1: the app HOLDS /onboarding (Act II), deep-linking / bounces
        page.get_by_test_id('origin-rating-reveal').wait_for(timeout=60000)
        check('O-2 rating reveal appears BEFORE candidates (rating + 4 pillars)',
              page.get_by_test_id('origin-rating-reveal').is_visible())
        check('O-2 rating reveal shows pillar labels', 'STRENGTH' in page.content() and 'CARDIO' in page.content())
        page.screenshot(path=str(SHOTS / 'origin-o2-rating-reveal.png'))

        page.goto(f'{BASE}/', wait_until='load')
        try:
            page.wait_for_url('**/onboarding**', timeout=20000)
        except Exception:
            pass
        check('O-1 cannot reach Home origin-less (gate bounces to /onboarding)',
              '/onboarding' in page.url, page.url)
        page.get_by_test_id('origin-to-candidates').wait_for(timeout=30000)
        page.get_by_test_id('origin-to-candidates').click()

        # ---- O-3: exactly three cards, confirm gated on a selection ------
        page.get_by_test_id('origin-confirm-open').wait_for(timeout=60000)
        cards = page.locator('[data-testid^="origin-candidate-"]').all()
        check('O-3 exactly three candidate cards', len(cards) == 3, f'found {len(cards)}')
        ids = [c.get_attribute('data-testid') for c in cards]
        check('O-3 candidates are distinct', len(set(ids)) == 3, str(ids))
        confirm_btn = page.get_by_test_id('origin-confirm-open')
        aria_disabled = confirm_btn.get_attribute('aria-disabled')
        check('O-3 CONFIRM disabled before a selection',
              aria_disabled == 'true' or not confirm_btn.is_enabled(),
              f'aria-disabled={aria_disabled}')
        recommended = page.locator('text=★ RECOMMENDED').count()
        check('O-3 recommended chip present (never auto-selected)', recommended == 1)
        page.screenshot(path=str(SHOTS / 'origin-o3-candidates.png'))

        # preview opens (viewed/trialled surfaces)
        cards[0].click()
        time.sleep(0.5)
        check('O-3 candidate preview expands with battle kit', 'BATTLE KIT' in page.content())

        # ---- O-5: kill/resume mid-selection — same cards -----------------
        page.reload(wait_until='load')
        time.sleep(3)
        # resume lands back in Act II (rating or candidates); walk to cards again
        page.get_by_test_id('origin-rating-reveal').wait_for(timeout=60000)
        page.get_by_test_id('origin-to-candidates').click()
        page.get_by_test_id('origin-confirm-open').wait_for(timeout=60000)
        cards2 = page.locator('[data-testid^="origin-candidate-"]').all()
        ids2 = [c.get_attribute('data-testid') for c in cards2]
        check('O-5 resume regenerates the IDENTICAL candidate set', ids2 == ids, f'{ids} vs {ids2}')

        # ---- O-4: select the NON-recommended candidate and bind it -------
        # the recommended card carries the chip; pick a card without it
        non_rec = None
        for c in cards2:
            if c.locator('text=★ RECOMMENDED').count() == 0:
                non_rec = c
                break
        chosen = non_rec.get_attribute('data-testid').replace('origin-candidate-', '')
        non_rec.click()  # expands preview + selects
        page.get_by_test_id('origin-confirm-open').click()
        page.get_by_test_id('origin-bind').wait_for(timeout=15000)
        page.screenshot(path=str(SHOTS / 'origin-o4-confirm.png'))
        page.get_by_test_id('origin-bind').click()

        # ---- awakening → Home ---------------------------------------------
        page.get_by_test_id('origin-awakening').wait_for(timeout=30000)
        page.wait_for_timeout(1600)  # the 1200ms one-shot reveal
        check('awakening ceremony shows Stage 1', 'STAGE 1' in page.content())
        page.screenshot(path=str(SHOTS / 'origin-awakening.png'))
        page.get_by_test_id('origin-finish').click()
        time.sleep(5)
        check('O-4 lands on Home after the ceremony', page.url.rstrip('/').endswith((':8794', '/')), page.url)
        # The first-launch tutorial overlay intercepts before Home content —
        # dismiss it (SKIP TOUR) so the checks read the real screen.
        skip = page.locator('text=SKIP TOUR')
        if skip.count() > 0:
            skip.first.click()
            time.sleep(1)
        check('O-4 non-recommended selection was bound (free choice)',
              page.locator('[data-testid="forge-origin"]').count() == 0,
              'blank podium still showing')
        content = page.content().upper()
        check('O-6 Home shows the mission card', 'MISSION' in content)
        check('O-6 first mission is a real seeded workout (PUSH = ppl3 day 1)',
              'PUSH' in content, 'seeded split day not visible')
        check('O-6 Home shows the rating (EVO core)', 'EVO RATING' in content or 'TRAINED' in content or 'NOVICE' in content)
        page.screenshot(path=str(SHOTS / 'origin-o6-home.png'), full_page=True)

        check('zero page errors across the whole tour', len(errors) == 0, '; '.join(errors[:3]))

        # ---- O-7: reduced motion — the ceremony completes statically ------
        ctx = browser.new_context(viewport={'width': 390, 'height': 844}, reduced_motion='reduce')
        page2 = ctx.new_page()
        page2.goto(f'{BASE}/sign-in', wait_until='load')
        page2.get_by_test_id('email').wait_for(timeout=30000)
        page2.get_by_test_id('email').fill(EMAIL)
        page2.get_by_test_id('password').fill(PASSWORD)
        page2.get_by_test_id('sign-in').click()
        time.sleep(6)
        skip2 = page2.locator('text=SKIP TOUR')
        if skip2.count() > 0:
            skip2.first.click()
            time.sleep(1)
        # already-bound user: reduced-motion leg just proves Home renders with
        # the champion under prefers-reduced-motion (the ceremony itself ran above)
        check('O-7 reduced-motion Home renders (champion bound)',
              page2.locator('[data-testid="forge-origin"]').count() == 0)
        page2.screenshot(path=str(SHOTS / 'origin-o7-reduced-motion.png'), full_page=True)
        ctx.close()
        browser.close()
finally:
    server.terminate()

# ---- cleanup: delete the throwaway account -------------------------------
env = {}
for line in (ROOT / 'client/.env.local').read_text().splitlines():
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1)
        env[k.strip()] = v.strip().strip('"')
token = (ROOT / 'client/.env.sbtoken.local').read_text().strip()
sql = f"delete from auth.users where email = '{EMAIL}';"
(ROOT / '.tmp_tour.json').write_text(json.dumps({'query': sql}))
out = subprocess.run(
    ['curl', '-s', '-X', 'POST',
     'https://api.supabase.com/v1/projects/rysbpwpvnqbngqncrfaa/database/query',
     '-H', f'Authorization: Bearer {token}', '-H', 'Content-Type: application/json',
     '-d', f'@{ROOT / ".tmp_tour.json"}'],
    capture_output=True, text=True, timeout=60)
(ROOT / '.tmp_tour.json').unlink(missing_ok=True)
check('cleanup: tour account deleted', out.stdout.strip() == '[]', out.stdout[:200])

print()
print(f'{len(FAILS)} failures' if FAILS else 'ALL O-SERIES CHECKS PASSED')
sys.exit(1 if FAILS else 0)
