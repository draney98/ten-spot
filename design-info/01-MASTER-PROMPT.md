# Master prompt — paste this first

Copy everything inside the box into your AI. Attach (or paste after it) these files, in this order:

1. `02-SPEC.md`
2. `03-DESIGN.md`
3. `06-COMMON-MISTAKES.md`
4. `reference/src/game-logic.js`
5. `reference/src/styles.css`
6. `reference/src/index.html`
7. `reference/src/app.js`
8. Pictures: `images/01-phone-light.png`, `02-phone-dark.png`, `18-pairing-rules.png`, `20-phone-layout-annotated.png`, `16-cell-artwork-light.png`, `19-match-animation-timeline.png`, `11-desktop-light.png`

If your AI cannot take that much at once, send the box plus files 1, 2, 4 and the first 3 pictures. Send the rest when a build step needs them.

---

```
You are rebuilding a finished, working web game called "Number Match".
A complete reference implementation is attached. Your job is to reproduce
it EXACTLY, not to redesign it.

HARD RULES — follow every one:

1. DO NOT INVENT. Every rule, number, colour, size, text string and timing
   is written down in 02-SPEC.md, 03-DESIGN.md or the reference code. If
   you cannot find something, ASK ME. Do not guess.

2. COPY game-logic.js UNCHANGED. It contains every game rule and passes
   54 automated tests. Do not rewrite it, "simplify" it, rename its
   functions or change its numbers. Your screen code calls it.

3. KEEP RULES AND SCREEN SEPARATE. All rules live in game-logic.js.
   The screen code (app.js) only: draws the state, handles clicks,
   runs animations and timers, and saves to localStorage.

4. PLAIN TECHNOLOGY. Plain HTML + CSS + JavaScript. No frameworks, no
   build tools, no npm packages. The only external resource is Google
   Fonts (Barlow).

5. MOBILE FIRST. Design for a 390px-wide phone first. The desktop
   layout is added with one media query at 960px. No horizontal
   scrolling at any width from 320px up.

6. MATCH THE PICTURES. The attached screenshots are of the real
   reference app. Your result must look the same: same layout, colours,
   fonts, spacing and icons.

7. WORK IN SMALL STEPS. I will give you one build step at a time. Do
   only that step. At the end of each step, give me the COMPLETE
   contents of every file you changed (never "...rest unchanged"), then
   stop and wait.

8. NEVER BREAK WHAT WORKS. If a step needs a change to something built
   earlier, say so and show the change explicitly.

9. When unsure between two options, pick the one that matches the
   reference code, and tell me you did.

Reply only with: "Ready for step 1." Then wait.
```
