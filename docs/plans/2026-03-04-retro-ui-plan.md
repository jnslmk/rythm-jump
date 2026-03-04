# Retro UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Flatten the Rhythm Jump UI so every surface relies on a single retro palette, the buttons stay minimal, and Handjet headlines echo the EdZ vibe.

**Architecture:** Centralize a small palette of CSS custom properties for body, surfaces, borders, and accent color. Apply those tokens everywhere while removing gradients, glows, and box-shadows so the layout read as solid fills. Control typography through Handjet for nav/headlines and a simple system sans for body copy.

**Tech Stack:** Static HTML/CSS, Google Fonts, `stylelint` for validation.

---

### Task 1: Reset palette, body, and typography tokens

**Files:**
- Modify: `web/style.css`

**Step 1: Define the new CSS variables and body reset**
```css
:root {
  --bg-base: #030308;
  --surface: #05050b;
  --text-main: #fefefe;
  --text-muted: #9aa0b5;
  --accent: #f6d03f;
  --border: #22222a;
}
body {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: var(--bg-base);
  color: var(--text-main);
  min-height: 100vh;
  overflow-x: hidden;
}
```
Also remove the `body::before` scanline overlay and any glowing background helpers introduced earlier.

**Step 2: Run stylelint to catch syntax issues**
Run: `npx stylelint web/style.css`
Expected: PASS

**Step 3: Introduce Handjet for display text in CSS (font-family declarations for `nav`, `h1`, `h2`) and ensure the body stays system sans.

**Step 4: Re-run stylelint to verify the font updates compiled cleanly**
Run: `npx stylelint web/style.css`
Expected: PASS

**Step 5: Commit**
```bash
git add web/style.css docs/plans/2026-03-04-retro-ui-design.md
git commit -m "chore: add retro palette tokens"
```

### Task 2: Simplify helper classes and controls

**Files:**
- Modify: `web/style.css`

**Step 1: Replace `.surface`, `.accent-button`, `.ghost-button`, `.input-control`, `.box-indicator`, and related selectors with flat styles that use the new variables (no gradients, box-shadows, or pseudo glow). Include simple transitions (opacity) only.
```css
.surface {
  background: var(--surface);
  border: 1px solid var(--border);
  padding: 1.5rem;
  border-radius: 0.85rem;
}
.accent-button {
  background: var(--accent);
  color: #0b0b0b;
  border: none;
  border-radius: 0.75rem;
  transition: opacity 0.15s ease;
}
.ghost-button {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-main);
}
```
Continue for `.input-control`, `.box-indicator`, etc., keeping only flat fill/border/color rules.

**Step 2: Run stylelint**
Run: `npx stylelint web/style.css`
Expected: PASS

**Step 3: Verify manual sections (nav/sections) still use the shared classes cleanly.

**Step 4: Re-run stylelint**
Run: `npx stylelint web/style.css`
Expected: PASS

**Step 5: Commit**
```bash
git add web/style.css
git commit -m "feat: simplify retro helpers"
```

### Task 3: Hook Handjet font and accent usage into markup

**Files:**
- Modify: `web/index.html`
- Modify: `web/manage.html`

**Step 1: Add the Handjet font link to each `<head>` and ensure nav/section elements rely on the CSS classes defined earlier (no new structural markup needed).
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Handjet:wght@400;700&display=swap" rel="stylesheet">
```

**Step 2: Run stylelint (CSS unchanged but re-ensures lint stays clean)**
Run: `npx stylelint web/style.css`
Expected: PASS

**Step 3: Confirm both pages still share the accent classes (`surface`, `accent-button`, `ghost-button`, `.input-control`) and that the navigation/typography now inherits Handjet via CSS.

**Step 4: Re-run stylelint**
Run: `npx stylelint web/style.css`
Expected: PASS

**Step 5: Commit**
```bash
git add web/index.html web/manage.html
git commit -m "feat: apply retro font and accent"
```
