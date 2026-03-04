# Retro UI Design

## Goal
Shift Rhythm Jump toward a more retro, EdZ-inspired aesthetic by flattening the surfaces, reducing glow/gradient effects, and grounding every element in a single, consistent palette while keeping Handjet for the hero typography.

## Color system
- Define a compact palette of CSS variables: `--bg-base` (rich black), `--surface` (nearly black panel), `--text-main` (off-white), `--text-muted` (desaturated gray), `--accent` (warm yellow), and `--border` (midnight gray). Apply the vars everywhere (body, sections, nav, inputs, buttons, statuses) so updates stay centralized.
- Drop the neon gradient backgrounds, drop shadows, and glowy pseudo-elements introduced earlier; surfaces should read as solid fills with simple 1px borders derived from the variables.

## Typography & hierarchy
- Import the Handjet display font via Google Fonts and assign it to nav, `h1`, and `h2` (include occasional uppercase spacing to match EdZ). Use a clean system sans for body text to keep legibility.
- Keep headings spaced/uppercase but remove excessive glows, letting color and letter spacing deliver the retro feel.

## Controls & buttons
- Replace the glowy `.accent-button`/`.ghost-button` styling with flat treatments: accent buttons get `background: var(--accent); color: #000;` plus gently rounded corners; ghost buttons become outlined rectangles using `--border` and `--accent` for focus states. No gradients, shadows, or neon-specific transitions remain—only subtle opacity shifts.
- Inputs, selects, and textareas retain the `.input-control` wrapper but rely on the new palette for background/border (no box-shadows). Focus states highlight the border only.

## Layout tweaks
- Keep the existing section structure but remove additional decorative patterns (scanlines, heavy nav glows). Maintain the grid for status indicators, but give them flat backgrounds/borders consistent with the surfaces.

## Next steps
1. Write an implementation plan describing CSS + HTML changes (writing-plans skill).  
2. Execute the plan (subagent-driven execution per workflow).
