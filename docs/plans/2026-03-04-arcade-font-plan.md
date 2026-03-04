# Arcade Font Refresh Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Handjet with Arcade Gamer for display elements and pair it with Space Grotesk for body copy so the retro aesthetic stays playful yet legible.

**Architecture:** Load the two Google Fonts via `<link>` tags on both HTML pages, then update `web/style.css` so nav links, headings, and key display text use Arcade Gamer while the rest of the UI inherits Space Grotesk. Keep the existing palette/helper classes untouched.

**Tech Stack:** Static HTML/CSS with `stylelint` for validation.

---

### Task 1: Add Arcade Gamer + Space Grotesk font loads

**Files:**
- Modify: `web/index.html`
- Modify: `web/manage.html`

**Step 1: Update both `<head>` sections to preload Google Fonts (Arcade Gamer, Space Grotesk) and keep the stylesheet link.

**Step 2: Run stylelint to ensure no CSS changed inadvertently while editing HTML.
Run: `npx stylelint web/style.css`
Expected: PASS

**Step 3: Quick manual sanity check by opening either HTML file to confirm the `<head>` still loads assets in the right order.

**Step 4: Run stylelint again after verification.
Run: `npx stylelint web/style.css`
Expected: PASS

**Step 5: Commit the HTML update.
```bash
git add web/index.html web/manage.html
git commit -m "feat: load arcade gamer and space grotesk"
```

### Task 2: Apply the font pairing in CSS

**Files:**
- Modify: `web/style.css`

**Step 1: Change `body` to use `Space Grotesk`, and set `nav`, `h1`, `h2`, `legend` (and any other display text) to `Arcade Gamer` while keeping the rest of the styling intact.

**Step 2: Run stylelint to catch syntax issues.
Run: `npx stylelint web/style.css`
Expected: PASS

**Step 3: Inspect key sections (nav, headings, labels) to ensure they inherit the correct fonts.

**Step 4: Run stylelint again.
Run: `npx stylelint web/style.css`
Expected: PASS

**Step 5: Commit the CSS change.
```bash
git add web/style.css
git commit -m "feat: apply arcade gamer display font"
```
