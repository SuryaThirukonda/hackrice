extends Control

const CONTROLLER_IDS := ["controller_1", "controller_2"]
const REFRESH_INTERVAL_SECONDS := 0.1

const CARD_BASE_COLORS := {
	"controller_1": Color("17345a"),
	"controller_2": Color("3c2356"),
}

const GESTURE_COLORS := {
	"punch": Color("ff6b35"),
	"golf_swing": Color("43d17d"),
	"bowling_swing": Color("b576ff"),
}

@onready var server_status: Label = %ServerStatus
@onready var cards: Dictionary = {
	"controller_1": %Controller1Card,
	"controller_2": %Controller2Card,
}
@onready var connection_labels: Dictionary = {
	"controller_1": %P1Connection,
	"controller_2": %P2Connection,
}
@onready var metrics_labels: Dictionary = {
	"controller_1": %P1Metrics,
	"controller_2": %P2Metrics,
}
@onready var gesture_labels: Dictionary = {
	"controller_1": %P1Gesture,
	"controller_2": %P2Gesture,
}
@onready var direction_labels: Dictionary = {
	"controller_1": %P1Direction,
	"controller_2": %P2Direction,
}
@onready var power_bars: Dictionary = {
	"controller_1": %P1Power,
	"controller_2": %P2Power,
}

var _card_styles: Dictionary = {}
var _flash_tweens: Dictionary = {}
var _power_tweens: Dictionary = {}
var _refresh_elapsed := 0.0


func _ready() -> void:
	_configure_cards()
	ControllerManager.controller_connected.connect(_on_controller_connected)
	ControllerManager.controller_disconnected.connect(_on_controller_disconnected)
	ControllerManager.gesture_received.connect(_on_gesture_received)
	ControllerManager.controller_action.connect(_on_controller_action)
	_refresh_server_status()
	_refresh_all_controllers()


func _process(delta: float) -> void:
	_refresh_elapsed += delta
	if _refresh_elapsed >= REFRESH_INTERVAL_SECONDS:
		_refresh_elapsed = 0.0
		_refresh_server_status()
		_refresh_all_controllers()


func _configure_cards() -> void:
	for controller_id in CONTROLLER_IDS:
		var card: PanelContainer = cards[controller_id]
		var style := StyleBoxFlat.new()
		style.bg_color = CARD_BASE_COLORS[controller_id]
		style.border_color = Color(1.0, 1.0, 1.0, 0.14)
		style.set_border_width_all(2)
		style.set_corner_radius_all(18)
		style.set_content_margin_all(24.0)
		card.add_theme_stylebox_override("panel", style)
		_card_styles[controller_id] = style

	call_deferred("_center_card_pivots")


func _center_card_pivots() -> void:
	for controller_id in CONTROLLER_IDS:
		var card: PanelContainer = cards[controller_id]
		card.pivot_offset = card.size * 0.5


func _refresh_server_status() -> void:
	if ControllerManager.is_listening():
		server_status.text = (
			"WEBSOCKET RECEIVER ONLINE  •  PORT 9080  •  POLLING EVERY FRAME"
		)
		server_status.modulate = Color("72f1a7")
	else:
		server_status.text = (
			"PORT 9080 UNAVAILABLE  •  ERROR %d"
			% ControllerManager.get_listen_error()
		)
		server_status.modulate = Color("ff7474")


func _refresh_all_controllers() -> void:
	for controller_id in CONTROLLER_IDS:
		_refresh_controller(controller_id)


func _refresh_controller(controller_id: String) -> void:
	var state := ControllerManager.get_controller_state(controller_id)
	if state.is_empty():
		return

	var connected := bool(state["connected"])
	var connection_label: Label = connection_labels[controller_id]
	connection_label.text = (
		"● CONNECTED  •  %s" % state["remote_host"]
		if connected
		else "○ DISCONNECTED"
	)
	connection_label.modulate = (
		Color("72f1a7") if connected else Color("ff8b8b")
	)

	var packet_age := "—"
	if int(state["last_packet_time_ms"]) > 0:
		var age_ms := Time.get_ticks_msec() - int(state["last_packet_time_ms"])
		packet_age = "%d ms" % age_ms

	var sensor: Dictionary = state["sensor"]
	var latency: Dictionary = state["latency"]
	var acceleration: Array = sensor["acceleration"]
	var rotation: Array = sensor["rotation"]
	var metrics_label: Label = metrics_labels[controller_id]
	metrics_label.text = (
		"CONNECTIONS  %d    PACKETS  %d    GESTURES  %d\n"
		+ "SEQ  %d        PACKET AGE  %s\n"
		+ "SENSOR  %.1f Hz    INTERVAL  %.1f ms\n"
		+ "ACCEL  [%+.1f, %+.1f, %+.1f]    |a| %.1f\n"
		+ "ROT     [%+.1f, %+.1f, %+.1f]    |r| %.1f\n"
		+ "RTT NOW / MED / P95   %s / %s / %s"
	) % [
		int(state["connection_count"]),
		int(state["packets_received"]),
		int(state["gestures_received"]),
		int(state["last_sequence"]),
		packet_age,
		float(sensor["rate_hz"]),
		float(sensor["interval_ms"]),
		float(acceleration[0]),
		float(acceleration[1]),
		float(acceleration[2]),
		float(sensor["accel_magnitude"]),
		float(rotation[0]),
		float(rotation[1]),
		float(rotation[2]),
		float(sensor["rotation_magnitude"]),
		_format_latency(float(latency["rtt_now_ms"])),
		_format_latency(float(latency["rtt_median_ms"])),
		_format_latency(float(latency["rtt_p95_ms"])),
	]

	var last_gesture: Dictionary = state["last_gesture"]
	if String(last_gesture["name"]) != "none":
		_render_gesture_text(controller_id, last_gesture)
		if (
			not _power_tweens.has(controller_id)
			or not _power_tweens[controller_id].is_valid()
		):
			var power_bar: ProgressBar = power_bars[controller_id]
			power_bar.value = float(last_gesture["power"])


func _format_latency(value: float) -> String:
	if value < 0.0:
		return "—"
	return "%.1f ms" % value


func _on_controller_connected(controller_id: String) -> void:
	_refresh_controller(controller_id)
	_flash_card(controller_id, Color("72f1a7"), 0.35)


func _on_controller_disconnected(controller_id: String) -> void:
	_refresh_controller(controller_id)
	_flash_card(controller_id, Color("ff5f67"), 0.45)


func _on_gesture_received(
	controller_id: String,
	gesture: Dictionary
) -> void:
	_render_gesture_text(controller_id, gesture)
	var gesture_name := String(gesture["name"])
	var power := float(gesture["power"])

	_animate_power(controller_id, power)
	var gesture_color: Color = GESTURE_COLORS.get(
		gesture_name,
		Color.WHITE
	)
	_flash_card(controller_id, gesture_color, power / 100.0)


func _on_controller_action(
	controller_id: String,
	action: String,
	_payload: Dictionary
) -> void:
	var gesture_label: Label = gesture_labels[controller_id]
	gesture_label.text = action.replace("_", " ").to_upper()
	var color := Color("65e5ff")
	if action == "emergency_power":
		color = Color("ff814b")
	elif action == "block_end":
		color = Color("8c9aae")
	_flash_card(controller_id, color, 0.7)


func _render_gesture_text(
	controller_id: String,
	gesture: Dictionary
) -> void:
	var gesture_name := String(gesture["name"])
	var power := float(gesture["power"])
	var direction: Array = gesture["direction"]
	var display_name := gesture_name.replace("_", " ").to_upper()

	var gesture_label: Label = gesture_labels[controller_id]
	gesture_label.text = "%s  •  POWER %d" % [display_name, roundi(power)]

	var direction_label: Label = direction_labels[controller_id]
	direction_label.text = (
		"DIRECTION  %s  •  %s AXIS  •  X %+.2f   Y %+.2f   Z %+.2f"
		% [
			String(gesture.get("direction_label", "unknown")).to_upper(),
			String(gesture.get("dominant_axis", "?")).to_upper(),
			float(direction[0]),
			float(direction[1]),
			float(direction[2]),
		]
	)


func _animate_power(controller_id: String, power: float) -> void:
	if _power_tweens.has(controller_id):
		var old_tween: Tween = _power_tweens[controller_id]
		if old_tween.is_valid():
			old_tween.kill()

	var power_bar: ProgressBar = power_bars[controller_id]
	var tween := create_tween()
	_power_tweens[controller_id] = tween
	tween.set_trans(Tween.TRANS_QUART)
	tween.set_ease(Tween.EASE_OUT)
	tween.tween_property(power_bar, "value", power, 0.16)


func _flash_card(
	controller_id: String,
	flash_color: Color,
	intensity: float
) -> void:
	if _flash_tweens.has(controller_id):
		var old_tween: Tween = _flash_tweens[controller_id]
		if old_tween.is_valid():
			old_tween.kill()

	var card: PanelContainer = cards[controller_id]
	var style: StyleBoxFlat = _card_styles[controller_id]
	var base_color: Color = CARD_BASE_COLORS[controller_id]
	var amount := clampf(0.45 + intensity * 0.45, 0.45, 0.9)
	var bright_color := base_color.lerp(flash_color, amount)
	var pulse_scale := 1.0 + clampf(intensity, 0.0, 1.0) * 0.025

	style.bg_color = base_color
	card.scale = Vector2.ONE
	var tween := create_tween()
	_flash_tweens[controller_id] = tween
	tween.set_trans(Tween.TRANS_QUART)
	tween.set_ease(Tween.EASE_OUT)
	tween.tween_property(style, "bg_color", bright_color, 0.055)
	tween.parallel().tween_property(
		card,
		"scale",
		Vector2(pulse_scale, pulse_scale),
		0.055
	)
	tween.tween_property(style, "bg_color", base_color, 0.30)
	tween.parallel().tween_property(card, "scale", Vector2.ONE, 0.30)
