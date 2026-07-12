"""Screenshot the animation tester: idle, then trigger kick and special."""
import pathlib
import sys

from playwright.sync_api import sync_playwright

here = pathlib.Path(__file__).parent
url = (here / "index.html").as_uri()

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1100, "height": 1000})
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.goto(url)
    pg.wait_for_timeout(900)
    pg.screenshot(path=str(here / "shot_idle.png"))

    pg.get_by_role("button", name="KICK").click()
    pg.wait_for_timeout(160)
    pg.screenshot(path=str(here / "shot_kick.png"), clip={"x": 60, "y": 120, "width": 980, "height": 560})

    pg.get_by_role("button", name="SPECIAL").click()
    pg.wait_for_timeout(380)  # cast frames pass, projectile in flight
    pg.screenshot(path=str(here / "shot_special.png"), clip={"x": 60, "y": 120, "width": 980, "height": 560})

    # keyboard: run right
    pg.keyboard.down("Shift")
    pg.keyboard.down("ArrowRight")
    pg.wait_for_timeout(450)
    pg.screenshot(path=str(here / "shot_run.png"), clip={"x": 60, "y": 120, "width": 980, "height": 560})
    b.close()

if errors:
    print("PAGE ERRORS:")
    for e in errors:
        print(" ", e)
    sys.exit(1)
print("OK — no page errors, 4 screenshots saved")
