// Shattered stores some 64-bit numbers in its saves (item generator seeds, thrown weapon set IDs) that are too big for
// JavaScript numbers. JSON.parse would silently round them, which changes the run's loot and can break thrown weapon
// sets. These helpers keep those numbers as exact strings while editing and write them back out untouched.

const BIG_NUMBER_PREFIX = "spud:bignumber:"

// Matches whole JSON strings (so digits inside them are left alone) or integer literals
const JSON_TOKEN_REGEX = /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g

const parse_save_json = (text) => {
	const protected_text = text.replace(JSON_TOKEN_REGEX, token => {
		if (token[0] === '"' || !/^-?\d+$/.test(token) || Number.isSafeInteger(Number(token))) return token
		return `"${BIG_NUMBER_PREFIX}${token}"`
	})
	return JSON.parse(protected_text)
}

const stringify_save_json = (value, indent) => {
	const text = JSON.stringify(value, null, indent)
	return text.replace(new RegExp(`"${BIG_NUMBER_PREFIX}(-?\\d+)"`, "g"), "$1")
}

// Random ID for a new thrown weapon set, kept within the range JavaScript can represent exactly
const random_set_id = () => {
	const id = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER) + 1
	return Math.random() < 0.5 ? -id : id
}
