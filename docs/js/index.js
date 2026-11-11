const show_warning = (message) => {
	const warning = document.querySelector("#warning")
	warning.querySelector("#warning_text").innerText = message
	warning.style.display = "block"
}

document.querySelectorAll(".form_inventory_active_item").forEach(slot => {
	// remember each empty slot's placeholder icon (the game's placeholders are black, so lighten them up)
	slot.dataset.empty_style = slot.querySelector(".form_inventory_generic_icon").getAttribute("style") + " filter: invert(1); opacity: 0.35;"
})
document.querySelector("#supported_version").innerText = `v${SUPPORTED_GAME_VERSION_NAME}`

clearForm()

var audio = new Audio("assets/theme.mp3")
audio.volume = 0.5
document.querySelector("#musicflip").addEventListener("click", () => {
	if (audio.paused) {
		audio.play()
	} else {
		audio.pause()
		audio.currentTime = 0
	}
})
