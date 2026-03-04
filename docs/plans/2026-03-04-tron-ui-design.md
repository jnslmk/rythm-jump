# Tron UI Design

## Goal
Refresh the Rhythm Jump frontend with a cohesive darker Tron-inspired palette and shared reusable elements, ensuring both the game and management views feel unified and neon-lit.

## Color & Atmosphere
- Base background `#020817` for a near-black canvas, layered with subtle grid/scanline texture via a `::before` overlay on `body` (linear-gradient at low opacity). Use the following CSS custom properties as the palette core:
  - `--bg-base`: `#020817` (primary canvas)
  - `--surface`: `#0b1226` (panels/cards)
  - `--glow-primary`: `#00f0ff`
  - `--glow-secondary`: `#ff3ecf`
  - `--glow-tertiary`: `#3cff9b`
  - `--glow-accent`: `#e5ff2f`
  - `--text-main`: `#e4ecff`
  - `--text-muted`: `#94a3b8`
- These variables appear consistently across backgrounds, text, borders, and box-shadow glows to keep the neon effect coherent.

## Reusable Elements
- Introduce shared classes:
  - `.surface` for panels/sections (background from `--surface`, border with glow outline, rounded corners, volumetric shadow/glow). Apply to `section` containers and `nav`.
  - `.label` with uppercase tracking, neon text color, and letter spacing; used for spans/legend text.
  - `.accent-button` for primary actions (bold neon gradient background, glow box-shadow, hover/active transitions) and `.ghost-button` for secondary controls with transparent fill, neon border, and inverted hover glow.
  - `.input-control` for `input/select/textarea` (dark fill, neon focus outline, consistent padding/radius).
  - Utility helpers like `.flex-gap`, `.center-horizontal`, `.grid-rows` to reduce per-component layout code.
- Buttons sharing `.glow-effect` that toggles `box-shadow` and `filter: drop-shadow` for the neon flicker on hover.

## Typography & Interactivity
- Set `body` font stack to `'IBM Plex Sans', system-ui, sans-serif` with `letter-spacing: 0.04em` for uppercase labels.
- Use `text-transform: uppercase` and `font-weight: 600` on `.label`, `.accent-button`, `.ghost-button` for a futurist feel.
- Inputs and select elements reverse to neon outlines once focused. Provide `transition: box-shadow 0.2s, border 0.2s` for responsiveness.
- Add `canvas` container with `box-shadow: 0 0 50px rgba(0, 240, 255, 0.45)` to mimic strip glow.

## Layout & Structure
- Keep nav and sections centered via shared tokens, minimal per-page overrides.
- Provide `.status-grid` using CSS custom properties for gap and align, while each `.status-item` uses `.surface` styles and `.label` for metadata.
- Indicate neon indicator states (left/right boxes) by toggling `.active` with gradient background and extra glow; share same class across screens where needed.

## Next Steps
1. Document the plan (this file).
2. Create implementation plan (writing-plans skill) detailing file edits, tests, and verification.
3. After plan, execute (subagent or same session) following plan steps.
