import subprocess, time, json, sys
from playwright.sync_api import sync_playwright
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '-d', 'site'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
B = 'http://localhost:8765/'
results = []
def check(name, cond):
    results.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name)
def db(page): return page.evaluate("window.__fakeTree || {}")
try:
  with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context()
    errors = []
    comp = ctx.new_page(); comp.set_viewport_size({'width':1280,'height':720})
    comp.on('pageerror', lambda e: errors.append('computer: '+str(e)))
    comp.goto(B+'index.html'); comp.evaluate("localStorage.clear()")
    comp.wait_for_selector('#home:not([hidden])')
    check('computer shows home after sign-in', comp.is_visible('#home'))
    check('chip invites phone setup', 'Set up your phone' in comp.inner_text('#phoneChip'))

    comp.set_input_files('#pdfInput', 'test-deck.pdf')
    comp.wait_for_selector('.deck', timeout=20000)
    d = db(comp)
    deck_id, deck = list(d['users']['owner1']['decks'].items())[0]
    check('deck saved with 3 slides', deck['count'] == 3 and len(d['users']['owner1']['slides'][deck_id]) == 3)
    check('deck title from filename', deck['title'] == 'test-deck')
    comp.screenshot(path='shots/01-computer-home.png')

    comp.click('#pairLink')
    comp.wait_for_function("/^[0-9]{6}$/.test(document.getElementById('pairCode').textContent)", polling=100)
    code = comp.inner_text('#pairCode')
    check('pairing code shown', len(code) == 6)
    comp.screenshot(path='shots/02-computer-pair.png')

    phone = ctx.new_page(); phone.set_viewport_size({'width':390,'height':844})
    phone.on('pageerror', lambda e: errors.append('phone: '+str(e)))
    phone.goto(B+'remote.html')
    phone.wait_for_selector('#setup:not([hidden])')
    phone.screenshot(path='shots/03-phone-setup.png')
    phone.fill('#codeInput', '111111'); phone.click('#connectBtn')
    phone.wait_for_selector('#codeError:not([hidden])')
    check('wrong code is refused', phone.is_visible('#codeError'))
    phone.fill('#codeInput', code); phone.click('#connectBtn')
    phone.wait_for_selector('#decks:not([hidden])')
    check('phone paired and shows decks', phone.locator('.deck-item').count() == 1)
    comp.wait_for_function("document.getElementById('pairStatus').textContent.startsWith('Connected')", polling=100)
    check('computer confirms the phone', 'Connected' in comp.inner_text('#pairStatus'))
    time.sleep(0.5); check('pairing code deleted after use', 'pairing' not in db(comp))
    comp.click('#closePairBtn')
    comp.wait_for_function("document.getElementById('phoneChip').textContent.includes('connected')", polling=100)
    check('chip shows phone connected', 'Your phone is connected' in comp.inner_text('#phoneChip'))
    phone.screenshot(path='shots/04-phone-decks.png')

    # Reopen phone: should reconnect without a code
    phone.reload()
    phone.wait_for_selector('#decks:not([hidden])', timeout=5000)
    check('phone reconnects on reopen with no code', phone.is_visible('#decks'))

    phone.click('.deck-item')
    phone.wait_for_selector('#remote:not([hidden])')
    comp.wait_for_selector('#stage:not([hidden])')
    check('picking a deck on the phone starts the projector', comp.is_visible('#stage'))
    comp.wait_for_function("document.getElementById('slideImg').src.startsWith('data:image')", polling=100)
    phone.wait_for_function("document.getElementById('slideImg').src.startsWith('data:image')", polling=100)
    check('pill shows 1 / 3', comp.inner_text('#pillText') == '1 / 3')

    # Draw a stroke on the phone
    box = phone.locator('#inkCanvas').bounding_box()
    phone.mouse.move(box['x']+40, box['y']+60); phone.mouse.down()
    for i in range(20): phone.mouse.move(box['x']+40+i*12, box['y']+60+(i%5)*6)
    phone.mouse.up(); time.sleep(0.3)
    ink = db(comp)['users']['owner1'].get('ink',{}).get(deck_id,{}).get('0',{})
    check('stroke synced to the database', len(ink) == 1 and len(list(ink.values())[0]['p']) > 10)
    px = comp.evaluate("""() => { const c=document.getElementById('inkCanvas'); const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n=0; for(let i=3;i<d.length;i+=4) if(d[i]>0) n++; return n; }""")
    check('projector canvas painted the ink', px > 200)
    phone.click('[data-tool="hl"]')
    phone.mouse.move(box['x']+40, box['y']+120); phone.mouse.down(); phone.mouse.move(box['x']+250, box['y']+122); phone.mouse.up(); time.sleep(0.2)
    comp.screenshot(path='shots/05-projector-ink.png'); phone.screenshot(path='shots/06-phone-remote.png')

    # Undo removes the highlighter
    phone.click('.actions [data-action="undo"]'); time.sleep(0.3)
    ink = db(comp)['users']['owner1']['ink'][deck_id]['0']
    check('undo removed the last stroke only', len(ink) == 1 and not list(ink.values())[0].get('hl'))

    # Eraser
    phone.click('[data-tool="eraser"]')
    phone.mouse.move(box['x']+40+5*12, box['y']+60+0*6); phone.mouse.down(); phone.mouse.up(); time.sleep(0.3)
    check('eraser removed the stroke', not db(comp)['users']['owner1'].get('ink',{}).get(deck_id,{}).get('0'))

    # Next
    phone.click('.nav [data-action="next"]')
    comp.wait_for_function("document.getElementById('pillText').textContent === '2 / 3'", polling=100)
    check('Next moves the projector', True)
    check('phone counter updates', phone.inner_text('#counter') == 'Slide 2 of 3')
    phone.click('.nav [data-action="next"]'); phone.click('.nav [data-action="next"]'); time.sleep(0.3)
    check('cannot go past the last slide', comp.inner_text('#pillText') == '3 / 3')
    check('last slide says so', 'last slide' in phone.inner_text('#nextText'))

    # Computer keyboard
    comp.keyboard.press('ArrowLeft'); time.sleep(0.2)
    check('arrow key on computer moves back and phone follows', phone.inner_text('#counter') == 'Slide 2 of 3')

    # Whiteboard + hide
    phone.click('.actions [data-action="whiteboard"]'); time.sleep(0.2)
    check('whiteboard mode on projector', 'whiteboard' in comp.get_attribute('#stage','class'))
    phone.click('[data-tool="pen"][data-color="red"]')
    phone.mouse.move(box['x']+100, box['y']+100); phone.mouse.down(); phone.mouse.move(box['x']+200, box['y']+150); phone.mouse.up(); time.sleep(0.3)
    check('whiteboard ink stored separately', 'wb' in db(comp)['users']['owner1']['ink'][deck_id])
    comp.screenshot(path='shots/07-projector-whiteboard.png')
    phone.click('.actions [data-action="whiteboard"]'); time.sleep(0.2)
    phone.click('.actions [data-action="hidden"]'); time.sleep(0.2)
    check('hide screen blacks out projector', 'hidden-screen' in comp.get_attribute('#stage','class'))
    check('phone tells you the screen is hidden', phone.is_visible('#veil'))
    phone.click('.nav [data-action="next"]'); time.sleep(0.2)
    check('turning the page unhides', 'hidden-screen' not in comp.get_attribute('#stage','class'))

    # Drawings persist when flipping back
    phone.click('[data-tool="pen"][data-color="blue"]')
    phone.mouse.move(box['x']+60, box['y']+60); phone.mouse.down(); phone.mouse.move(box['x']+160, box['y']+90); phone.mouse.up(); time.sleep(0.3)
    phone.click('.nav [data-action="back"]'); time.sleep(0.2); phone.click('.nav [data-action="next"]'); time.sleep(0.3)
    check('drawing is still there after flipping back', len(db(comp)['users']['owner1']['ink'][deck_id]['2']) == 1)

    # Clear needs two taps
    phone.click('.actions [data-action="clear"]'); time.sleep(0.2)
    check('one tap on Clear does not erase', len(db(comp)['users']['owner1']['ink'][deck_id]['2']) == 1)
    phone.click('.actions [data-action="clear"]'); time.sleep(0.3)
    check('second tap clears the slide', '2' not in db(comp)['users']['owner1']['ink'][deck_id])

    # Sideways
    phone.mouse.move(box['x']+60, box['y']+60); phone.mouse.down(); phone.mouse.move(box['x']+200, box['y']+100); phone.mouse.up(); time.sleep(0.2)
    phone.set_viewport_size({'width':844,'height':390}); time.sleep(0.5)
    sb = phone.locator('#slideBox').bounding_box()
    check('sideways slide is bigger', sb['width'] > box['width'] * 1.5)
    check('sideways shows right rail', phone.is_visible('.side'))
    phone.click('.side [data-action="more"]')
    check('more menu opens', phone.is_visible('#moreMenu'))
    phone.screenshot(path='shots/08-phone-sideways-menu.png')
    phone.click('.side [data-action="more"]')
    phone.screenshot(path='shots/09-phone-sideways.png')
    phone.click('.side [data-action="next"]'); time.sleep(0.2)
    phone.set_viewport_size({'width':390,'height':844}); time.sleep(0.3)

    # Stop from phone
    phone.click('.top [data-action="decks"]')
    comp.wait_for_selector('#home:not([hidden])')
    check('choosing another deck returns computer to home', comp.is_visible('#home'))
    check('phone back on deck list', phone.is_visible('#decks'))


    # Phones opening the main link land on the remote; computers and tablets stay put.
    devices = {
      'iPhone': dict(user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', viewport={'width':390,'height':844}, is_mobile=True, has_touch=True),
      'Android phone': dict(user_agent='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36', viewport={'width':412,'height':915}, is_mobile=True, has_touch=True),
    }
    for name, opts in devices.items():
      mctx = br.new_context(**opts); mp = mctx.new_page()
      mp.goto(B+'index.html'); mp.wait_for_url('**/remote.html', timeout=5000)
      check(f'{name} opening the main link lands on the remote', mp.url.endswith('/remote.html'))
      mp.goto(B+'index.html?computer'); time.sleep(0.5)
      check(f'{name} can stay on the computer page with ?computer', mp.url.endswith('index.html?computer'))
      mctx.close()
    ipad = br.new_context(user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', viewport={'width':1024,'height':1366}, has_touch=True)
    ip = ipad.new_page(); ip.goto(B+'index.html'); time.sleep(0.5)
    check('iPad stays on the computer page', ip.url.endswith('index.html')); ipad.close()
    lap = br.new_context(viewport={'width':1280,'height':720}); lp = lap.new_page(); lp.goto(B+'index.html'); time.sleep(0.5)
    check('laptop stays on the computer page', lp.url.endswith('index.html')); lap.close()
    check('pairing tells the phone to open the main link', not comp.evaluate("document.getElementById('remoteUrl').textContent").endswith('remote.html'))

    # Remove phone -> phone is told to re-pair (simulate by deleting remote and having fake deny)
    check('no page errors', not errors)
    for e in errors: print('  ', e)
    br.close()
finally:
    srv.terminate()
print(f"\n{sum(1 for _,ok in results if ok)}/{len(results)} checks passed")
