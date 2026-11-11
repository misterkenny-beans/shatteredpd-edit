const JSON_FORM_MAP = {
	"form_game_seed": "seed",
	"form_game_version": "version",
	"form_game_current_depth": "depth",
	// "form_game_max_depth": "maxDepth",
	"form_game_amuletobtained": "amuletObtained",

	"form_hero_hp": "hero.HP",
	"form_hero_maxhp": "hero.HT",

	"form_hero_strength": "hero.STR",

	"form_hero_attack": "hero.attackSkill",
	"form_hero_defense": "hero.defenseSkill",

	"form_hero_level": "hero.lvl",
	"form_hero_experience": "hero.exp",

	"form_hero_gold": "gold",
	"form_hero_energy": "energy",
}

const HERO_SUBCLASSES = {
	WARRIOR: ["BERSERKER", "GLADIATOR"],
	MAGE: ["BATTLEMAGE", "WARLOCK"],
	ROGUE: ["ASSASSIN", "FREERUNNER"],
	HUNTRESS: ["SNIPER", "WARDEN"],
	DUELIST: ["CHAMPION", "MONK"],
	CLERIC: ["PRIEST", "PALADIN"],
}

const get_path = (object, path) => path.split(".").reduce((value, key) => value == null ? undefined : value[key], object)
const set_path = (object, path, value) => {
	const keys = path.split(".")
	const last = keys.pop()
	keys.reduce((value, key) => value[key], object)[last] = value
}

// Updates all form values with the values from SAVE_FILE
const deserializeFormJSON = () => {
	Object.keys(JSON_FORM_MAP).forEach(key => {
		try {
			const formElement = document.querySelector(`#${key}`)
			const value = get_path(SAVE_FILE, JSON_FORM_MAP[key])

			if (formElement.type === "checkbox") {
				formElement.checked = !!value
			} else {
				formElement.value = value ?? ""
			}
		} catch (err) {
			console.log(`deserializeFormJSON error with ${key} (${JSON_FORM_MAP[key]}):`)
			console.error(err)
			show_warning("Failed to deserialize save file. Check browser console for details.")
		}
	})

	derserialize_inventory()

	document.querySelector("#form_hero_class").value = SAVE_FILE.hero.class
	if (SAVE_FILE.hero.subClass && SAVE_FILE.hero.subClass !== "NONE") {
		document.querySelector("#form_hero_class").value = SAVE_FILE.hero.subClass
	}
}

// Updates SAVE_FILE with values from the form
const serializeFormJSON = () => {
	Object.keys(JSON_FORM_MAP).forEach(key => {
		const formElement = document.querySelector(`#${key}`)
		if (!formElement) return
		const path = JSON_FORM_MAP[key]

		if (formElement.type === "checkbox") {
			set_path(SAVE_FILE, path, formElement.checked)
			return
		}

		// Blank fields keep their old value, the game would otherwise read them as 0
		const text = formElement.value.trim()
		if (text === "") return

		// The game saves these as numbers, so write them back as numbers
		const previous = get_path(SAVE_FILE, path)
		if (typeof previous === "number" || formElement.type === "number") {
			const number = Number(text)
			if (Number.isFinite(number)) set_path(SAVE_FILE, path, Math.round(number))
		} else {
			set_path(SAVE_FILE, path, text)
		}
	})

	serialize_inventory()

	let new_class = document.querySelector("#form_hero_class").value
	if (HERO_SUBCLASSES[new_class]) {
		SAVE_FILE.hero.class = new_class
		SAVE_FILE.hero.subClass = "NONE"
	} else if (new_class) {
		SAVE_FILE.hero.subClass = new_class
		SAVE_FILE.hero.class = Object.keys(HERO_SUBCLASSES).find(hero_class => HERO_SUBCLASSES[hero_class].includes(new_class))
	}

	if (document.querySelector("#form_game_identifyall").checked) {
		Object.keys(SAVE_FILE).filter(key => key.endsWith("_known")).forEach(key => {
			SAVE_FILE[key] = true
		})

		for_each_hero_item(identify_item_json)
	}
}

// Clear all form inputs
const clearForm = () => {
	Object.keys(JSON_FORM_MAP).forEach(key => {
		document.querySelector(`#${key}`).value = ""

		if (document.querySelector(`#${key}`).type === "checkbox") {
			document.querySelector(`#${key}`).checked = false
		}
	})

	reset_inventory()

	document.querySelectorAll("input").forEach(input => {input.disabled = true; input.value = ""; input.checked = false;})
	document.querySelectorAll("select").forEach(input => {input.disabled = true; input.value = ""})
	document.querySelectorAll("button").forEach(input => input.disabled = true)
	document.querySelector("#form_file").disabled = false
	document.querySelector("#warning").style.display = "none"
}

// Enables the main form controls once a save is loaded (inventory rows manage their own)
const enableForm = () => {
	document.querySelectorAll("#section_meta input, #section_meta button, #section_game input, #section_hero input, #section_hero select, #form_inventory_main_additem")
		.forEach(input => input.disabled = false)
}

document.querySelector("#form_reset").addEventListener("click", () => {
	if (confirm("Are you sure you want to reset all values?")) {
		clearForm()
	}
})

document.querySelector("#form_editjson").addEventListener("click", () => {
	serializeFormJSON()
	spawn_popup("editjson").then(() => {
		document.querySelector("#popup_editjson_json").value = stringify_save_json(SAVE_FILE, 2)
	})
})
