// This file is responsible for handling save file uploads/downloads
const SAVE_FILE_INPUT = document.querySelector("#form_file")
const DOWNLOAD_BUTTON = document.querySelector("#form_download")

let SAVE_FILE = {}

const version_warning = (version) => {
	if (version === SUPPORTED_GAME_VERSION) return null
	const supported = `v${SUPPORTED_GAME_VERSION_NAME} (${SUPPORTED_GAME_VERSION})`
	if (version > SUPPORTED_GAME_VERSION) {
		return `This save is from a newer version of the game (${version}) than the editor supports, ${supported}. New items may show up as unknown, but they'll be kept as-is.`
	}
	return `This save is from an older version of the game (${version}), the editor is made for ${supported}. Open it in the game once and save, then edit it here.`
}

// handle file uploads
SAVE_FILE_INPUT.addEventListener("change", function(event) {
	var file = SAVE_FILE_INPUT.files[0]
	var reader = new FileReader()

	if (!file) return console.log("no file uploaded?")
	reader.onload = function() {
		try {
			// game.dat is gzipped JSON, but plain JSON (ex: exported from the JSON editor) works too
			let bytes = new Uint8Array(reader.result)
			let is_gzip = bytes[0] === 0x1f && bytes[1] === 0x8b
			var text = new TextDecoder().decode(is_gzip ? pako.ungzip(bytes) : bytes)
			console.log(`read ${is_gzip ? "gzipped" : "plain"} save data`)
			var json = parse_save_json(text)
			console.log("parsed save data")
			console.log(json)

			if (!json.hero) throw "This doesn't look like a game.dat file (no hero found)."

			SAVE_FILE = json
			clearForm()
			enableForm()
			deserializeFormJSON()

			const warning = version_warning(SAVE_FILE["version"])
			if (warning) show_warning(warning)
		} catch (err) {
			console.log("failed to read file!")
			console.error(err)
			show_warning(`Failed to read save file. ${typeof err === "string" ? err : "Check browser console for details."}`)
		}
	}

	console.log("reading file")
	reader.readAsArrayBuffer(file)
})

DOWNLOAD_BUTTON.addEventListener("click", function() {
	serializeFormJSON()
	var string = stringify_save_json(SAVE_FILE)
	var compressed = pako.gzip(string)
	console.log("gzipped save data")

	// create a blob from the compressed data
	var blob = new Blob([compressed], { type: "application/gzip" })

	// create a link element to download the blob
	var link = document.createElement("a")
	link.href = URL.createObjectURL(blob)
	link.download = "game.dat"
	document.body.appendChild(link)
	link.click()
	document.body.removeChild(link)
	console.log("downloading file")
})
