import subprocess, time, json, sys
from playwright.sync_api import sync_playwright

import io, re, json as _json
from urllib.parse import urlparse, unquote
from PIL import Image as _Img, ImageDraw as _Draw

GOOGLE = {
  'presentations': {
    'pres1': {'title': 'Story Problems (Drive)', 'slides': ['a', 'b', 'c', 'd', 'e', 'f'], 'notes': {'b': 'Ask: which number is the whole?'}},
    'pptx1': {'title': 'Compare Problems.pptx', 'slides': ['p1', 'p2', 'p3'], 'notes': {}},
  },
  'pptx_sources': {'pptx1': 'pptx1'},
  'deleted': [], 'copies': 0, 'uploads': 0, 'thumbs': 0,
}
_png_cache = {}
def _png(label):
    if label not in _png_cache:
        im = _Img.new('RGB', (1600, 900), 'white'); d = _Draw.Draw(im)
        d.rectangle([0, 0, 1600, 60], fill='#2459D6'); d.text((80, 400), f'slide {label}', fill='black')
        b = io.BytesIO(); im.save(b, 'PNG'); _png_cache[label] = b.getvalue()
    return _png_cache[label]
CORS = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*'}
def _json_resp(route, obj, status=200):
    route.fulfill(status=status, headers={**CORS, 'Content-Type': 'application/json'}, body=_json.dumps(obj))

PICKER_JS = """
window.gapi = { load: (n, o) => setTimeout(o.callback, 0) };
class DocsView { setMimeTypes() { return this; } setIncludeFolders() { return this; } setMode() { return this; } setEnableDrives() { return this; } }
class PickerBuilder {
  addView() { return this; } enableFeature() { return this; } setOAuthToken() { return this; } setDeveloperKey() { return this; }
  setAppId() { return this; } setOrigin() { return this; } setTitle() { return this; }
  setCallback(cb) { this.cb = cb; return this; } build() { return this; }
  setVisible() { const doc = window.__pickDoc; setTimeout(() => this.cb(doc ? { action: 'picked', docs: [doc] } : { action: 'cancel' }), 30); return this; }
}
window.google = { picker: { DocsView, PickerBuilder, ViewId: { DOCS: 'docs' }, DocsViewMode: { LIST: 'list' }, Feature: { SUPPORT_DRIVES: 1 }, Action: { PICKED: 'picked', CANCEL: 'cancel' } } };
"""

def _slides_api(route):
    req = route.request
    if req.method == 'OPTIONS': return route.fulfill(status=204, headers=CORS)
    path = urlparse(req.url).path
    m = re.match(r'/v1/presentations/([^/]+)/pages/([^/]+)/thumbnail', path)
    if m:
        GOOGLE['thumbs'] += 1
        time.sleep(0.05)
        return _json_resp(route, {'contentUrl': f'https://lh3.googleusercontent.com/fake/{m.group(1)}/{m.group(2)}.png', 'width': 1600, 'height': 900})
    m = re.match(r'/v1/presentations/([^/]+)$', path)
    p = GOOGLE['presentations'].get(m.group(1)) if m else None
    if not p: return _json_resp(route, {'error': {'message': 'not found'}}, 404)
    slides = []
    for sid in p['slides']:
        note = p['notes'].get(sid)
        els = [{'objectId': sid + '-n', 'shape': {'text': {'textElements': [{'textRun': {'content': note + '\n'}}]}}}] if note else [{'objectId': sid + '-n'}]
        slides.append({'objectId': sid, 'slideProperties': {'notesPage': {'notesProperties': {'speakerNotesObjectId': sid + '-n'}, 'pageElements': els}}})
    _json_resp(route, {'title': p['title'], 'pageSize': {'width': {'magnitude': 9144000}, 'height': {'magnitude': 5143500}}, 'slides': slides})

def _picture(route):
    if route.request.method == 'OPTIONS': return route.fulfill(status=204, headers=CORS)
    label = unquote(urlparse(route.request.url).path.rsplit('/', 1)[-1]).replace('.png', '')
    route.fulfill(status=200, headers={**CORS, 'Content-Type': 'image/png'}, body=_png(label))

def _drive(route):
    req = route.request
    if req.method == 'OPTIONS': return route.fulfill(status=204, headers=CORS)
    path = urlparse(req.url).path
    m = re.match(r'/drive/v3/files/([^/]+)/copy', path)
    if m and req.method == 'POST':
        GOOGLE['copies'] += 1
        src = GOOGLE['presentations'][GOOGLE['pptx_sources'][m.group(1)]]
        new_id = f"tmpcopy{GOOGLE['copies']}"
        GOOGLE['presentations'][new_id] = {**src, 'title': '[Slide Remote temporary] ' + src['title']}
        return _json_resp(route, {'id': new_id})
    if path.startswith('/upload/drive/v3/files') and req.method == 'POST':
        GOOGLE['uploads'] += 1
        new_id = f"tmpupload{GOOGLE['uploads']}"
        GOOGLE['presentations'][new_id] = {'title': '[Slide Remote temporary] Uploaded', 'slides': [f'u{i}' for i in range(30)], 'notes': {}}
        return _json_resp(route, {'id': new_id})
    m = re.match(r'/drive/v3/files/([^/?]+)$', path)
    if m and req.method == 'DELETE':
        GOOGLE['deleted'].append(m.group(1)); GOOGLE['presentations'].pop(m.group(1), None)
        return route.fulfill(status=204, headers=CORS)
    _json_resp(route, {'error': {'message': 'unexpected'}}, 400)

def install_fake_google(ctx):
    ctx.route('https://apis.google.com/js/api.js', lambda r: r.fulfill(status=200, headers={'Content-Type': 'application/javascript'}, body=PICKER_JS))
    ctx.route('https://slides.googleapis.com/**', _slides_api)
    ctx.route('https://lh3.googleusercontent.com/**', _picture)
    ctx.route('https://www.googleapis.com/**', _drive)

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
    install_fake_google(ctx)
    errors = []
    comp = ctx.new_page(); comp.set_viewport_size({'width':1280,'height':720})
    comp.on('pageerror', lambda e: errors.append('computer: '+str(e)))
    comp.goto(B+'index.html'); comp.evaluate("localStorage.clear()")
    comp.wait_for_selector('#home:not([hidden])')
    check('computer shows home after sign-in', comp.is_visible('#home'))
    check('chip invites phone setup', 'Set up your phone' in comp.inner_text('#phoneChip'))
    comp.wait_for_selector('#welcome:not([hidden])')
    check('new teacher sees the Getting started guide', comp.is_visible('#welcome') and comp.locator('.welcome-steps li.done').count() == 0)
    comp.screenshot(path='shots/00-computer-welcome.png')

    comp.set_input_files('#fileInput', 'test-deck.pdf')
    comp.wait_for_selector('.deck', timeout=20000)
    d = db(comp)
    deck_id, deck = list(d['users']['owner1']['decks'].items())[0]
    check('deck saved with 3 slides', deck['count'] == 3 and len(d['users']['owner1']['slides'][deck_id]) == 3)
    check('deck title from filename', deck['title'] == 'test-deck')
    comp.wait_for_selector('#stepDeck.done')
    check('guide marks "Add a deck" done', True)
    comp.screenshot(path='shots/01-computer-home.png')

    comp.click('#pairLink')
    comp.wait_for_function("/^[0-9]{8}$/.test(document.getElementById('pairCode').textContent)", polling=100)
    code = comp.inner_text('#pairCode')
    check('pairing code shown (8 digits)', len(code) == 8)
    comp.screenshot(path='shots/02-computer-pair.png')

    phone = ctx.new_page(); phone.set_viewport_size({'width':390,'height':844})
    phone.on('pageerror', lambda e: errors.append('phone: '+str(e)))
    phone.goto(B+'remote.html')
    phone.wait_for_selector('#setup:not([hidden])')
    phone.screenshot(path='shots/03-phone-setup.png')
    phone.fill('#codeInput', '11111111'); phone.click('#connectBtn')
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
    check('guide marks "Set up your phone" done', comp.locator('#stepPhone.done').count() == 1 and comp.is_visible('#welcome'))
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
    phone.wait_for_function("document.getElementById('counter').textContent === 'Slide 2 of 3'", polling=100, timeout=3000)
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
    check('guide disappears once all three steps are done', comp.is_hidden('#welcome'))
    check('phone back on deck list', phone.is_visible('#decks'))


    # ---------- Google Drive import ----------
    def deck_by_title(t):
        for k, v in db(comp)['users']['owner1'].get('decks', {}).items():
            if v.get('title') == t: return k, v
        return None, None
    def wait_ready(t, timeout=30):
        end = time.time() + timeout
        while time.time() < end:
            k, v = deck_by_title(t)
            if v and v.get('status') is None and v.get('count'): return k, v
            time.sleep(0.2)
        return deck_by_title(t)

    comp.evaluate("window.__pickDoc = {id: 'pres1', name: 'Story Problems (Drive)', mimeType: 'application/vnd.google-apps.presentation'}")
    comp.click('#driveBtn')
    comp.wait_for_function("[...document.querySelectorAll('.deck .meta')].some(m => m.textContent.startsWith('Bringing in slides'))", polling=50, timeout=10000)
    check('importing deck shows progress on its card', True)
    phone_titles = phone.evaluate("[...document.querySelectorAll('.deck-item .n')].map(n => n.textContent)")
    check('a deck still importing is hidden on the phone', 'Story Problems (Drive)' not in phone_titles)
    did, dk = wait_ready('Story Problems (Drive)')
    check('Drive deck imported with all 6 slides', dk and dk['count'] == 6 and dk['rev'] == 1 and len(db(comp)['users']['owner1']['slides'][did]['r1']) == 6)
    check('Drive deck kept slide ids and found its notes', dk['slideIds'] == ['a','b','c','d','e','f'] and dk['hasNotes'] is True)
    check('Drive deck has a thumbnail', dk.get('thumb', '').startswith('data:image/jpeg'))
    check('Drive permission was asked through re-confirmation, not a new sign-in', comp.evaluate('window.__reauths') >= 1)
    comp.screenshot(path='shots/10-computer-drive-deck.png')

    phone.wait_for_function("[...document.querySelectorAll('.deck-item .n')].some(n => n.textContent === 'Story Problems (Drive)')", polling=100)
    phone.evaluate("window.__slideGets = 0")
    phone.locator('.deck-item', has_text='Story Problems (Drive)').click()
    phone.wait_for_selector('#remote:not([hidden])')
    phone.wait_for_function("document.getElementById('slideImg').src.startsWith('data:image')", polling=100)
    comp.wait_for_function("document.getElementById('slideImg').src.startsWith('data:image')", polling=100)
    check('Drive deck shows on projector and phone', True)
    box = phone.locator('#inkCanvas').bounding_box()
    phone.click('[data-tool="pen"][data-color="blue"]')
    def scribble():
        phone.mouse.move(box['x']+50, box['y']+50); phone.mouse.down(); phone.mouse.move(box['x']+150, box['y']+80); phone.mouse.up(); time.sleep(0.3)
    scribble()
    ink = db(comp)['users']['owner1']['ink'][did]
    check('drawing on a Drive slide is keyed by the slide, not its position', 's-a' in ink and '0' not in ink)
    check('notes area stays hidden on a slide without notes', not phone.is_visible('#notesText'))
    phone.click('.nav [data-action="next"]'); time.sleep(0.4)
    check('speaker notes show on the phone', phone.is_visible('#notesText') and 'which number is the whole' in phone.inner_text('#notesText'))
    phone.screenshot(path='shots/11-phone-notes.png')
    for _ in range(4): phone.click('.nav [data-action="next"]'); time.sleep(0.15)
    scribble()  # on slide f, which will be deleted
    check('drew on slide f', 's-f' in db(comp)['users']['owner1']['ink'][did])

    # Edit the deck in "Google Slides": move a to third place, delete f. Then update.
    GOOGLE['presentations']['pres1']['slides'] = ['b', 'c', 'a', 'd', 'e']
    phone.click('.nav [data-action="back"]'); time.sleep(0.2)   # now on slide 5 (e)
    comp_was = db(comp)['users']['owner1']['live']
    phone.click('.top [data-action="decks"]'); comp.wait_for_selector('#home:not([hidden])')
    comp.locator('.deck', has_text='Story Problems (Drive)').get_by_text('Update from Drive').click()
    end = time.time() + 20
    while time.time() < end:
        dk = db(comp)['users']['owner1']['decks'][did]
        if dk.get('rev') == 2 and dk.get('status') is None: break
        time.sleep(0.2)
    check('update brought in the new version', dk.get('rev') == 2 and dk['count'] == 5 and dk['slideIds'] == ['b','c','a','d','e'])
    slides_node = db(comp)['users']['owner1']['slides'][did]
    check('old version of the pictures was removed', 'r1' not in slides_node and len(slides_node['r2']) == 5)
    ink = db(comp)['users']['owner1']['ink'][did]
    check('drawing on a moved slide kept', 's-a' in ink)
    check('drawing on a deleted slide was cleaned up', 's-f' not in ink)
    phone.locator('.deck-item', has_text='Story Problems (Drive)').click()
    phone.wait_for_selector('#remote:not([hidden])')
    phone.click('.nav [data-action="next"]'); time.sleep(0.2); phone.click('.nav [data-action="next"]'); time.sleep(0.5)
    px = comp.evaluate("""() => { const c=document.getElementById('inkCanvas'); const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n=0; for(let i=3;i<d.length;i+=4) if(d[i]>0) n++; return n; }""")
    check('the drawing follows slide a to its new third position', comp.inner_text('#pillText') == '3 / 5' and px > 100)
    phone.click('.top [data-action="decks"]'); comp.wait_for_selector('#home:not([hidden])')

    # PowerPoint already in Drive
    deleted_before = len(GOOGLE['deleted'])
    comp.evaluate("window.__pickDoc = {id: 'pptx1', name: 'Compare Problems.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'}")
    comp.click('#driveBtn')
    pk, pv = wait_ready('Compare Problems')
    check('PowerPoint from Drive imported (3 slides)', pv and pv['count'] == 3)
    time.sleep(0.3)
    check('its temporary Google Slides copy was deleted', GOOGLE['copies'] >= 1 and len(GOOGLE['deleted']) > deleted_before)
    check('PowerPoint from Drive can be updated later', pv.get('driveId') == 'pptx1')

    # PowerPoint uploaded from the computer (30 slides)
    open('upload-test.pptx', 'wb').write(b'PK fake pptx')
    comp.set_input_files('#fileInput', 'upload-test.pptx')
    uk, uv = wait_ready('upload-test', timeout=40)
    check('PowerPoint uploaded from the computer imported (30 slides)', uv and uv['count'] == 30)
    time.sleep(0.3)
    check('uploaded PowerPoint temporary copy was deleted', any(x.startswith('tmpupload') for x in GOOGLE['deleted']))
    check('uploaded PowerPoint has no Update link (nothing in Drive to update from)', 'Update from Drive' not in comp.locator('.deck', has_text='upload-test').inner_text())

    # Only nearby slides load
    phone.evaluate("window.__slideGets = 0")
    phone.locator('.deck-item', has_text='upload-test').click()
    phone.wait_for_selector('#remote:not([hidden])')
    phone.wait_for_function("document.getElementById('slideImg').src.startsWith('data:image')", polling=100); time.sleep(0.5)
    gets = phone.evaluate('window.__slideGets')
    check(f'phone loaded only nearby slides of a 30-slide deck ({gets} fetched)', 0 < gets <= 6)
    phone.click('.top [data-action="decks"]'); comp.wait_for_selector('#home:not([hidden])')

    # Non-district Google accounts are turned away with a clear message
    gctx = br.new_context(); gp = gctx.new_page()
    gp.goto(B+'index.html'); gp.evaluate("localStorage.setItem('fakeEmail', 'someone@gmail.com')"); gp.reload()
    gp.wait_for_selector('#notAllowed:not([hidden])', timeout=5000)
    check('a Gmail account is told to use a school account', 'creswell.k12.or.us' in gp.inner_text('#notAllowedText') and gp.is_hidden('#home'))
    gp.screenshot(path='shots/12-not-allowed.png'); gctx.close()

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
    import os
    if os.path.exists('upload-test.pptx'): os.remove('upload-test.pptx')
    for e in errors: print('  ', e)
    br.close()
finally:
    srv.terminate()
print(f"\n{sum(1 for _,ok in results if ok)}/{len(results)} checks passed")
