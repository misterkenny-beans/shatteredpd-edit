// This file handles item lookups, item sprites and the enchantment/glyph dropdowns
const DEFAULT_SPRITE = "width: 8px; height: 14px;filter: invert(100);"
const CLASS_PREFIX = "com.shatteredpixel.shatteredpixeldungeon."

const find_item_schema = (class_name) => ITEMS.find(item => item.game_id === class_name)
const find_item_schema_by_id = (item_id) => ITEMS.find(item => item.id === item_id)

// Potions, scrolls and rings look different every run, the save file says which color/rune/gem each one got
const has_random_appearance = (item_schema) => /^(potions|scrolls|rings)\./.test(item_schema.id) && !/\.(brews|elixirs)\./.test(item_schema.id)

const sprite_style = (pos, clip, cell_size) =>
	`background-position: -${(pos.x - 1) * cell_size}px -${(pos.y - 1) * cell_size}px; width: ${clip.x}px; height: ${clip.y}px;`

const random_appearance_sprite = (item_schema) => {
	const regular = item_schema.regular_id ? find_item_schema_by_id(item_schema.regular_id) : item_schema
	if (!regular) return null

	const label = SAVE_FILE[`${regular.game_id.split(".").pop()}_label`]
	if (!label) return null

	const type = item_schema.regular_id ? "EXOTIC" : item_schema.id.split(".")[0].slice(0, -1).toUpperCase()
	const generic_item = GENERIC_ITEMS.find(item => item.id == `${type}_${label.toUpperCase()}`)
	if (!generic_item || !generic_item.sprite.pos) return null

	return sprite_style(generic_item.sprite.pos, generic_item.sprite.clip, 16)
}

const get_item_sprite = (item_id) => {
	const item_schema = find_item_schema_by_id(item_id)
	if (!item_schema) return DEFAULT_SPRITE

	if (has_random_appearance(item_schema)) {
		const appearance = random_appearance_sprite(item_schema)
		if (appearance) return appearance
	}
	if (item_schema.sprite.pos) return sprite_style(item_schema.sprite.pos, item_schema.sprite.clip, 16)

	return DEFAULT_SPRITE
}

// The little symbol drawn in the corner of potions, scrolls, rings, etc.
const get_item_small_sprite = (item_id) => {
	const item_schema = find_item_schema_by_id(item_id)
	if (!item_schema || !item_schema.sprite.icon || !item_schema.sprite.icon.pos) return "display: none;"

	return sprite_style(item_schema.sprite.icon.pos, item_schema.sprite.icon.clip, 8)
}

/* Enchantments & glyphs */

const item_kind = (item_schema) => {
	if (!item_schema) return null
	if (item_schema.id.startsWith("weapon.")) return "weapon"
	if (item_schema.id.startsWith("armor.")) return "armor"
	return null
}

const enchantment_name = (enchant) => enchant.split(".").pop().replace(/([a-z])([A-Z])/g, "$1 $2")

const get_enchantments = (item_id, current_enchantment) => {
	const kind = item_kind(find_item_schema_by_id(item_id))
	if (!kind) return `<option value="none" selected>N/A</option>`

	const list = kind == "weapon" ? ENCHANTMENTS : GLYPHS
	let output = `<option value="none" ${!current_enchantment || current_enchantment == "none" ? "selected" : ""}>None</option>`
	let in_curses = false

	list.forEach(enchant => {
		if (enchant.includes(".curses.") && !in_curses) {
			output += `<hr>`
			in_curses = true
		}
		output += `<option value="${enchant}" ${enchant == current_enchantment ? "selected" : ""}>${enchantment_name(enchant)}${in_curses ? " (curse)" : ""}</option>`
	})

	// Keep unknown enchantments from newer game versions instead of silently dropping them
	if (current_enchantment && current_enchantment != "none" && !list.includes(current_enchantment)) {
		output += `<option value="${current_enchantment}" selected>${enchantment_name(current_enchantment)}</option>`
	}

	return output
}

// Reads the enchantment (weapons) or glyph (armor) of an item, ex: "weapon.enchantments.Vorpal"
const get_item_enchantment = (item_json) => {
	const enchant = item_json.enchantment || item_json.glyph
	if (!enchant || !enchant["__className"]) return "none"
	return enchant["__className"].replace(`${CLASS_PREFIX}items.`, "")
}

// Applies an enchantment/glyph to an item's JSON, keeping its saved state if it didn't change
const set_item_enchantment = (item_json, enchant) => {
	const kind = item_kind(find_item_schema(item_json["__className"]))
	if (!kind) return

	const key = kind == "weapon" ? "enchantment" : "glyph"
	if (enchant == "none") {
		delete item_json[key]
		return
	}

	const class_name = `${CLASS_PREFIX}items.${enchant}`
	if (!item_json[key] || item_json[key]["__className"] !== class_name) {
		// Some enchantments have state of their own (ex: crystal durability), which needs a valid starting value
		item_json[key] = { ...(ENCHANT_TEMPLATES[enchant] || {}), "__className": class_name }
	}
}
