# Game menu and Library design

This reference supplements the [game menu UX contract](game-contract.md#game-menu-ux-contract).
The editable Penpot reference is **Main → Game menu**. The page shows all three
game menus in light and dark, the horizontal Continue row, seed review,
Sudoku's pack catalog and Budgies trail, and an authored-only game concept.
**Main → Library game cards** shows the artwork panels in the Game library grid.

## Mascots and Library game-card artwork

| Game | Mascot | Library card artwork |
| --- | --- | --- |
| Sudoku | [Sage budgie](design/game-menu/mascots/sudoku-mascot.svg) | [Grid and budgie](design/game-menu/library-cards/sudoku-card-art.svg) |
| Nonograms | [Slate-blue cockatoo](design/game-menu/mascots/nonograms-mascot.svg) | [Picture grid and cockatoo](design/game-menu/library-cards/nonograms-card-art.svg) |
| 2048 | [Amber macaw](design/game-menu/mascots/2048-mascot.svg) | [Merge tiles and macaw](design/game-menu/library-cards/2048-card-art.svg) |

Use the transparent, editable SVGs in the 184 px artwork panel at the top of
each Library game card (`GameCatalog` and `.game-card-image`). Center the art
within the panel and preserve its aspect ratio. The panel keeps its game-themed
background and accessible game link. Keep the game name, description,
favorites, tags, Play, and download management in the card body. The featured
carousel (`LibraryHero`) and the Studio catalog retain their current art.

Each game uses its own light and dark palette. At increased text sizes, let the
card body reflow beneath the art. In the game menu, use the same title hierarchy
and icon alignment across games. The bird can perch, tap, or nudge the title at
its edge. Place it so the letters stay legible and it clears the app header.

## Before handing over a preview

- In the Game library grid, check all three game cards in light and dark at
  320 px, 390 px, and desktop widths. Verify that the art fits, the link has an
  accessible name, and the card body reflows with larger text. Check favorites,
  offline availability, and the existing e-reader behavior.
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
