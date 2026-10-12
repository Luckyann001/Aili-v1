# Phone test: Itel A667L (Android 14), over USB

For Lucky to run by hand (slice 6). Judge speed on this **production build**, not the dev server.

**Oct 11 2026:** run on the Itel A667L over USB; all steps fine (reported by Lucky; numbers not recorded here).

## Set up (once)
1. **Phone:** Settings → About phone → tap **Build number** 7 times (on some Itel menus it is under About phone → Version). Then Settings → System → Developer options → turn on **USB debugging**.
2. **Laptop:** build and start the app (keep the terminal open):
   `cd ~/Documents/Aili-v1 && npm run build && npm run start -w @aili/web`
   (it uses `apps/web/.env.local`, so the draft lesson scenes are shown). The `?demo=1` readout and
   Demo controls need `NEXT_PUBLIC_AILI_DEMO_TOOLS=1` in `apps/web/.env.local` (added Oct 12 2026);
   without it, as in a real production build, `?demo=1` does nothing.
3. Plug the phone in by USB and allow debugging on the phone.
4. **Laptop Chrome:** open `chrome://inspect/#devices` → **Port forwarding…** → add `3000` → `localhost:3000` → tick **Enable port forwarding** → Done.
5. **Phone Chrome:** open `http://localhost:3000/learn?demo=1`. (Over USB this counts as `localhost`, so the microphone works without any flags.)
6. When finished: untick port forwarding; stop the server with `Ctrl + C`.

## Checklist
Open **Demo controls (testing only)** on the stage for the performance readout. After each step, press **Copy results** where useful and paste into the table (or a note).

1. **First load:** note the readout's *Page load* and *3D scene ready*. Did a still picture show before the 3D?
2. **Orbit:** drag the 3D view for a few seconds with one finger; pinch to zoom; **Reset view**. Note *median* and *worst* frame time. Smooth or jerky?
3. **Parts:** open **Parts**, pick a part, then **Clear selection**; tap a part in 3D; tap empty space.
4. **Inspector:** pick **Arm**, move the slider; close it.
5. **Exploded view:** turn it on and off.
6. **Lesson:** start it; answer the probe (try **Not sure** once); watch the reveal and the effort gauge; answer the check.
7. **Voice:** tap the mic, read the notice (which version appeared: *on this device* or *online*?), say a short question; try **Mute** and **Stop**.
8. **Zoom:** pinch-zoom the page to about 200%, and set Android *Settings → Display → Font size* to largest. Anything cut off or overlapping?
9. **Dark mode:** turn on Android dark theme; is everything readable?
10. **Reduced motion:** Android *Settings → Accessibility → Remove animations* on; replay the lesson reveal (the weight should step, not slide).

## Results

| # | What happened | Numbers (from Copy results) | Problem? |
|---|---|---|---|
| 1 | | Page load: · 3D ready: | |
| 2 | | median: · worst: | |
| 3 | | | |
| 4 | | | |
| 5 | | | |
| 6 | | | |
| 7 | Notice version: | | |
| 8 | | | |
| 9 | | | |
| 10 | | | |

WebGL renderer (from the readout): ______  Chrome version: ______
