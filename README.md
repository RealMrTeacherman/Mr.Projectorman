# Slide Remote

Control and draw on your slides from your phone while they show on the projector from your classroom computer. Runs entirely in the browser (nothing to install on the school computer), hosted on GitHub Pages, synced live through Firebase.

**One link for everything:** `https://realmrteacherman.github.io/Mr.Projectorman/`
Computers get the projector page; phones are sent to the remote automatically. (To use the computer page from a phone, add `?computer` to the end of the link.)

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
2. On your phone, open the same link in **Safari** (Chrome on Android), tap **Share › Add to Home Screen**, then open **Slide Remote from the Home Screen**.
3. On the computer, click **Phones and pairing**. Type the 8-digit code into your phone.

That's the only time you'll see a code. From then on, open the page on the computer and tap the icon on your phone; they find each other.

### 4. Google Drive import (one time, about 10 minutes)
In [console.cloud.google.com](https://console.cloud.google.com), with the MrProjectorman project selected:
1. Enable **Google Drive API**, **Google Slides API**, and **Google Picker API** (search each by name).
2. **Google Auth Platform** (or "OAuth consent screen"): Audience **Internal** if offered; under **Data Access**, add the scope ending in `/auth/drive.file`.
3. **Credentials › Browser key (auto created by Firebase):** under API restrictions, include **Google Picker API**; under Application restrictions, choose **Websites** and add `https://realmrteacherman.github.io/*`.

## Everyday use
1. On the computer, click **From Google Drive** and pick a Google Slides deck or PowerPoint, or drag a PDF or PowerPoint file onto **Add a deck**. Big decks take a few minutes to bring in the first time; the card shows progress, and you can present other decks meanwhile.
2. Tap the deck on your phone (or click it on the computer). Click the projector screen once for full screen.
3. Draw, highlight, erase, Next/Back from your phone. Turn the phone sideways for a bigger drawing area.

**Phone:** Undo removes your last line. Clear needs two taps so it can't happen by accident. Whiteboard swaps in a blank page (its drawings are kept separately). Hide screen blacks out the projector; turning the page brings it back.

**Computer keys:** arrows / space to move, **B** hide screen, **W** whiteboard, **F** full screen, **Esc** stop.

Drawings stay on each slide until you clear them. To start fresh, use **Clear drawings** on the deck card.

**Changed a deck in Google Slides?** Click **Update from Drive** on its card. Drawings follow their slides even if you reordered them; drawings on slides you deleted are cleaned up. The old version stays on screen until the new one is fully in. (Decks added as PDF or uploaded PowerPoint files don't have this link; delete and re-add them instead.)

## Sharing with colleagues
Colleagues don't need their own copy. They open the same link and sign in with their own school account; every teacher's decks, drawings, and phones are kept separate. Only accounts ending in `@creswell.k12.or.us` can sign in (set in `js/settings.js` and enforced in `database.rules.json`; change both together if this is ever used elsewhere).

New teachers see a three-step **Getting started** guide that disappears once they've paired a phone, added a deck, and presented.

As the owner of the Firebase project, you can see everyone's stored slides in the Firebase console. The free plan comfortably covers a few teachers; if many colleagues join, check usage under Firebase › Realtime Database › Usage.

## Privacy
Slide images and drawings sync live through Firebase, like Planbook's non-student data. Keep student names, photos, and other identifying information out of decks you present with Slide Remote.

Slide Remote stores Drive access only in the open page, for under an hour; it's never saved. Your phone never has Drive access.

## What it doesn't do (yet)
- Animations, transitions, and videos: each slide comes in as a still picture.
- Pinch to zoom on the phone, and a partial eraser (the eraser removes whole lines).
- Speaker notes come only from Google Drive decks (including PowerPoints brought in through Google), not from PDFs.

## Tests
- Unit tests (no setup): `node --test tests/core.test.mjs`
- End-to-end (both pages in a real browser, Firebase replaced by an in-memory fake):
  `pip install playwright && playwright install chromium`, then `cd tests/e2e && ./prepare.sh && python3 run.py`

## Files
| File | What it does |
|---|---|
| `index.html`, `js/computer.js`, `css/computer.css` | Classroom computer: decks, pairing, projector view |
| `remote.html`, `js/remote.js`, `css/remote.css` | Phone remote |
| `js/core.js` | Drawing math, stroke rendering, notes reading (unit tested) |
| `js/drive.js` | Google Drive and Slides: permission, picker, PowerPoint conversion, slide pictures |
| `js/slides.js` | Loads slide pictures as needed and keeps nearby ones ready |
| `drive-test.html`, `js/drive-test.js` | Step-by-step check that Drive import works for an account |
| `js/live.js` | Next/Back/Whiteboard/Hide actions shared by both devices |
| `js/firebase.js` | Firebase setup and every database path |
| `js/config.js` | Your Firebase settings |
| `database.rules.json` | Who can read and write what |
