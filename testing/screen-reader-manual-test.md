# Manual screen-reader test: Learn stage and beginner lesson

For Lucky to run by hand. **Not run by Claude.** Automated checks (axe, keyboard tests) cannot tell
you what a screen reader actually says; this script can. Write down what you hear in the table at
the end, especially anything confusing, missing, repeated or announced twice.

## Setup

**Laptop (Ubuntu, Orca)**
1. Start the app: `npm run dev` (or `npm run dev:lan` for the phone), open `http://localhost:3000/learn` in Firefox or Chrome.
2. Turn Orca on/off: **Super + Alt + S**. Orca modifier key: **Insert** (or **Caps Lock** in laptop layout).
3. Useful keys: **Tab / Shift+Tab** (controls), **H** (next heading, browse mode), **D** (next landmark),
   **Orca + Space** (Orca settings), **Orca + A** (toggle browse/focus mode).

**Phone (Android, TalkBack)**
1. Settings → Accessibility → TalkBack → on (or hold both volume keys for 3 s if the shortcut is set up).
2. Open `http://192.168.100.10:3000/learn` (see CLAUDE.md for `dev:lan`).
3. Swipe right/left = next/previous item; double-tap = activate; swipe down-then-right = reading controls menu
   (pick *Headings* or *Landmarks*).

Turn **Mute** on in Aili when testing with a screen reader, so Aili's voice and the screen reader don't talk over each other (captions are announced when Aili is muted).

## Steps and what to listen for

| # | Do this | You should hear (roughly) | Watch out for |
|---|---|---|---|
| 1 | Load `/learn`, press Tab once | "Skip to content, link" | Nothing announced, or focus starts mid-page |
| 2 | Activate it | Focus moves to the main content | Focus doesn't move |
| 3 | List landmarks (Orca: D; TalkBack: Landmarks) | banner, navigation "Main", main, region "Stage" | Missing or unnamed regions |
| 4 | List headings (Orca: H) | One heading level 1: "Learn stage" | More than one level-1 heading |
| 5 | Tab to Menu, press Enter | "Menu, button, collapsed" → "expanded"; items say "Coming" except Settings | State not announced |
| 6 | Escape | Menu closes, focus back on "Menu" | Focus lost |
| 7 | Tab to the badge | "Prepared · Draft (not expert-reviewed), button", then the description with the full wording | Description missing |
| 8 | Tab to "Parts", Enter | "Parts, listbox" and the first part, "selected/not selected" | No listbox role |
| 9 | Arrow down, then Enter | "Selected: Servo body" announced; focus back on "Parts: Servo body" | Selection not announced |
| 10 | Tab to "Labels", Enter | "Labels, toggle button, pressed / not pressed" | No pressed state |
| 11 | Tab to "Exploded view", Enter | "pressed"; (no announcement of motion is needed) | — |
| 12 | Tab to the voice button | "Start voice input, button"; the status "Ready" is readable nearby | Unnamed button |
| 13 | Tab to "Start: why reach makes holding harder", Enter | The lesson's lines are announced (Mute on) | Silence (captions not live when muted) |
| 14 | When the question appears, Tab to the choices | "Close to you, button", "Far from you", "Not sure" | Choices not reachable |
| 15 | Choose "Far from you" | Commit line, then reveal lines; then **"Result: harder with the weight far from your hand."** | Result not announced |
| 16 | Listen through the link and the check | "A robot arm works the same way…", then the check question and its three choices | Lines skipped |
| 17 | Answer the check | The feedback, then "That's one answer, not a test result…" | Any praise or "mastery" wording |
| 18 | Tab to "Explanation", Enter | "Explanation" and "Library" tabs; the explanation title and text | Tabs not announced as tabs |
| 19 | Press Escape in the panel | Panel closes; focus back on "Explanation" | Focus lost |
| 20 | Select "Arm" via Parts, then Tab into the inspector | Region "Inspector: Arm"; slider "Arm length, 0.18 metres"; arrow keys change it ("0.19 metres") | Value read without units |
| 21 | Press Escape | Inspector closes; focus on "Parts: Arm" | — |
| 22 | Settings (via Menu) | Heading "Settings"; "Voice" section; checkbox "Mute Aili's voice" | — |

### Optional: without 3D
In Chrome, open `chrome://flags`, disable WebGL (or use a browser/device without it), reload `/learn`.
You should hear: "3D view isn't available on this device, so here is a still picture of the parts", and the
picture's description ("Still side view of the placeholder model: base, servo body, arm, end weight").

## Record what you heard

| Step | Laptop (Orca) — what was said | Phone (TalkBack) — what was said | Problem? |
|---|---|---|---|
| 1 | | | |
| … | | | |
