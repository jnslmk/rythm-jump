# Arcade Font Refresh Design

## Goal
Reinforce the retro aesthetic by swapping the current Handjet display font for Arcade Gamer and pairing it with Space Grotesk for body text so the UI feels playful yet legible.

## Typography roles
- Import Arcade Gamer and Space Grotesk from Google Fonts.
- Apply Arcade Gamer to nav links, the primary page heading, and section headings to keep the display tone consistent with the arcade vibe.
- Use Space Grotesk everywhere else (body, forms, labels, helper text) so the paragraphs and form inputs remain readable while contrasting with the pixelated Arcade Gamer headings.

## Implementation notes
- Font family updates live in `web/style.css` so all typography rules rely on the new stack; no other visual style changes are needed right now.
- Update both `web/index.html` and `web/manage.html` heads to load the new font families via `<link>` tags; remove Handjet references.

Once the fonts are wired, the existing palette and flat styling keep the layout cohesive.
