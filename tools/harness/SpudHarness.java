import com.badlogic.gdx.ApplicationAdapter;
import com.badlogic.gdx.Files;
import com.badlogic.gdx.backends.headless.HeadlessApplication;
import com.badlogic.gdx.backends.headless.HeadlessApplicationConfiguration;
import com.badlogic.gdx.backends.headless.HeadlessFileHandle;
import com.badlogic.gdx.backends.headless.HeadlessPreferences;
import com.shatteredpixel.shatteredpixeldungeon.Dungeon;
import com.shatteredpixel.shatteredpixeldungeon.GamesInProgress;
import com.shatteredpixel.shatteredpixeldungeon.SPDSettings;
import com.shatteredpixel.shatteredpixeldungeon.actors.hero.Belongings;
import com.shatteredpixel.shatteredpixeldungeon.actors.hero.Hero;
import com.shatteredpixel.shatteredpixeldungeon.actors.hero.HeroClass;
import com.shatteredpixel.shatteredpixeldungeon.items.EquipableItem;
import com.shatteredpixel.shatteredpixeldungeon.items.Item;
import com.shatteredpixel.shatteredpixeldungeon.items.bags.Bag;
import com.shatteredpixel.shatteredpixeldungeon.items.bags.MagicalHolster;
import com.shatteredpixel.shatteredpixeldungeon.items.bags.PotionBandolier;
import com.shatteredpixel.shatteredpixeldungeon.items.bags.ScrollHolder;
import com.shatteredpixel.shatteredpixeldungeon.items.bags.VelvetPouch;
import com.shatteredpixel.shatteredpixeldungeon.levels.Level;
import com.shatteredpixel.shatteredpixeldungeon.messages.Languages;
import com.shatteredpixel.shatteredpixeldungeon.messages.Messages;
import com.shatteredpixel.shatteredpixeldungeon.sprites.ItemSpriteSheet;
import com.watabou.noosa.Game;
import com.watabou.utils.Bundle;
import com.watabou.utils.FileUtils;
import com.watabou.utils.Reflection;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.PrintStream;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;

/**
 * Runs the real Shattered Pixel Dungeon code headlessly (no window, no Gradle/Android build needed).
 * Build and run it with tools/harness/build.sh, see tools/README.md.
 *
 *   templates <classesDir> <out.json>        every item/enchantment serialized exactly as the game saves a new one
 *   newgame <CLASS> <saveRoot> <seed> [rich]  starts a real run and saves it to <saveRoot>/game1/ (for testing)
 *   load <saveRoot> <report.json>             loads <saveRoot>/game1/game.dat with the game's own loader and
 *                                             reports what it got, plus any errors (for testing edited saves)
 */
public class SpudHarness {

	static final ByteArrayOutputStream errBuf = new ByteArrayOutputStream();

	public static void main(String[] args) {
		Game.version = System.getProperty("spud.versionName", "unknown");
		Game.versionCode = Integer.parseInt(System.getProperty("spud.versionCode", "0"));
		HeadlessApplicationConfiguration cfg = new HeadlessApplicationConfiguration();
		new HeadlessApplication(new ApplicationAdapter() {
			@Override
			public void create() {
				int code;
				try {
					code = run(args);
				} catch (Throwable t) {
					t.printStackTrace();
					code = 2;
				}
				System.out.flush();
				System.err.flush();
				Runtime.getRuntime().halt(code);
			}
		}, cfg);
	}

	static int run(String[] args) throws Exception {
		File prefs = new File(System.getProperty("java.io.tmpdir"), "spud-harness-prefs.xml");
		SPDSettings.set(new HeadlessPreferences(new HeadlessFileHandle(prefs, Files.FileType.Absolute)));
		Messages.setup(Languages.ENGLISH);
		// the real game loads these at startup (title screen), some item code relies on them
		FileUtils.setDefaultFileProperties(Files.FileType.Absolute, System.getProperty("java.io.tmpdir") + "/spud-harness-global/");
		com.shatteredpixel.shatteredpixeldungeon.Badges.loadGlobal();

		switch (args[0]) {
			case "templates": return templates(new File(args[1]), new File(args[2]));
			case "newgame":   return newGame(args[1], new File(args[2]), Long.parseLong(args[3]), args.length > 4 && args[4].equals("rich"));
			case "load":      return load(new File(args[1]), new File(args[2]));
			default: throw new IllegalArgumentException("unknown command " + args[0]);
		}
	}

	/* ---------------- templates ---------------- */

	static int templates(File classesDir, File out) throws Exception {
		List<String> names = new ArrayList<>();
		for (String pkg : new String[]{"items", "plants"}) {
			File root = new File(classesDir, "com/shatteredpixel/shatteredpixeldungeon/" + pkg);
			collectClasses(root, "com.shatteredpixel.shatteredpixeldungeon." + pkg, names);
		}
		Bag[] bags = { new VelvetPouch(), new ScrollHolder(), new PotionBandolier(), new MagicalHolster() };

		JSONArray arr = new JSONArray();
		TreeSet<String> skipped = new TreeSet<>();
		for (String n : names) {
			Class<?> c = Class.forName(n, false, SpudHarness.class.getClassLoader());
			if (!Item.class.isAssignableFrom(c) || Modifier.isAbstract(c.getModifiers()) || c.isInterface()) continue;
			if (c.isMemberClass() && !Modifier.isStatic(c.getModifiers())) { skipped.add(n + " (non-static inner)"); continue; }
			if (c.isAnonymousClass() || c.isLocalClass()) continue;
			try { c.getDeclaredConstructor(); } catch (NoSuchMethodException e) { skipped.add(n + " (no no-arg ctor)"); continue; }

			Item item;
			try {
				item = (Item) Reflection.newInstanceUnhandled(c);
			} catch (Throwable t) {
				skipped.add(n + " (ctor threw " + t + ")");
				continue;
			}
			JSONObject o = new JSONObject();
			o.put("className", n);
			try { o.put("name", item.name()); } catch (Throwable t) { o.put("name", JSONObject.NULL); }
			int image = item.image;
			o.put("image", image);
			JSONObject sprite = new JSONObject();
			sprite.put("x", (image % 16) * 16);
			sprite.put("y", (image / 16) * 16);
			sprite.put("w", Math.round(ItemSpriteSheet.film.width(image)));
			sprite.put("h", Math.round(ItemSpriteSheet.film.height(image)));
			o.put("sprite", sprite);
			o.put("icon", item.icon);
			if (item.icon != -1) {
				JSONObject is = new JSONObject();
				is.put("x", (item.icon % 16) * 8);
				is.put("y", (item.icon / 16) * 8);
				is.put("w", Math.round(ItemSpriteSheet.Icons.film.width(item.icon)));
				is.put("h", Math.round(ItemSpriteSheet.Icons.film.height(item.icon)));
				o.put("iconSprite", is);
			}
			o.put("stackable", item.stackable);
			o.put("unique", item.unique);
			o.put("upgradable", item.isUpgradable());
			o.put("equipable", item instanceof EquipableItem);
			JSONArray sup = new JSONArray();
			for (Class<?> s = c.getSuperclass(); s != null && s != Object.class; s = s.getSuperclass()) sup.put(s.getSimpleName());
			o.put("superclasses", sup);
			JSONArray fits = new JSONArray();
			for (Bag b : bags) if (b.canHold(item)) fits.put(b.getClass().getSimpleName());
			o.put("bags", fits);

			try {
				Bundle b = new Bundle();
				b.put("t", item);
				JSONObject wrapped = new JSONObject(b.toString());
				o.put("template", wrapped.getJSONObject("t"));
			} catch (Throwable t) {
				skipped.add(n + " (storeInBundle threw " + t + ")");
				continue;
			}
			arr.put(o);
		}
		// enchantments, glyphs and curses also carry state (e.g. Crystal durability), so template them too
		JSONArray ench = new JSONArray();
		for (String pkg : new String[]{"items/weapon/enchantments", "items/weapon/curses", "items/armor/glyphs", "items/armor/curses"}) {
			List<String> en = new ArrayList<>();
			collectClasses(new File(classesDir, "com/shatteredpixel/shatteredpixeldungeon/" + pkg),
					"com.shatteredpixel.shatteredpixeldungeon." + pkg.replace('/', '.'), en);
			for (String n : en) {
				Class<?> c = Class.forName(n, false, SpudHarness.class.getClassLoader());
				if (Modifier.isAbstract(c.getModifiers()) || c.isMemberClass() || c.isAnonymousClass()) continue;
				if (!com.watabou.utils.Bundlable.class.isAssignableFrom(c)) continue;
				Object inst = Reflection.newInstanceUnhandled(c);
				Bundle b = new Bundle();
				b.put("t", (com.watabou.utils.Bundlable) inst);
				JSONObject o = new JSONObject();
				o.put("className", n);
				o.put("curse", inst instanceof com.shatteredpixel.shatteredpixeldungeon.items.weapon.Weapon.Enchantment
						? ((com.shatteredpixel.shatteredpixeldungeon.items.weapon.Weapon.Enchantment) inst).curse()
						: ((com.shatteredpixel.shatteredpixeldungeon.items.armor.Armor.Glyph) inst).curse());
				o.put("template", new JSONObject(b.toString()).getJSONObject("t"));
				ench.put(o);
			}
		}

		JSONObject root = new JSONObject();
		root.put("version", Game.versionCode);
		root.put("items", arr);
		root.put("enchantments", ench);
		root.put("skipped", new JSONArray(skipped));
		java.nio.file.Files.write(out.toPath(), root.toString(1).getBytes(StandardCharsets.UTF_8));
		System.out.println("templates: " + arr.length() + " items, " + skipped.size() + " skipped");
		return 0;
	}

	static void collectClasses(File dir, String pkg, List<String> out) {
		File[] files = dir.listFiles();
		if (files == null) return;
		for (File f : files) {
			if (f.isDirectory()) collectClasses(f, pkg + "." + f.getName(), out);
			else if (f.getName().endsWith(".class")) out.add(pkg + "." + f.getName().replace(".class", ""));
		}
	}

	/* ---------------- newgame ---------------- */

	static int newGame(String heroClass, File saveRoot, long seed, boolean rich) throws Exception {
		saveRoot.mkdirs();
		FileUtils.setDefaultFileProperties(Files.FileType.Absolute, saveRoot.getAbsolutePath() + "/");
		GamesInProgress.curSlot = 1;
		GamesInProgress.selectedClass = HeroClass.valueOf(heroClass);
		Dungeon.hero = null;
		Dungeon.daily = Dungeon.dailyReplay = false;
		Dungeon.customSeedText = "";
		Dungeon.seed = seed;
		Dungeon.init();
		Level level = Dungeon.newLevel();
		Dungeon.switchLevel(level, -1); //also saves

		if (rich) {
			Hero h = Dungeon.hero;
			// bags first so later items get sorted into them, like a real run
			new VelvetPouch().identify().collect();
			new ScrollHolder().identify().collect();
			new PotionBandolier().identify().collect();
			new MagicalHolster().identify().collect();
			String[] extra = {
				"items.weapon.melee.Longsword", "items.armor.PlateArmor", "items.wands.WandOfFireblast",
				"items.wands.WandOfMagicMissile", "items.weapon.missiles.Javelin", "items.weapon.missiles.darts.Dart",
				"items.potions.PotionOfHealing", "items.potions.exotic.PotionOfShielding", "items.scrolls.ScrollOfUpgrade",
				"items.scrolls.exotic.ScrollOfEnchantment", "items.stones.StoneOfAugmentation", "items.rings.RingOfHaste",
				"items.artifacts.TimekeepersHourglass", "items.artifacts.LloydsBeacon", "items.food.Pasty",
				"items.bombs.Bomb", "items.trinkets.RatSkull", "items.quest.DwarfToken", "items.spells.SummonElemental",
				"plants.Sungrass$Seed", "items.potions.elixirs.ElixirOfHoneyedHealing", "items.Honeypot"
			};
			for (String e : extra) {
				Item it = (Item) Reflection.newInstanceUnhandled(Class.forName("com.shatteredpixel.shatteredpixeldungeon." + e));
				it.identify();
				if (!it.collect()) throw new IllegalStateException("could not collect " + e);
			}
			Item sword = h.belongings.getItem(com.shatteredpixel.shatteredpixeldungeon.items.weapon.melee.Longsword.class);
			((com.shatteredpixel.shatteredpixeldungeon.items.weapon.Weapon) sword).enchant(
					new com.shatteredpixel.shatteredpixeldungeon.items.weapon.enchantments.Vorpal());
			sword.upgrade(3);
			// an upgraded + enchanted thrown weapon set creates the hero's UpgradedSetTracker entries
			com.shatteredpixel.shatteredpixeldungeon.items.weapon.missiles.MissileWeapon jav =
					h.belongings.getItem(com.shatteredpixel.shatteredpixeldungeon.items.weapon.missiles.Javelin.class);
			jav.upgrade(); jav.upgrade();
			jav.enchant(new com.shatteredpixel.shatteredpixeldungeon.items.weapon.enchantments.Blazing());
			com.shatteredpixel.shatteredpixeldungeon.items.armor.Armor plate =
					h.belongings.getItem(com.shatteredpixel.shatteredpixeldungeon.items.armor.PlateArmor.class);
			plate.inscribe(new com.shatteredpixel.shatteredpixeldungeon.items.armor.glyphs.Brimstone());
			plate.upgrade(2);
			h.belongings.getItem(com.shatteredpixel.shatteredpixeldungeon.items.wands.WandOfFireblast.class).upgrade(2);
			// fill every equipment slot, including the Champion's second weapon
			h.subClass = com.shatteredpixel.shatteredpixeldungeon.actors.hero.HeroSubClass.CHAMPION;
			com.shatteredpixel.shatteredpixeldungeon.items.rings.Ring might = new com.shatteredpixel.shatteredpixeldungeon.items.rings.RingOfMight();
			might.identify(); might.upgrade(1);
			h.belongings.ring = might; might.activate(h);
			com.shatteredpixel.shatteredpixeldungeon.items.artifacts.Artifact chalice = new com.shatteredpixel.shatteredpixeldungeon.items.artifacts.ChaliceOfBlood();
			h.belongings.artifact = chalice; chalice.activate(h);
			com.shatteredpixel.shatteredpixeldungeon.items.artifacts.Artifact cloak = new com.shatteredpixel.shatteredpixeldungeon.items.artifacts.CloakOfShadows();
			h.belongings.misc = cloak; cloak.activate(h);
			com.shatteredpixel.shatteredpixeldungeon.items.weapon.melee.MeleeWeapon second = new com.shatteredpixel.shatteredpixeldungeon.items.weapon.melee.Sword();
			second.identify();
			h.belongings.secondWep = second;
			Dungeon.gold = 1234;
			Dungeon.energy = 56;
			Dungeon.saveAll();
		}
		System.out.println("newgame: " + heroClass + " seed=" + Dungeon.seed + " -> " + GamesInProgress.gameFile(1));
		return 0;
	}

	/* ---------------- load ---------------- */

	static int load(File saveRoot, File reportFile) throws Exception {
		FileUtils.setDefaultFileProperties(Files.FileType.Absolute, saveRoot.getAbsolutePath() + "/");
		GamesInProgress.curSlot = 1;

		PrintStream realErr = System.err;
		System.setErr(new PrintStream(errBuf, true, "UTF-8"));
		JSONObject report = new JSONObject();
		try {
			Dungeon.hero = null;
			Dungeon.loadGame(1);
			Hero h = Dungeon.hero;
			report.put("loaded", h != null);
			if (h != null) {
				report.put("heroClass", h.heroClass.name());
				report.put("subClass", h.subClass.name());
				report.put("HP", h.HP); report.put("HT", h.HT); report.put("STR", h.STR);
				report.put("lvl", h.lvl); report.put("exp", h.exp);
				report.put("attackSkill", privInt(h, Hero.class, "attackSkill")); report.put("defenseSkill", privInt(h, Hero.class, "defenseSkill"));
				report.put("gold", Dungeon.gold); report.put("energy", Dungeon.energy);
				report.put("depth", Dungeon.depth); report.put("seed", Dungeon.seed);
				Belongings b = h.belongings;
				JSONObject eq = new JSONObject();
				eq.put("weapon", describe(b.weapon)); eq.put("armor", describe(b.armor));
				eq.put("artifact", describe(b.artifact)); eq.put("misc", describe(b.misc));
				eq.put("ring", describe(b.ring)); eq.put("second_wep", describe(b.secondWep));
				report.put("equipped", eq);
				report.put("backpack", describeBag(b.backpack));

				// a full load also restores the level and re-saves, like resuming a run in-game
				Level level = Dungeon.loadLevel(1);
				Dungeon.switchLevel(level, h.pos);
				report.put("levelLoaded", true);
				// exercise UI-facing item code paths (descriptions, actions)
				int checked = 0;
				JSONArray failures = new JSONArray();
				for (Item it : b) {
					try {
						it.name(); it.info(); it.actions(h); it.status(); it.value();
					} catch (NullPointerException e) {
						// some descriptions ask the (absent) UI scene for state, that's a headless limitation, not a save problem
						boolean headlessOnly = false;
						for (StackTraceElement el : e.getStackTrace()) if (el.getClassName().equals("com.watabou.noosa.Game") && el.getMethodName().equals("scene")) headlessOnly = true;
						if (!headlessOnly) failures.put(it.getClass().getName() + ": " + e);
					} catch (Throwable t) {
						failures.put(it.getClass().getName() + ": " + t);
					}
					checked++;
				}
				report.put("itemsExercised", checked);
				report.put("itemFailures", failures);
			}
		} catch (Throwable t) {
			report.put("fatal", t.toString());
			t.printStackTrace();
		} finally {
			System.err.flush();
			System.setErr(realErr);
		}
		String errs = errBuf.toString("UTF-8");
		report.put("errors", errs);
		java.nio.file.Files.write(reportFile.toPath(), report.toString(1).getBytes(StandardCharsets.UTF_8));
		System.out.println("load: loaded=" + report.opt("loaded") + " errors=" + (errs.isEmpty() ? "none" : errs.length() + " chars"));
		return 0;
	}

	static JSONArray describeBag(Bag bag) throws Exception {
		JSONArray arr = new JSONArray();
		for (Item it : bag.items) {
			JSONObject d = (JSONObject) describe(it);
			if (it instanceof Bag) d.put("contents", describeBag((Bag) it));
			arr.put(d);
		}
		return arr;
	}

	static int privInt(Object o, Class<?> c, String name) throws Exception {
		Field f = c.getDeclaredField(name);
		f.setAccessible(true);
		return f.getInt(o);
	}

	static Object describe(Item it) throws Exception {
		if (it == null) return JSONObject.NULL;
		JSONObject d = new JSONObject();
		d.put("class", it.getClass().getName());
		d.put("name", it.name());
		d.put("trueName", it.trueName());
		d.put("level", it.level());
		d.put("buffedLvl", it.buffedLvl());
		d.put("quantity", it.quantity());
		d.put("cursed", it.cursed);
		d.put("levelKnown", it.levelKnown);
		d.put("cursedKnown", it.cursedKnown);
		JSONObject fields = new JSONObject();
		for (Class<?> c = it.getClass(); c != null && c != Object.class; c = c.getSuperclass()) {
			for (Field f : c.getDeclaredFields()) {
				if (Modifier.isStatic(f.getModifiers())) continue;
				try { f.setAccessible(true); } catch (Throwable t) { continue; }
				Object v = f.get(it);
				String key = c.getSimpleName() + "." + f.getName();
				if (v == null) fields.put(key, JSONObject.NULL);
				else if (v instanceof Number || v instanceof Boolean || v instanceof String) fields.put(key, v);
				else if (v instanceof Enum) fields.put(key, ((Enum<?>) v).name());
				else if (v instanceof Collection) fields.put(key, "collection[" + ((Collection<?>) v).size() + "]");
				else if (v instanceof Map) fields.put(key, "map[" + ((Map<?, ?>) v).size() + "]");
				else fields.put(key, v.getClass().getName());
			}
		}
		d.put("fields", fields);
		return d;
	}
}
