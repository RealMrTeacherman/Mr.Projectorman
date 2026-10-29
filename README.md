# Slide Remote

Control and draw on your slides from your phone while they show on the projector from your classroom computer. Runs entirely in the browser (nothing to install on the school computer), hosted on GitHub Pages, synced live through Firebase.

- **Computer:** `https://realmrteacherman.github.io/Mr.Projectorman/`
- **Phone:** `https://realmrteacherman.github.io/Mr.Projectorman/remote.html` (add to Home Screen)

## One-time setup (about 15 minutes)

### 1. Put the files on GitHub
1. Create a new public repo named `Mr.Projectorman` under RealMrTeacherman.
2. Upload everything in this folder (keep the folder structure).
3. Settings › Pages › Source: *Deploy from a branch*, branch `main`, folder `/ (root)`. Save.

### 2. Create the Firebase project
A separate project from Planbook keeps the two apps' rules from tangling. The free Spark plan is plenty.

1. [console.firebase.google.com](https://console.firebase.google.com) › Add project › name it `slide-remote` (Analytics not needed).
2. **Build › Realtime Database › Create database.** Pick `us-central1`, start in **locked mode**.
3. In the database's **Rules** tab, replace everything with the contents of `database.rules.json` and click **Publish**.
4. **Build › Authentication › Get started › Sign-in method.** Turn on **Google** and **Anonymous**.
5. Authentication › **Settings › Authorized domains › Add domain:** `realmrteacherman.github.io`
6. Project settings (gear) › **Your apps › Web (</>)** › register an app named `Slide Remote` (no Hosting). Copy the `firebaseConfig` values into `js/config.js` (make sure `databaseURL` is included; it appears once the database exists). Commit the change.

### 3. First run
1. On the classroom computer, open the computer link and sign in with Google.
   If your district account blocks the sign-in, use a personal Gmail; just use the same one every time.
2. On your phone, open the phone link in **Safari** (Chrome on Android), tap **Share › Add to Home Screen**, then open **Slide Remote from the Home Screen**.
3. On the computer, click **Phones and pairing**. Type the 6-digit code into your phone.

That's the only time you'll see a code. From then on, open the page on the computer and tap the icon on your phone; they find each other.

## Everyday use
1. In Google Slides: **File › Download › PDF document**. Drop the PDF onto **Add a deck** on the computer.
2. Tap the deck on your phone (or click it on the computer). Click the projector screen once for full screen.
3. Draw, highlight, erase, Next/Back from your phone. Turn the phone sideways for a bigger drawing area.

**Phone:** Undo removes your last line. Clear needs two taps so it can't happen by accident. Whiteboard swaps in a blank page (its drawings are kept separately). Hide screen blacks out the projector; turning the page brings it back.

**Computer keys:** arrows / space to move, **B** hide screen, **W** whiteboard, **F** full screen, **Esc** stop.

Drawings stay on each slide until you clear them. To start fresh, use **Clear drawings** on the deck card.

## Privacy
Slide images and drawings sync live through Firebase, like Planbook's non-student data. Keep student names, photos, and other identifying information out of decks you present with Slide Remote.

## What v1 doesn't do (yet)
- Speaker notes: Google's PDF export doesn't include them, so the phone shows a preview of the next slide instead.
- Animations, transitions, and videos: the PDF is a still picture of each slide.
- Pinch to zoom on the phone, and a partial eraser (the eraser removes whole lines).
- Editing a deck: after changing the Google Slides, upload the new PDF and delete the old deck.

## Tests
- Unit tests (no setup): `node --test tests/core.test.mjs`
- End-to-end (both pages in a real browser, Firebase replaced by an in-memory fake):
  `pip install playwright && playwright install chromium`, then `cd tests/e2e && ./prepare.sh && python3 run.py`

## Files
| File | What it does |
|---|---|
| `index.html`, `js/computer.js`, `css/computer.css` | Classroom computer: decks, pairing, projector view |
| `remote.html`, `js/remote.js`, `css/remote.css` | Phone remote |
| `js/core.js` | Drawing math and stroke rendering (unit tested) |
| `js/live.js` | Next/Back/Whiteboard/Hide actions shared by both devices |
| `js/firebase.js` | Firebase setup and every database path |
| `js/config.js` | Your Firebase settings |
| `database.rules.json` | Who can read and write what |
