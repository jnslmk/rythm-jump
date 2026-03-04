# Tron UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Re-theme the Rhythm Jump frontend with a darker Tron-inspired palette and shared reusable CSS atoms so both pages feel unified.

**Architecture:** A single centralized stylesheet will expose CSS custom properties for all glow colors and reusable surface/button/input classes, and both HTML pages will consume those atoms to avoid duplication. The focus is on declarative visuals—no new JavaScript changes are planned.

**Tech Stack:** Static HTML, vanilla CSS, `stylelint` for regression checks.

---

### Task 1: Author the Tron palette and base layout tokens

**Files:**
- Modify: `web/style.css`

**Step 1: Add CSS custom properties and body layout
```css
:root {
  --bg-base: #020817;
  --surface: #0b1226;
  --edge-glow: rgba(0, 240, 255, 0.25);
  --glow-primary: #00f0ff;
  --glow-secondary: #ff3ecf;
  --glow-tertiary: #3cff9b;
  --text-main: #e4ecff;
  --text-muted: #94a3b8;
}
body {
  font-family: 'IBM Plex Sans', system-ui, sans-serif;
  background: var(--bg-base);
  color: var(--text-main);
  margin: 0;
  min-height: 100vh;
}
body::before {
  content: '';
  position: fixed;
  inset: 0;
  background: linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%);
  pointer-events: none;
  opacity: 0.6;
}
```

**Step 2: Run `stylelint` to catch syntax issues
Run: `npx stylelint web/style.css`
Expected: PASS (no new lint warnings)

**Step 3: Extend global layout helpers and surface defaults
Add `.surface`, `.label`, and reusable layout helpers such as `.flex-gap`, `.center-content` in the same stylesheet.

**Step 4: Re-run `stylelint` to confirm the helper rules compile
Run: `npx stylelint web/style.css`
Expected: PASS

**Step 5: Commit
```bash
git add web/style.css
git commit -m "chore: add tron palette tokens"
```

### Task 2: Apply reusable atoms to HTML structure

**Files:**
- Modify: `web/index.html`
- Modify: `web/manage.html`

**Step 1: Update markup to consume the new classes
Add `class="surface"` to `nav`, `section`, and status cards; replace inline labels with `<span class="label">`; apply `.accent-button`, `.ghost-button`, and `.input-control` to buttons/inputs.

**Step 2: Run `stylelint` as a proxy for validating that none of the referenced selectors are missing
Run: `npx stylelint web/style.css`
Expected: PASS

**Step 3: Double-check the pages in the browser (manual verification)
Open both HTML files in the browser to ensure the layout still renders and active nav link persists.

**Step 4: Re-run `stylelint` (ensuring no accidental edits to CSS)
Run: `npx stylelint web/style.css`
Expected: PASS

**Step 5: Commit
```bash
git add web/index.html web/manage.html
git commit -m "feat: wire tron atoms into html"
```

### Task 3: Polish controls, indicators, and neon interactions

**Files:**
- Modify: `web/style.css`

**Step 1: Add focus/hover states for `.accent-button`, `.ghost-button`, and `.input-control`, plus `.box-indicator` glow transitions that rely on the Tron variables.

**Step 2: Run `stylelint` to ensure new rules stay compliant
Run: `npx stylelint web/style.css`
Expected: PASS

**Step 3: Verify the neon states manually (click through buttons, focus inputs, trigger indicator classes via game preview or DOM inspector)

**Step 4: Re-run `stylelint`
Run: `npx stylelint web/style.css`
Expected: PASS

**Step 5: Commit
```bash
git add web/style.css
git commit -m "feat: add neon interactions"
```
