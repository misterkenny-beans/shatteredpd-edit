// This file handles the hero's equipment, backpack and bags
const EQUIPMENT_SLOTS = [
	{ key: "weapon", element: "#form_inventory_active_weapon" },
	{ key: "armor", element: "#form_inventory_active_armor" },
	{ key: "artifact", element: "#form_inventory_active_artifact" },
	{ key: "misc", element: "#form_inventory_active_artifactorring" },
	{ key: "ring", element: "#form_inventory_active_ring" },
	{ key: "second_wep", element: "#form_inventory_active_secondweapon" }, // Champion's second weapon
]

const MAIN_TABLE = () => document.querySelector("#form_inventory_main")
const BAGS_CONTAINER = () => document.querySelector("#form_inventory_bags")
const table_rows = (table) => [...table.querySelector("tbody.inventory_rows").children].filter(row => row.classList.contains("inventory_item"))

var inventory_item_counter = 0
var bag_section_counter = 0

const title_case = (text) => text.replace(/\b\w/g, letter => letter.toUpperCase())

const item_display_name = (item_json, item_schema) => {
	if (item_schema) return item_schema.name
	// Items this version of the editor doesn't know about are kept as-is, so nothing gets lost
	return `unknown item (${String(item_json["__className"]).split(".").pop()})`
}

/* Rows */

const ITEM_ROW_CELLS = `
	<td>
		<div class="item_icon form_inventory_generic_icon"></div>
		<div class="item_small_icon"></div>
	</td>
	<td class="form_inventory_generic_name"></td>
	<td><input type="number" class="smaller form_inventory_generic_level"></td>
	<td><input type="number" class="smaller form_inventory_generic_quantity" min="1"></td>
	<td><select class="form_inventory_generic_enchant"></select></td>
	<td><input type="checkbox" class="form_inventory_generic_cursed"></td>
	<td>
		<button onclick="button_editjson(this)">json</button>
		<button onclick="button_delete(this)">delete</button>
	</td>`

// Fills a row's inputs from an item's JSON
const render_item_row = (row, item_json) => {
	const item_schema = find_item_schema(item_json["__className"])
	const item_id = item_schema ? item_schema.id : ""

	row.querySelector(".form_inventory_generic_icon").style = item_schema ? get_item_sprite(item_id) : DEFAULT_SPRITE
	row.querySelector(".item_small_icon").style = item_schema ? get_item_small_sprite(item_id) : "display: none;"
	row.querySelector(".form_inventory_generic_name").innerText = item_display_name(item_json, item_schema)
	row.querySelector(".form_inventory_generic_level").value = item_json.level ?? 0
	row.querySelector(".form_inventory_generic_quantity").value = item_json.quantity ?? 1
	row.querySelector(".form_inventory_generic_enchant").innerHTML = get_enchantments(item_id, get_item_enchantment(item_json))
	row.querySelector(".form_inventory_generic_enchant").disabled = !item_kind(item_schema)
	row.querySelector(".form_inventory_generic_cursed").checked = !!item_json.cursed
	row.querySelectorAll("input, button").forEach(input => input.disabled = false)

	row.dataset.json = JSON.stringify(item_json)
}

const create_item_row = (item_json) => {
	const row = document.createElement("tr")
	row.className = "inventory_item form_inventory_main_item"
	row.id = `form_inventory_generic_${inventory_item_counter++}`
	row.innerHTML = ITEM_ROW_CELLS
	render_item_row(row, item_json)
	return row
}

// Applies a level change the way upgrading does in-game, so wand charges keep up
const apply_level_change = (item_json, old_level, new_level) => {
	item_json.level = new_level
	const delta = new_level - old_level
	if (!delta) return

	const adjust_wand = (wand_json, bonus_charges) => {
		if (typeof wand_json.curCharges !== "number") return
		const wand_schema = find_item_schema(wand_json["__className"])
		const initial_charges = wand_schema && wand_schema.template ? wand_schema.template.curCharges : 2
		const max_charges = Math.max(0, Math.min(initial_charges + wand_json.level, 10) + bonus_charges)
		wand_json.curCharges = Math.max(0, Math.min(wand_json.curCharges + delta, max_charges))
	}

	if (item_json.wand && item_json.wand["__className"]) {
		// The mage's staff keeps its imbued wand at the same level as itself (and gives it a bonus charge)
		item_json.wand.level = new_level
		adjust_wand(item_json.wand, 1)
	} else {
		adjust_wand(item_json, 0)
	}
}

// Reads a row's inputs back into its item JSON
const read_item_row = (row) => {
	let item_json = JSON.parse(row.dataset.json)

	const level = Number(row.querySelector(".form_inventory_generic_level").value)
	const quantity = Number(row.querySelector(".form_inventory_generic_quantity").value)
	if (Number.isFinite(level)) apply_level_change(item_json, item_json.level ?? 0, Math.round(level))
	if (Number.isFinite(quantity) && quantity >= 1) item_json.quantity = Math.round(quantity)
	item_json.cursed = row.querySelector(".form_inventory_generic_cursed").checked
	set_item_enchantment(item_json, row.querySelector(".form_inventory_generic_enchant").value)

	if (row.dataset.bag_section) {
		item_json.inventory = table_rows(document.querySelector(`#${row.dataset.bag_section} table`)).map(read_item_row)
	}

	row.dataset.json = JSON.stringify(item_json)
	return item_json
}

/* Equipment */

const fill_equipment_slot = (element, item_json) => {
	render_item_row(element, item_json)
}

const clear_equipment_slot = (element) => {
	element.querySelector(".form_inventory_generic_icon").style = element.dataset.empty_style
	element.querySelector(".item_small_icon").style = "display: none;"
	element.querySelector(".form_inventory_generic_name").innerHTML = "&nbsp;"
	element.querySelector(".form_inventory_generic_level").value = ""
	element.querySelector(".form_inventory_generic_quantity").value = ""
	element.querySelector(".form_inventory_generic_enchant").innerHTML = get_enchantments("")
	element.querySelector(".form_inventory_generic_cursed").checked = false
	element.querySelectorAll("input, select, button").forEach(input => input.disabled = true)
	element.dataset.json = ""
}

/* Bags */

const bag_class = (item_json) => String(item_json["__className"]).split(".").pop()

const create_bag_section = (bag_row, item_json) => {
	const section = document.createElement("div")
	section.className = "form_inventory_bag"
	section.id = `form_inventory_bag_${bag_section_counter++}`
	section.dataset.bag_class = bag_class(item_json)
	section.innerHTML = `
		<h3 class="form_inventory_bag_title"></h3>
		<div class="form_inventory_container">
			<table class="inventory">
				${INVENTORY_TABLE_HEADER}
				<tbody class="inventory_rows"></tbody>
			</table>
		</div>`
	// Number duplicate bags (ex: a second velvet pouch) so they can be told apart
	const same_kind = BAGS_CONTAINER().querySelectorAll(`.form_inventory_bag[data-bag_class="${section.dataset.bag_class}"]`).length
	section.querySelector(".form_inventory_bag_title").innerText =
		title_case(item_display_name(item_json, find_item_schema(item_json["__className"]))) + (same_kind ? ` ${same_kind + 1}` : "")
	BAGS_CONTAINER().appendChild(section)
	bag_row.dataset.bag_section = section.id
	return section
}

const INVENTORY_TABLE_HEADER = `
	<colgroup>
		<col span="1" style="width: 1%;">
		<col span="1" style="width: 25%;">
		<col span="1" style="width: 1%;">
		<col span="1" style="width: 1%;">
		<col span="1" style="width: 10%;">
		<col span="1" style="width: 1%;">
		<col span="1" style="width: 10%;">
	</colgroup>
	<thead>
		<tr>
			<th></th>
			<th>Name</th>
			<th>Level</th>
			<th>Quantity</th>
			<th>Enchant</th>
			<th>Cursed</th>
			<th>Actions</th>
		</tr>
	</thead>`

// Adds an item to a table. Bags in the main backpack get a section of their own for their contents.
const add_inventory_item = (item_json, table) => {
	const row = create_item_row(item_json)
	table.querySelector("tbody.inventory_rows").appendChild(row)

	if (table === MAIN_TABLE() && Array.isArray(item_json.inventory)) {
		const section = create_bag_section(row, item_json)
		item_json.inventory.forEach(content => add_inventory_item(content, section.querySelector("table")))
	}
	return row
}

/* Save file <-> form */

const derserialize_inventory = () => {
	EQUIPMENT_SLOTS.forEach(slot => {
		const element = document.querySelector(slot.element)
		const item_json = SAVE_FILE.hero[slot.key]
		if (item_json && item_json["__className"]) fill_equipment_slot(element, item_json)
		else clear_equipment_slot(element)
	})

	;(SAVE_FILE.hero.inventory || []).forEach(item_json => add_inventory_item(item_json, MAIN_TABLE()))
}

const serialize_inventory = () => {
	EQUIPMENT_SLOTS.forEach(slot => {
		const element = document.querySelector(slot.element)
		if (element.dataset.json) {
			SAVE_FILE.hero[slot.key] = read_item_row(element)
		} else {
			delete SAVE_FILE.hero[slot.key]
		}
	})

	SAVE_FILE.hero.inventory = table_rows(MAIN_TABLE()).map(read_item_row)
	sync_thrown_weapon_sets()
}

// Calls back for every item the hero has: equipped, in the backpack, in bags, and wands imbued into the mage's staff
const for_each_hero_item = (callback) => {
	const visit = (item_json) => {
		if (!item_json || !item_json["__className"]) return
		callback(item_json)
		if (item_json.wand) visit(item_json.wand)
		if (Array.isArray(item_json.inventory)) item_json.inventory.forEach(visit)
	}
	EQUIPMENT_SLOTS.forEach(slot => visit(SAVE_FILE.hero[slot.key]))
	;(SAVE_FILE.hero.inventory || []).forEach(visit)
}

// Since v4.0 the hero remembers each thrown weapon set's upgrades and enchantment. Thrown weapons that don't match it
// get turned to dust or lose their enchantment when picked up, so it has to follow any changes made here.
const sync_thrown_weapon_sets = () => {
	const tracker = (SAVE_FILE.hero.buffs || []).find(buff => String(buff["__className"]).endsWith("MissileWeapon$UpgradedSetTracker"))
	if (!tracker) return

	for_each_hero_item(item_json => {
		if (item_json.set_id === undefined) return
		const set_id = String(item_json.set_id)
		const level = item_json.level ?? 0

		const level_index = (tracker.set_ids || []).findIndex(id => String(id) === set_id)
		if (level_index >= 0 && tracker.set_levels[level_index] > level) {
			tracker.set_levels[level_index] = level
		}

		const enchant_index = (tracker.set_ids_enchants || []).findIndex(id => String(id) === set_id)
		const enchant = item_json.enchantment ? item_json.enchantment["__className"] : null
		if (enchant_index >= 0 && tracker.set_enchants[enchant_index] !== enchant) {
			if (enchant) {
				tracker.set_enchants[enchant_index] = enchant
			} else {
				tracker.set_ids_enchants.splice(enchant_index, 1)
				tracker.set_enchants.splice(enchant_index, 1)
			}
		}
	})
}

// Marks an item (and, for potions/scrolls/rings, its whole type) as identified
const identify_item_json = (item_json) => {
	if (item_json.levelKnown !== undefined) item_json.levelKnown = true
	if (item_json.cursedKnown !== undefined) item_json.cursedKnown = true
	if (item_json.curChargeKnown !== undefined) item_json.curChargeKnown = true

	const item_schema = find_item_schema(item_json["__className"])
	if (item_schema && has_random_appearance(item_schema)) {
		const regular = item_schema.regular_id ? find_item_schema_by_id(item_schema.regular_id) : item_schema
		const key = `${regular.game_id.split(".").pop()}_known`
		if (key in SAVE_FILE) SAVE_FILE[key] = true
	}
}

const reset_inventory = () => {
	table_rows(MAIN_TABLE()).forEach(row => row.remove())
	BAGS_CONTAINER().innerHTML = ""
	EQUIPMENT_SLOTS.forEach(slot => clear_equipment_slot(document.querySelector(slot.element)))
}

/* Buttons */

const row_of = (element) => element.closest("tr")

const button_editjson = (element) => {
	const row = row_of(element)
	if (!row.dataset.json) return

	const item_json = read_item_row(row)
	spawn_popup("edititemjson").then(() => {
		document.querySelector("#popup_edititemjson_json").value = stringify_save_json(item_json, 2)
		document.querySelector("#popup_edititemjson_json").dataset.element_id = row.id
	})
}

const button_delete = (element) => {
	const row = row_of(element)

	if (row.classList.contains("form_inventory_active_item")) {
		clear_equipment_slot(row)
		return
	}

	if (row.dataset.bag_section) {
		const section = document.querySelector(`#${row.dataset.bag_section}`)
		const contents = table_rows(section.querySelector("table")).length
		if (contents && !confirm(`Delete this bag and the ${contents} item${contents == 1 ? "" : "s"} inside it?`)) return
		section.remove()
	}
	row.remove()
}

document.querySelector("#form_inventory_main_additem").addEventListener("click", () => {
	spawn_popup("additem").then(popup_additem_setup)
})
