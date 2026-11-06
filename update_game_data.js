// Generates docs/js/data.js from the Shattered Pixel Dungeon source code.
//
// Usage: clone https://github.com/00-Evan/shattered-pixel-dungeon into ./shattered-pixel-dungeon, then run
//   node update_game_data.js
//
// Optional: tools/item_templates.json (made by tools/harness, see tools/README.md) holds every item, enchantment and
// glyph exactly as the game itself saves a freshly created one. When present, it's merged in so items added by the
// editor get the same default values the game would give them, and it's used to double-check the parsed sprites.

import fs from "fs"
import path from "path"

const SPD = "./shattered-pixel-dungeon"
const JAVA = `${SPD}/core/src/main/java/com/shatteredpixel/shatteredpixeldungeon`
const PACKAGE = "com.shatteredpixel.shatteredpixeldungeon"
const OUTPUT = "./docs/js/data.js"
const TEMPLATES = "./tools/item_templates.json"

if (!fs.existsSync(SPD)) throw `Please ensure that there's a folder called "shattered-pixel-dungeon" in the same directory as this script.`

const get_file = (file) => fs.readFileSync(`${SPD}/${file}`, "utf-8")
const ERRORS = []

/* Metadata */

const build_gradle = get_file("build.gradle")
const SUPPORTED_GAME_VERSION = parseInt(build_gradle.match(/appVersionCode = (\d+)/)[1])
const SUPPORTED_GAME_VERSION_NAME = build_gradle.match(/appVersionName = '(.*)'/)[1]

/* Java class index */
// Every class declared under items/ and plants/, including nested classes (keyed "Outer$Inner"), so we can tell which
// ones are concrete Item subclasses the game can actually load from a save.

const CLASSES = {}

const index_java_file = (file) => {
	const source = fs.readFileSync(file, "utf-8")
	const package_name = source.match(/^package (.*);/m)[1]
	const declarations = [...source.matchAll(/^([ \t]*)((?:(?:public|protected|private|static|abstract|final)\s+)*)class\s+(\w+)(?:<[^>{]*>)?(?:\s+extends\s+([\w.]+))?/gm)]
	let stack = []

	declarations.forEach((match, i) => {
		const depth = match[1].replace(/ {4}/g, "\t").length
		const modifiers = match[2]
		const name = match[3]

		stack = stack.filter(entry => entry.depth < depth)
		const key = [...stack.map(entry => entry.name), name].join("$")
		stack.push({ depth, name })

		// The class body runs until the next class declaration, which is good enough to find its own initializer block
		const body = source.slice(match.index, i + 1 < declarations.length ? declarations[i + 1].index : undefined)

		CLASSES[`${package_name}.${key}`] = {
			fqcn: `${package_name}.${key}`,
			key,
			simple_name: name,
			package_name,
			super_ref: match[4] || null,
			abstract: modifiers.includes("abstract"),
			nested: stack.length > 1,
			static: stack.length == 1 || modifiers.includes("static"),
			image: (body.match(/\bimage\s*=\s*ItemSpriteSheet\.(\w+)\s*;/) || [])[1] || null,
			icon: (body.match(/\bicon\s*=\s*ItemSpriteSheet\.Icons\.(\w+)\s*;/) || [])[1] || null,
			file
		}
	})
}

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
	const full = path.join(dir, entry.name)
	if (entry.isDirectory()) walk(full)
	else if (entry.name.endsWith(".java")) index_java_file(full)
})
walk(`${JAVA}/items`)
walk(`${JAVA}/plants`)

const resolve_super = (cls) => {
	if (!cls.super_ref) return null
	const ref = cls.super_ref.replace(/\./g, "$")
	const candidates = Object.values(CLASSES).filter(other => other.key == ref || other.key.endsWith(`$${ref}`))
	// Prefer a class from the same file (sibling/parent nested classes), then a top-level class
	return candidates.find(other => other.file == cls.file && other.key != cls.key) ||
		candidates.find(other => !other.nested) ||
		candidates[0] ||
		null
}

const is_item_class = (cls) => {
	for (let current = cls, steps = 0; current && steps < 20; current = resolve_super(current), steps++) {
		if (current.fqcn == `${PACKAGE}.items.Item`) return true
	}
	return false
}

// Walks up the class hierarchy for the first sprite/icon assignment (some items inherit theirs)
const inherited = (cls, field) => {
	for (let current = cls, steps = 0; current && steps < 20; current = resolve_super(current), steps++) {
		if (current[field]) return current[field]
	}
	return null
}

/* Names */

const parse_properties = (file) => {
	const properties = {}
	get_file(file).split("\n").forEach(line => {
		const match = line.match(/^([^#=\s][^=]*)=(.*)$/)
		if (match) properties[match[1].trim()] = match[2].trim()
	})
	return properties
}
const ITEM_NAMES = parse_properties("core/src/main/assets/messages/items/items.properties")
const PLANT_NAMES = parse_properties("core/src/main/assets/messages/plants/plants.properties")

/* Items */

// Items that exist in the game, but never sit in the hero's inventory. They're still listed so saves that contain
// them display correctly, but they can't be added through the editor.
const NOT_ADDABLE = [
	/^keys\./, // keys go straight into the journal
	/^journal\./, // pages go straight into the journal
	/^gold$/, /^energycrystal$/, /^dewdrop$/, // turn into gold/energy/water when picked up
	/^lostbackpack$/, // only exists after dying with an unblessed ankh
	/^bags\.bag$/, // the hero's main backpack itself
	/^quest\.escapecrystal$/, // holds the hero's stashed gear during the Imp's vault quest
	/^artifacts\.driedrose\$petal$/, /^artifacts\.timekeepershourglass\$sandbag$/, // absorbed into their artifact on pickup
	/^bombs\.bomb\$doublebomb$/, // splits into two bombs on pickup
	/^plants\.blandfruitbush$/, // has no sprite, blandfruit bushes never drop seeds
]

// Internal helper classes the game only uses for its UI, these never appear in a save
const EXCLUDED = [/\$PlaceHolder$/, /\.TrinketCatalyst\$RandomTrinket$/]

let ITEMS = []

Object.values(CLASSES)
	.filter(cls => !cls.abstract && cls.static && is_item_class(cls))
	.filter(cls => !EXCLUDED.some(regex => regex.test(cls.fqcn)))
	.sort((a, b) => a.fqcn.localeCompare(b.fqcn))
	.forEach(cls => {
		const relative = cls.fqcn.replace(`${PACKAGE}.`, "")
		let id, name, seed = false

		if (relative.startsWith("plants.")) {
			// Seeds are nested classes, ex: plants.Sungrass$Seed
			const plant = relative.match(/^plants\.(\w+)\$Seed$/)
			if (!plant) return
			id = `plants.${plant[1].toLowerCase()}`
			name = PLANT_NAMES[`plants.${plant[1].toLowerCase()}$seed.name`]
			seed = true
		} else {
			id = relative.replace(/^items\./, "").toLowerCase()
			name = ITEM_NAMES[`items.${id}.name`]
		}

		// Classes without a name of their own are base classes or internal helpers, not real items
		if (!name) return

		const sprite_id = inherited(cls, "image")
		const icon_id = inherited(cls, "icon")

		let item = {
			id,
			name: name.toLowerCase(),
			game_id: cls.fqcn,
			addable: !NOT_ADDABLE.some(regex => regex.test(id)),
			sprite: {
				id: sprite_id,
				pos: null,
				clip: null,
				icon: { id: icon_id, pos: null, clip: null }
			}
		}
		if (seed) item.seed = true
		ITEMS.push(item)
	})

// Map exotic items to their regular counterparts

const exotic_ids = [
	...get_file("core/src/main/java/com/shatteredpixel/shatteredpixeldungeon/items/scrolls/exotic/ExoticScroll.java").matchAll(/exoToReg\.put\((.*), (.*)\);/gm),
	...get_file("core/src/main/java/com/shatteredpixel/shatteredpixeldungeon/items/potions/exotic/ExoticPotion.java").matchAll(/exoToReg\.put\((.*), (.*)\);/gm)
]

exotic_ids.forEach(exotic_id => {
	const exotic = exotic_id[1].replace(".class", "").trim()
	const regular = exotic_id[2].replace(".class", "").trim()

	let exotic_item = ITEMS.find(item => item.game_id.endsWith(`.${exotic}`))
	let regular_item = ITEMS.find(item => item.game_id.endsWith(`.${regular}`))

	if (exotic_item && regular_item) {
		exotic_item.regular_id = regular_item.id
	} else {
		ERRORS.push(`Couldn't map exotic item ${exotic} to ${regular}.`)
	}
})

/* Sprites */

// Positions are stored as 1-based grid coordinates (16x16 cells for items, 8x8 cells for icons), sizes as pixels
const SHEET_WIDTH = 16
const rxy = (raw) => ({ x: (raw % SHEET_WIDTH) + 1, y: Math.floor(raw / SHEET_WIDTH) + 1, raw })

const ItemSpriteSheet = get_file("core/src/main/java/com/shatteredpixel/shatteredpixeldungeon/sprites/ItemSpriteSheet.java")
const icons_start = ItemSpriteSheet.indexOf("public static class Icons")
const SHEETS = {
	items: ItemSpriteSheet.slice(0, icons_start),
	icons: ItemSpriteSheet.slice(icons_start)
}

const parse_sheet = (source) => {
	// Resolve every constant to its index on the sheet, in declaration order
	const constants = {}
	for (const match of source.matchAll(/(private|public) static final int (\w+)\s*=\s*([^;]+);/g)) {
		const name = match[2]
		const value = match[3].trim()
		if (["WIDTH", "SIZE", "TX_WIDTH", "TX_HEIGHT"].includes(name)) continue

		let raw
		const xy = value.match(/^xy\(\s*(\d+)\s*,\s*(\d+)\s*\)$/)
		const offset = value.match(/^(\w+)\s*\+\s*(\d+)$/)
		if (xy) {
			raw = (parseInt(xy[1]) - 1) + SHEET_WIDTH * (parseInt(xy[2]) - 1)
		} else if (offset && constants[offset[1]] !== undefined) {
			raw = constants[offset[1]].raw + parseInt(offset[2])
		} else if (constants[value] !== undefined) {
			raw = constants[value].raw
		} else {
			ERRORS.push(`Couldn't resolve sprite constant ${name} = ${value}.`)
			continue
		}
		constants[name] = { raw, category: match[1] == "private" }
	}

	// Apply size assignments in source order, so later ones override earlier loops (just like the game)
	const sizes = {}
	const statements = /for\s*\(\s*int i\s*=\s*(\w+)\s*;\s*i\s*<\s*(\w+)\s*\+\s*(\d+)\s*;\s*i\+\+\s*\)\s*assign(?:Item|Icon)Rect\(\s*i\s*,\s*(\d+)\s*,\s*(\d+)\s*\)|assign(?:Item|Icon)Rect\(\s*(\w+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g
	for (const match of source.matchAll(statements)) {
		if (match[1]) {
			const start = constants[match[1]]
			if (!start) { ERRORS.push(`Unknown sprite range start ${match[1]}.`); continue }
			for (let raw = start.raw; raw < start.raw + parseInt(match[3]); raw++) {
				sizes[raw] = { x: parseInt(match[4]), y: parseInt(match[5]) }
			}
		} else {
			if (match[6] == "i") continue
			const constant = constants[match[6]]
			if (!constant) { ERRORS.push(`Unknown sprite ${match[6]}.`); continue }
			sizes[constant.raw] = { x: parseInt(match[7]), y: parseInt(match[8]) }
		}
	}

	return { constants, sizes }
}

const ITEM_SHEET = parse_sheet(SHEETS.items)
const ICON_SHEET = parse_sheet(SHEETS.icons)

const sprite_for = (sheet, sprite_id) => {
	const constant = sheet.constants[sprite_id]
	if (!constant || constant.category) return null
	return { pos: rxy(constant.raw), clip: sheet.sizes[constant.raw] || { x: 16, y: 16 } }
}

ITEMS.forEach(item => {
	if (item.sprite.id) {
		const sprite = sprite_for(ITEM_SHEET, item.sprite.id)
		if (sprite) Object.assign(item.sprite, sprite)
		else ERRORS.push(`Sprite ${item.sprite.id} for ${item.id} not found.`)
	}
	if (item.sprite.icon.id) {
		const icon = sprite_for(ICON_SHEET, item.sprite.icon.id)
		if (icon) Object.assign(item.sprite.icon, icon)
		else ERRORS.push(`Icon ${item.sprite.icon.id} for ${item.id} not found.`)
	}
})

// Randomized appearances (potion colors, scroll runes, ring gems) that the save file assigns to each item type
const GENERIC_ITEMS = Object.entries(ITEM_SHEET.constants)
	.filter(([name, constant]) => !constant.category && /^(POTION|SCROLL|RING|EXOTIC)_/.test(name))
	.filter(([name]) => !ITEMS.some(item => item.sprite.id == name))
	.map(([name]) => ({ id: name, sprite: { id: name, ...sprite_for(ITEM_SHEET, name) } }))

/* Enchantments / Glyphs */

const list_classes = (dir, prefix) => fs.readdirSync(`${JAVA}/items/${dir}`)
	.filter(file => file.endsWith(".java"))
	.sort()
	.map(file => `${prefix}.${file.replace(".java", "")}`)

const ENCHANTMENTS = [
	...list_classes("weapon/enchantments", "weapon.enchantments"),
	...list_classes("weapon/curses", "weapon.curses"),
]

const GLYPHS = [
	...list_classes("armor/glyphs", "armor.glyphs"),
	...list_classes("armor/curses", "armor.curses"),
]

/* Templates (optional, from tools/harness) */

let ENCHANT_TEMPLATES = {}

if (fs.existsSync(TEMPLATES)) {
	const templates = JSON.parse(fs.readFileSync(TEMPLATES, "utf-8"))
	if (templates.version != SUPPORTED_GAME_VERSION) {
		ERRORS.push(`${TEMPLATES} was made for game version ${templates.version}, not ${SUPPORTED_GAME_VERSION}. Regenerate it with tools/harness.`)
	}

	const by_class = Object.fromEntries(templates.items.map(entry => [entry.className, entry]))
	ITEMS.forEach(item => {
		const entry = by_class[item.game_id]
		if (!entry) {
			ERRORS.push(`No template for ${item.game_id}, the editor will use generic defaults for it.`)
			return
		}
		item.bags = entry.bags
		const { __className, set_id, ...template } = entry.template
		if (set_id !== undefined) {
			// Every new set of thrown weapons gets a random ID, the editor makes a fresh one for each added item.
			// Darts are the exception and always share set 0.
			if (set_id == 0) template.set_id = 0
			else item.random_set_id = true
		}
		item.template = template

		// Double check the parsed sprites against the ones the game actually uses
		const check = (parsed, real, label) => {
			if (!real || !parsed.pos) return
			const parsed_rect = [(parsed.pos.x - 1) * (label == "icon" ? 8 : 16), (parsed.pos.y - 1) * (label == "icon" ? 8 : 16), parsed.clip.x, parsed.clip.y]
			const real_rect = [real.x, real.y, real.w, real.h]
			if (parsed_rect.join() != real_rect.join()) {
				ERRORS.push(`Parsed ${label} for ${item.id} is [${parsed_rect}], but the game uses [${real_rect}].`)
			}
		}
		if (!/^(potions|scrolls|rings)\./.test(item.id) || /\.(brews|elixirs)\./.test(item.id)) check(item.sprite, entry.sprite, "sprite")
		check(item.sprite.icon, entry.iconSprite, "icon")
	})

	templates.enchantments.forEach(entry => {
		const { __className, ...template } = entry.template
		if (Object.keys(template).length) {
			ENCHANT_TEMPLATES[entry.className.replace(`${PACKAGE}.items.`, "")] = template
		}
	})
} else {
	ERRORS.push(`${TEMPLATES} not found, so added items will use generic defaults. See tools/README.md.`)
}

/* Export */

const lines = []
lines.push("// This file was automatically generated by update_game_data.js. Do not edit it manually.")
lines.push(`// Generated from Shattered Pixel Dungeon v${SUPPORTED_GAME_VERSION_NAME} on ${new Date().toISOString().slice(0, 10)}`)
lines.push("")
lines.push(`const SUPPORTED_GAME_VERSION = ${SUPPORTED_GAME_VERSION};`)
lines.push(`const SUPPORTED_GAME_VERSION_NAME = ${JSON.stringify(SUPPORTED_GAME_VERSION_NAME)};`)
lines.push("")
lines.push(`const GENERIC_ITEMS = ${JSON.stringify(GENERIC_ITEMS, null, 2)};`)
lines.push(`const ITEMS = [\n${ITEMS.map(item => "  " + JSON.stringify(item)).join(",\n")}\n];`)
lines.push("")
lines.push(`const ENCHANTMENTS = ${JSON.stringify(ENCHANTMENTS, null, 2)};`)
lines.push(`const GLYPHS = ${JSON.stringify(GLYPHS, null, 2)};`)
lines.push(`const ENCHANT_TEMPLATES = ${JSON.stringify(ENCHANT_TEMPLATES, null, 2)};`)
lines.push("")
lines.push(`const ERRORS = ${JSON.stringify(ERRORS, null, 2)};`)

fs.writeFileSync(OUTPUT, lines.join("\n") + "\n")

console.log(`Wrote ${OUTPUT} for v${SUPPORTED_GAME_VERSION_NAME} (${SUPPORTED_GAME_VERSION}): ${ITEMS.length} items (${ITEMS.filter(item => item.addable).length} addable), ${ENCHANTMENTS.length} enchantments, ${GLYPHS.length} glyphs.`)
if (ERRORS.length) console.log(`${ERRORS.length} warnings:\n- ${ERRORS.join("\n- ")}`)
