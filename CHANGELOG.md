# Changelog

**English** · [简体中文](CHANGELOG.zh-CN.md)

All notable changes to `openchamber-theme-studio` will be documented in this file. Every version listed here was verified on OpenChamber 2.8.0, both the desktop app (Electron) and the web app.

## [0.4.0] - 2026-11-26

### Preview in the window you already use

- Keep your saved Theme Studio theme selected in **Settings → Appearance**. Pick a palette, add a style, tune colors or refine a detail and see the result across the window. The first preview explains the temporary file change; other windows using the same theme on the same server show it too.
- **Restore** writes the exact original contents back for each affected light or dark file, even after uninstalling and reinstalling Theme Studio. The theme stays selected. The file's modification time changes.
- **My themes** and **Start from current theme** still open the original theme. **Save to file**, **Export to Downloads** and **Copy JSON** use its original colors. Other saved themes are unchanged.
- If multiple themes share the same colors and the selected theme cannot be identified, **Window preview paused** leaves those files alone. Other custom themes still use the panel preview.

## [0.3.1] - 2026-11-26

### Added
- On wide panels each theme and style card is at most 240 px wide, and the number of columns grows with the panel. From 1031 px the Theme and Style tabs use the same columns. The 320, 420 and 720 px layouts are unchanged.
- **Restore built-in colors** for a preview left by 0.3.0 or earlier that still borrows a built-in theme. You no longer need to delete the entry in Settings → Appearance.

### Fixed
- Uninstalling and reinstalling during a preview no longer stops at "Preview backup missing". Each preview file now records the starting point it replaced. After reinstalling, one **Restore** brings back the original file byte for byte, or the built-in colors, and you can also keep previewing straight away. Unsaved drafts held only in extension storage are still lost on uninstall.
- If a leftover preview's original colors cannot be verified, it is left untouched, and the panel explains how to save a copy or switch themes instead of showing a dead end.

## [0.3.0] - 2026-11-25

### Added
- Preview either edition in the whole window, whatever mode the window is in. Clicking a card under **Dark** in a light window, or under **Light** in a dark one, now repaints the window. Theme Studio writes only its own preview file and never switches the host's light or dark setting.
- Eight style recipes, told apart by large color planes: Constructivist, Art Deco, Mineral Landscape, Retro Desktop, Thermal Ramp, Chalkboard, Stained Glass and Kraft Label. There are now 17 in total.
- Two curated palettes: Afterglow and Hojicha. There are now 11, plus Default.
- When a preview's backup is missing, a recovery guide in the panel names the leftover entry as it appears in either language: `(trying on)` or `（试穿）`.

### Changed
- Style strength and options stay pinned below the recipe list, so choosing a recipe never moves the list.
- Thermal Ramp's dark surfaces use blue-ink and steel blue against embers, and the red-ink fold on light Afterglow warms the transition.

### Fixed
- Clicking cards under **Dark**, or a curated palette, while the window was light changed only the mini preview.

## [0.2.0] - 2026-11-25

### Changed
- Clicking is previewing. Picking a card or editing in any tab previews the whole window reversibly, replacing 0.1's **Apply** button and live switch.
- One **Restore** in the footer returns both the light and the dark edition to where they started.
- **Save to file** keeps a named light and dark pair without touching the live preview.
- A streamlined sidebar in English and Chinese with five tabs: Theme, Style, Color, Details and Pairings. Status messages are in plain language, and the scroll gutter stays put at 320, 420 and 720 px.

### Added
- **My themes**: open saved pairs to keep editing, remove them from the list only (with undo), or follow a checked path to delete the files in Settings → Appearance.

### Fixed
- After a read failure shared by both editions, both are checked again.

## [0.1.0] - 2026-11-25

### Added
- First release: a right-sidebar panel for OpenChamber 2.8.0 that builds native themes.
- Nine curated palettes with light and dark editions: Tidemark, Wheat Vellum, Quiet Graphite, Blue Etch, Kilnmark, Reed Shade, Hard Edge, Dusk Margin and Zero Hour.
- Nine composable style recipes with adjustable strength: Brutalism, Fauvism, Phosphor Terminal, Editorial Paper, Swiss Minimal, E-Ink, Cyber / Vaporwave, Pixel Palette and Soft Glass.
- A theme derivation engine, a readability check with repair, colors from an image, field-by-field refinement, and font pairing suggestions.
- A reversible live theme through Theme Studio's own slot file. Opening the panel for the first time only reads.
- Save as, export to Downloads, Copy JSON and import. English and Chinese follow the host language.

[0.4.0]: https://github.com/JMoCoder/openchamber-theme-studio/releases/tag/v0.4.0
[0.3.1]: https://github.com/JMoCoder/openchamber-theme-studio/releases/tag/v0.3.1
