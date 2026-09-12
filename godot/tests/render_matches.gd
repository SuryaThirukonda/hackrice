extends Node
## Captures the game's own viewport for visual regression review (not the desktop).
func _ready() -> void:
	for sport in ["golf","bowling","boxing"]:
		get_tree().set_meta("sport",sport)
		var game = load("res://scenes/main.tscn").instantiate()
		add_child(game)
		if sport=="boxing": game._on_block("controller_1",true)
		for frame in range(20): await get_tree().process_frame
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png("/tmp/hackrice-%s-match.png"%sport)
		game.queue_free()
		await get_tree().process_frame
	get_tree().quit()
