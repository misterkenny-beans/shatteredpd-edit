const spawn_popup = async (id) => {
	let req = await fetch(`./popups/${id}.html`)
	let html = await req.text()

	let overlay = document.createElement("div")
	overlay.classList.add("popup_background")

	let popup = document.createElement("div")
	popup.id = `popup_${id}`
	popup.classList.add("popup")
	popup.innerHTML = html

	document.body.insertBefore(overlay, document.querySelector("#main"))
	document.body.insertBefore(popup, document.querySelector("#main"))
}

const remove_popup = (id) => {
	document.querySelector(`#popup_${id}`)?.remove()
	document.querySelector(".popup_background")?.remove()
}

/* Popup events */

document.addEventListener("keydown", (e) => {
	if (e.key == "Escape") {
		document.querySelector(".popup_background")?.remove()
		document.querySelector(".popup")?.remove()
	}
})

const popup_editjson_cancel_onclick = () => {
	remove_popup("editjson")
}

const popup_editjson_save_onclick = () => {
	let json = document.querySelector("#popup_editjson_json").value

	try {
		SAVE_FILE = parse_save_json(json)
	} catch (err) {
		console.error(err)
		show_warning("Failed to parse custom JSON, nothing was changed.")
		return
	}
	reset_inventory()
	deserializeFormJSON()
	remove_popup("editjson")
}

const popup_edititemjson_cancel_onclick = () => {
	remove_popup("edititemjson")
}

const popup_edititemjson_save_onclick = () => {
	let json_text = document.querySelector("#popup_edititemjson_json").value
	let element_id = document.querySelector("#popup_edititemjson_json").dataset.element_id
	let row = document.querySelector(`#${element_id}`)

	let item_json
	try {
		item_json = parse_save_json(json_text)
		if (!item_json || typeof item_json["__className"] !== "string") throw "Missing __className"
	} catch (err) {
		console.error(err)
		show_warning(`Failed to parse custom JSON, the item wasn't changed.`)
		return
	}

	render_item_row(row, item_json)

	// Rebuild a bag's contents from the edited JSON
	if (row.dataset.bag_section) {
		document.querySelector(`#${row.dataset.bag_section}`)?.remove()
		delete row.dataset.bag_section
		if (Array.isArray(item_json.inventory)) {
			const section = create_bag_section(row, item_json)
			item_json.inventory.forEach(content => add_inventory_item(content, section.querySelector("table")))
		}
	}

	remove_popup("edititemjson")
}

// popups/extra.html isn't hooked up to anything yet
const popup_extra_save_onclick = () => {
	remove_popup("extra")
}

const popup_extra_cancel_onclick = () => {
	remove_popup("extra")
}

/* Add item */

const ITEM_CATEGORIES = [
	["weapon.melee.", "Melee weapons"],
	["weapon.missiles.", "Thrown weapons"],
	["weapon.", "Weapons"],
	["armor.", "Armor"],
	["wands.", "Wands"],
	["rings.", "Rings"],
	["artifacts.", "Artifacts"],
	["trinkets.", "Trinkets"],
	["potions.exotic.", "Exotic potions"],
	["potions.brews.", "Brews"],
	["potions.elixirs.", "Elixirs"],
	["potions.", "Potions"],
	["scrolls.exotic.", "Exotic scrolls"],
	["scrolls.", "Scrolls"],
	["spells.", "Spells"],
	["stones.", "Runestones"],
	["plants.", "Seeds"],
	["food.", "Food"],
	["bombs.", "Bombs"],
	["bags.", "Bags"],
	["remains.", "Remains"],
	["quest.", "Quest items"],
	["", "Other"],
]
const item_category = (item_schema) => ITEM_CATEGORIES.find(([prefix]) => item_schema.id.startsWith(prefix))[1]

// Which bag the game would put an item in, for items without data from tools/item_templates.json
const FALLBACK_BAGS = [
	[/^(plants|stones)\./, "VelvetPouch"],
	[/^(scrolls|spells)\./, "ScrollHolder"],
	[/^potions\.|^waterskin$/, "PotionBandolier"],
	[/^(wands|weapon\.missiles|bombs)\./, "MagicalHolster"],
]

// Items without a template get the defaults every item of their kind needs to load correctly
const generic_item_template = (item_schema) => {
	let json = { "cursedKnown": false, "quantity": 1, "levelKnown": false, "cursed": false, "level": 0, "kept_lost": false }
	if (/^(weapon|armor)\./.test(item_schema.id)) json.augment = "NONE" // the game picks the first augment if missing
	if (item_schema.id.startsWith("weapon.missiles.")) Object.assign(json, { durability: 100, spawned: false, extra_left: false })
	if (item_schema.id.startsWith("rings.")) json.levels_to_ID = 1
	return json
}

const create_item_json = (item_schema, options) => {
	let json = item_schema.template ? JSON.parse(JSON.stringify(item_schema.template)) : generic_item_template(item_schema)
	json["__className"] = item_schema.game_id

	// Every newly found set of thrown weapons gets its own ID (darts all share one)
	if (item_schema.random_set_id || (!item_schema.template && item_schema.id.startsWith("weapon.missiles."))) {
		json.set_id = random_set_id()
	}
	if (options.quantity) json.quantity = options.quantity
	if (options.level) apply_level_change(json, json.level ?? 0, options.level)
	if (options.identified) identify_item_json(json)

	return json
}

const additem_destinations = () => {
	let destinations = [{ value: "auto", label: "Where the game would put it" }, { value: "backpack", label: "Backpack" }]
	document.querySelectorAll("#form_inventory_bags .form_inventory_bag").forEach(section => {
		destinations.push({ value: section.id, label: section.querySelector(".form_inventory_bag_title").innerText })
	})
	return destinations
}

const additem_target_table = (item_schema, destination) => {
	if (destination == "backpack") return MAIN_TABLE()
	if (destination != "auto") return document.querySelector(`#${destination} table`) || MAIN_TABLE()

	// Bags never go inside other bags
	if (item_schema.id.startsWith("bags.")) return MAIN_TABLE()

	const bags = item_schema.bags || FALLBACK_BAGS.filter(([regex]) => regex.test(item_schema.id)).map(([, bag]) => bag)
	for (const bag of bags) {
		const section = document.querySelector(`#form_inventory_bags .form_inventory_bag[data-bag_class="${bag}"]`)
		if (section) return section.querySelector("table")
	}
	return MAIN_TABLE()
}

const popup_additem_setup = () => {
	const list = document.querySelector("#popup_additem_list tbody")
	const category_select = document.querySelector("#popup_additem_category")

	const addable = ITEMS.filter(item_schema => item_schema.addable && item_schema.game_id)
	const categories = ITEM_CATEGORIES.map(([, name]) => name).filter(name => addable.some(item_schema => item_category(item_schema) == name))
	category_select.innerHTML = `<option value="">All items</option>` + categories.map(name => `<option>${name}</option>`).join("")

	document.querySelector("#popup_additem_destination").innerHTML = additem_destinations()
		.map(destination => `<option value="${destination.value}">${destination.label}</option>`).join("")

	addable
		.sort((a, b) => categories.indexOf(item_category(a)) - categories.indexOf(item_category(b)) || a.name.localeCompare(b.name))
		.forEach(item_schema => {
			list.insertAdjacentHTML("beforeend", `<tr class="popup_additem_row" data-category="${item_category(item_schema)}">
				<td>
					<div class="item_icon" style="${get_item_sprite(item_schema.id)}"></div>
					<div class="item_small_icon" style="${get_item_small_sprite(item_schema.id)}"></div>
				</td>
				<td><a data-item_id="${item_schema.id}" class="popup_additem_list_item" href="javascript:void(0);" onclick="popup_additem(this)">${item_schema.name}</a></td>
				<td class="popup_additem_category_cell">${item_category(item_schema)}</td>
			</tr>`)
		})

	document.querySelector("#popup_additem_search").addEventListener("input", popup_additem_filter)
	category_select.addEventListener("change", popup_additem_filter)
	document.querySelector("#popup_additem_search").focus()
}

const popup_additem_filter = () => {
	const search = document.querySelector("#popup_additem_search").value.trim().toLowerCase()
	const category = document.querySelector("#popup_additem_category").value

	document.querySelectorAll("#popup_additem_list .popup_additem_row").forEach(row => {
		const name = row.querySelector(".popup_additem_list_item").innerText.toLowerCase()
		row.style.display = (!search || name.includes(search)) && (!category || row.dataset.category == category) ? "" : "none"
	})
}

const popup_additem_cancel_onclick = () => {
	remove_popup("additem")
}

const popup_additem = (element) => {
	const item_schema = find_item_schema_by_id(element.dataset.item_id)
	const quantity = parseInt(document.querySelector("#popup_additem_quantity").value)
	const level = parseInt(document.querySelector("#popup_additem_level").value)

	const json = create_item_json(item_schema, {
		quantity: quantity >= 1 ? quantity : null,
		level: Number.isFinite(level) ? level : 0,
		identified: document.querySelector("#popup_additem_identified").checked,
	})

	const table = additem_target_table(item_schema, document.querySelector("#popup_additem_destination").value)
	add_inventory_item(json, table)

	// Adding a bag lets you put things straight into it
	if (item_schema.id.startsWith("bags.")) {
		const destination = document.querySelector("#popup_additem_destination")
		const selected = destination.value
		destination.innerHTML = additem_destinations().map(d => `<option value="${d.value}">${d.label}</option>`).join("")
		destination.value = selected
	}

	const where = table === MAIN_TABLE() ? "backpack" : table.closest(".form_inventory_bag").querySelector(".form_inventory_bag_title").innerText.toLowerCase()
	document.querySelector("#popup_additem_status").innerText = `Added ${json.quantity > 1 ? json.quantity + "x " : ""}${item_schema.name} to the ${where}.`
}
