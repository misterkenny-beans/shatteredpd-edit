# tools

## item_templates.json

Every item, enchantment and glyph in the game, saved exactly the way the game itself saves a freshly made one. `update_game_data.js` merges this into `docs/js/data.js`, so items added in the editor start with the same values the game would give them.

This matters more than it sounds. When a value is missing from a save, the game falls back to a default, and those defaults are often wrong for a new item:

- Weapons and armor without an `augment` get the first augment in the list (speed/evasion) instead of none.
- Thrown weapons without `durability` start broken, and without a `set_id` they get treated as a pre-v3.2 set.
- Wands start with no charges, and Lloyd's beacon thinks it has a return point on depth 0.
- The crystal enchantment (new in v4.0) starts with 0 durability, so the weapon shatters on its first hit.

It also lists which bag each item goes in, and the exact sprite of every item, which `update_game_data.js` uses to double check the sprites it reads from the source code.

## harness/

`SpudHarness.java` runs the game's own code headlessly (no window, Gradle or Android SDK needed). `build.sh` fetches the libraries the game uses (libGDX, gdx-controllers, org.json) at the versions in its `build.gradle`, compiles everything with `javac`, and runs the harness.

You need `git` and a JDK (11 or newer). From the repository root, with the game cloned into `./shattered-pixel-dungeon`:

```sh
tools/harness/build.sh     # regenerates tools/item_templates.json
node update_game_data.js   # regenerates docs/js/data.js
```

It can also help test the editor against the real game:

```sh
# start a real run (any hero class) and save it to /tmp/test/game1/game.dat
tools/harness/build.sh newgame HUNTRESS /tmp/test 12345
# add "rich" at the end for a save with every bag, equipment slot and a few upgraded/enchanted items

# after editing /tmp/test/game1/game.dat with the editor, load it with the game's own loader
tools/harness/build.sh load /tmp/test /tmp/report.json
```

The report lists the hero's stats and every item as the game sees it after loading (level, enchantment, charges, etc.), plus any errors the game ran into.
