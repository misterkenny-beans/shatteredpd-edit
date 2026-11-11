#!/usr/bin/env bash
# Builds Shattered Pixel Dungeon's code without Gradle or Android, then runs tools/harness/SpudHarness.java with it.
#
#   tools/harness/build.sh                       regenerate tools/item_templates.json (the default)
#   tools/harness/build.sh newgame WARRIOR <dir> <seed> [rich]
#   tools/harness/build.sh load <dir> <report.json>
#
# Needs git and a JDK (11 or newer). Run it from the repository root, with the game cloned into ./shattered-pixel-dungeon
# (same as update_game_data.js). The game's libraries (libGDX etc.) are built from source at the versions it uses.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SPD="$ROOT/shattered-pixel-dungeon"
HARNESS="$ROOT/tools/harness"
WORK="$HARNESS/build"

[ -d "$SPD" ] || { echo "Clone https://github.com/00-Evan/shattered-pixel-dungeon into $SPD first." >&2; exit 1; }

setting() { sed -n "s/.*$1 = '\{0,1\}\([^' ]*\)'\{0,1\}.*/\1/p" "$SPD/build.gradle" | head -1; }
VERSION_CODE="$(setting appVersionCode)"
VERSION_NAME="$(setting appVersionName)"
GDX_VERSION="$(setting gdxVersion)"
CONTROLLERS_VERSION="$(setting gdxControllersVersion)"
JSON_VERSION="$(sed -n 's/.*org\.json:json:\([0-9]*\).*/\1/p' "$SPD/SPD-classes/build.gradle" | head -1)"
echo "Game v$VERSION_NAME ($VERSION_CODE), libGDX $GDX_VERSION, gdx-controllers $CONTROLLERS_VERSION, org.json $JSON_VERSION"

mkdir -p "$WORK"
cd "$WORK"

# 1. Library sources (only the parts the game's core code needs)
if [ ! -d "libgdx-$GDX_VERSION" ]; then
	git clone --quiet --depth 1 --branch "$GDX_VERSION" --filter=blob:none --no-checkout https://github.com/libgdx/libgdx "libgdx-$GDX_VERSION"
	git -C "libgdx-$GDX_VERSION" sparse-checkout set --no-cone '/gdx/src/' '/extensions/gdx-freetype/src/' '/backends/gdx-backend-headless/src/'
	git -C "libgdx-$GDX_VERSION" checkout --quiet
fi
[ -d "gdx-controllers-$CONTROLLERS_VERSION" ] || git clone --quiet --depth 1 --branch "$CONTROLLERS_VERSION" https://github.com/libgdx/gdx-controllers "gdx-controllers-$CONTROLLERS_VERSION"
[ -d "json-$JSON_VERSION" ] || git clone --quiet --depth 1 --branch "$JSON_VERSION" https://github.com/stleary/JSON-java "json-$JSON_VERSION"

# 2. Compile the libraries. libGDX's native library loader lives in another project, and natives are never used
#    headlessly, so a tiny stand-in is enough.
mkdir -p stubs/com/badlogic/gdx/utils
cat > stubs/com/badlogic/gdx/utils/Os.java <<'JAVA'
package com.badlogic.gdx.utils;
public enum Os { Windows, Linux, MacOsX, Android, IOS }
JAVA
cat > stubs/com/badlogic/gdx/utils/SharedLibraryLoader.java <<'JAVA'
package com.badlogic.gdx.utils;
public class SharedLibraryLoader {
	public static Os os = Os.Linux;
	public SharedLibraryLoader() {}
	public SharedLibraryLoader(String nativesJar) {}
	public void load(String libraryName) {}
}
JAVA

JAVAC="javac -nowarn -Xlint:none -encoding UTF-8 --release 11"
if [ ! -f "classes/libs/.done-$GDX_VERSION" ]; then
	rm -rf classes/libs && mkdir -p classes/libs
	{
		find stubs -name '*.java'
		find "json-$JSON_VERSION" -name '*.java' -not -path '*/test/*'
		find "libgdx-$GDX_VERSION/gdx/src" "libgdx-$GDX_VERSION/extensions/gdx-freetype/src" "libgdx-$GDX_VERSION/backends/gdx-backend-headless/src" -name '*.java'
		find "gdx-controllers-$CONTROLLERS_VERSION/gdx-controllers-core" -path '*src/main/java*' -name '*.java'
	} > libs.txt
	$JAVAC -d classes/libs @libs.txt
	touch "classes/libs/.done-$GDX_VERSION"
fi

# 3. Compile the game (core code only)
rm -rf classes/spd classes/patched classes/harness && mkdir -p classes/spd classes/patched classes/harness
find "$SPD/SPD-classes/src/main/java" "$SPD/services/src/main/java" "$SPD/core/src/main/java" -name '*.java' > spd.txt
$JAVAC -J-Xmx3g -cp classes/libs -d classes/spd @spd.txt

# The item icon sheet normally loads its texture (which needs a GPU) just to measure it. Give it the sheet's size
# instead, which produces the same sprite rectangles.
SHEET="$SPD/core/src/main/java/com/shatteredpixel/shatteredpixeldungeon/sprites/ItemSpriteSheet.java"
ICONS_PNG="$SPD/core/src/main/assets/sprites/item_icons.png"
ICONS_W=$(od -An -tu1 -j16 -N4 "$ICONS_PNG" | awk '{print $1*16777216+$2*65536+$3*256+$4}')
ICONS_H=$(od -An -tu1 -j20 -N4 "$ICONS_PNG" | awk '{print $1*16777216+$2*65536+$3*256+$4}')
sed "s/new TextureFilm( Assets.Sprites.ITEM_ICONS, SIZE, SIZE )/new TextureFilm( $ICONS_W, $ICONS_H, SIZE, SIZE )/" "$SHEET" > ItemSpriteSheet.java
grep -q "new TextureFilm( $ICONS_W, $ICONS_H, SIZE, SIZE )" ItemSpriteSheet.java || { echo "Couldn't patch ItemSpriteSheet.java, the game code changed." >&2; exit 1; }
$JAVAC -cp classes/libs:classes/spd -d classes/patched ItemSpriteSheet.java

# 4. Compile and run the harness (from the game's assets folder, so it finds its text)
$JAVAC -cp classes/libs:classes/spd -d classes/harness "$HARNESS/SpudHarness.java"
CP="$WORK/classes/patched:$WORK/classes/harness:$WORK/classes/libs:$WORK/classes/spd"

if [ $# -eq 0 ]; then
	set -- templates "$WORK/classes/spd" "$ROOT/tools/item_templates.json"
fi
cd "$SPD/core/src/main/assets"
exec java -Xmx2g -Dspud.versionCode="$VERSION_CODE" -Dspud.versionName="$VERSION_NAME" -cp "$CP" SpudHarness "$@"
