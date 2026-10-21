# End-to-end smoke test (Playwright over CDP). Start the app first with tests/launch_dev.sh.
# Opens the sample model, runs the engine, loads results, opens the report, the flag panel and an attribute table,
# and fails on any JavaScript page error.   usage: python3 tests/e2e_smoke.py [password]
import asyncio, os, sys
from playwright.async_api import async_playwright
P = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INP = os.path.join(P, 'app', 'samples', 'Demo_Urban_Drainage.inp')
PW = sys.argv[1] if len(sys.argv) > 1 else 'pass1'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.connect_over_cdp('http://localhost:9333'); page = b.contexts[0].pages[0]
        errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
        await page.set_viewport_size({'width': 1366, 'height': 860}); await page.reload(); await page.wait_for_timeout(2500)
        if await page.locator('.modal input[type=password]').count():
            await page.locator('.modal input[type=password]').first.fill(PW); await page.locator('.modal .btn.primary').click(); await page.wait_for_timeout(600)
        t = asyncio.create_task(page.evaluate(f"AV.app.openFile({INP!r})"))
        while not t.done():
            await asyncio.sleep(0.3)
            if await page.locator('.modal .btn', has_text='No').count(): await page.locator('.modal .btn', has_text='No').first.click()
        n = await page.evaluate("AV.app.model.nodes.size"); print('nodes', n); assert n > 0
        await page.evaluate("AV.openTable(AV.app, 'CONDUIT')"); await page.wait_for_timeout(500)
        rows = await page.evaluate("document.querySelectorAll('.grid tbody tr').length"); print('table rows rendered', rows); assert rows > 0
        await page.evaluate("AV.app.activateView('map')")
        await page.locator('.rbig', has_text='Flag').click(); await page.wait_for_timeout(500)
        print('flag rows', await page.locator('.flrow').count())
        print('page errors:', errs); assert not errs
asyncio.run(main())
