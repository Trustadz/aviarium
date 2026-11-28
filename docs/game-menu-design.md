# Game menu and Library design

This reference supplements the [game menu UX contract](game-contract.md#game-menu-ux-contract).
The editable Penpot reference is **Main → Game menu**. The page shows all three
game menus in light and dark, the horizontal Continue row, seed review,
Sudoku's pack catalog and Budgies trail, and an authored-only game concept.
**Main → Library banners** shows how the banner artwork sits next to live text.

## Mascots and banner artwork

| Game | Mascot | Library banner artwork |
| --- | --- | --- |
| Sudoku | [Sage budgie](design/game-menu/mascots/sudoku-mascot.svg) | [Grid and budgie](design/game-menu/library-banners/sudoku-banner.svg) |
| Nonograms | [Slate-blue cockatoo](design/game-menu/mascots/nonograms-mascot.svg) | [Picture grid and cockatoo](design/game-menu/library-banners/nonograms-banner.svg) |
| 2048 | [Amber macaw](design/game-menu/mascots/2048-mascot.svg) | [Merge tiles and macaw](design/game-menu/library-banners/2048-banner.svg) |

The SVGs use editable paths on a transparent canvas. The Library artwork uses
the same bird as its game menu. Supply the background, game name, description,
and action in the interface, keeping them legible independently of the graphic.
Treat the image as decorative when the game name is already visible. Each game
uses its own light and dark palette. The Daily Challenge banner keeps its own
art direction and remains available when enabled.

On narrow screens use the illustration's aspect ratio and preserve room for
the title and action. At increased text sizes, allow the layout to reflow so
both remain legible. Use the same title hierarchy, icon box size, and alignment
for all three games. The bird can perch, tap, or nudge the title at its edge.
Place it so the letters stay legible and it clears the app header.

## Before handing over a preview

- In Library, check the three game banners in light and dark. At 320 px, 390 px,
  and desktop widths, confirm that the copy, buttons, and art fit. Check swipe,
  keyboard navigation, reduced motion, and the existing e-reader behavior.
- In each game menu, confirm that the Daily Challenge appears first when
  available, then the most recent save. With multiple saves, scroll the row
  with touch and keyboard. Check that a new challenge starts and an in-progress
  challenge resumes its own attempt.
- Check generated play, seed review, exact-board replay, and restoration of
  saved play options. Confirm that authored packs and daily challenges keep
  the rules provided by their own source.
- Open Sudoku → Packs → Budgies → Follow the trail. Verify that the trail opens
  at the current stop, later stops explain how to unlock, and Back follows the
  navigation path. Use the authored-only Penpot concept to check that the menu
  also works with Packs as the main way to play.
