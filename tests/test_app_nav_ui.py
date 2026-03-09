from pathlib import Path

import pytest
from playwright.sync_api import Error, sync_playwright


def test_primary_nav_renders_without_background_shell() -> None:
    style_css_path = Path(__file__).resolve().parents[1] / "web" / "style.css"

    with sync_playwright() as playwright:
        browser = None
        try:
            browser = playwright.chromium.launch(headless=True)
        except Error as exc:  # pragma: no cover - environment dependent
            pytest.skip(f"Playwright Chromium unavailable: {exc}")

        assert browser is not None
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        page.set_content(
            """
<!doctype html>
<html lang="en">
  <body>
    <header class="app-header">
      <nav class="app-nav" aria-label="Primary">
        <menu class="buttons app-nav-menu">
          <li><a href="index.html" class="button accent-button active">Game</a></li>
          <li><a href="manage.html" class="button ghost ghost-button">Manage Songs</a></li>
        </menu>
      </nav>
    </header>
  </body>
</html>
""",
        )
        page.add_style_tag(path=str(style_css_path))
        styles = page.evaluate(
            """() => {
          const nav = document.querySelector('.app-nav');
          const computed = window.getComputedStyle(nav);
          return {
            backgroundColor: computed.backgroundColor,
            borderTopWidth: computed.borderTopWidth,
            paddingTop: computed.paddingTop,
          };
        }""",
        )
        browser.close()

    assert styles["backgroundColor"] == "rgba(0, 0, 0, 0)"
    assert styles["borderTopWidth"] == "0px"
    assert styles["paddingTop"] == "0px"
