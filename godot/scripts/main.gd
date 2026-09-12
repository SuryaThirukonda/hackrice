extends Node3D

const CONTROLLER_IDS := ["controller_1", "controller_2"]
const PLAYER_COLORS := {
	"controller_1": Color("4edfff"),
	"controller_2": Color("ff5da8"),
}
const LOOK_SPEED := 1.65
const MAX_PITCH := deg_to_rad(62.0)
const DEFAULT_COMMENTARY_URL := "http://127.0.0.1:8000"

var _camera_rig: Node3D
var _camera: Camera3D
var _status_label: Label
var _power_label: Label
var _message_label: Label
var _stick_by_controller := {
	"controller_1": Vector2.ZERO,
	"controller_2": Vector2.ZERO,
}
var _last_controller := "controller_1"
var _pitch := -0.08
var _shot_count := 0
var _commentary_base_url := DEFAULT_COMMENTARY_URL
var _commentary_busy := false
var _pending_commentary: Dictionary = {}
var _audio_player: AudioStreamPlayer


func _ready() -> void:
	var configured_url := OS.get_environment("HAP_COMMENTARY_URL")
	if not configured_url.is_empty():
		_commentary_base_url = configured_url.trim_suffix("/")
	_build_environment()
	_build_course()
	_build_camera()
	_build_hud()
	ControllerManager.controller_connected.connect(_on_controller_changed)
	ControllerManager.controller_disconnected.connect(_on_controller_disconnected)
	ControllerManager.stick_received.connect(_on_stick_received)
	ControllerManager.golf_swing.connect(_on_golf_swing)
	ControllerManager.punch.connect(_on_punch)
	ControllerManager.bowling_swing.connect(_on_bowling_swing)
	_refresh_status()


func _process(delta: float) -> void:
	var stick := _effective_stick(_active_controller())
	var keyboard := Vector2(
		Input.get_axis("ui_left", "ui_right"),
		Input.get_axis("ui_up", "ui_down")
	)
	if keyboard.length_squared() > 0.0:
		stick = keyboard.normalized()
	_camera_rig.rotate_y(-stick.x * LOOK_SPEED * delta)
	_pitch = clampf(_pitch - stick.y * LOOK_SPEED * 0.72 * delta, -MAX_PITCH, MAX_PITCH)
	_camera.rotation.x = _pitch
	_refresh_status()


func _build_environment() -> void:
	var world := WorldEnvironment.new()
	var environment := Environment.new()
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = Color("80c9ee")
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color("d8ecff")
	environment.ambient_light_energy = 0.75
	environment.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	world.environment = environment
	add_child(world)

	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-52, -28, 0)
	sun.light_energy = 1.15
	sun.shadow_enabled = true
	add_child(sun)


func _build_course() -> void:
	_add_static_box("Fairway", Vector3(0, -0.35, -18), Vector3(28, 0.7, 58), Color("2c8c4f"))
	_add_static_box("Tee", Vector3(0, 0.03, 7), Vector3(7, 0.12, 5), Color("4abf69"))
	_add_static_box("LeftRough", Vector3(-19, -0.2, -18), Vector3(10, 0.4, 58), Color("246c3d"))
	_add_static_box("RightRough", Vector3(19, -0.2, -18), Vector3(10, 0.4, 58), Color("246c3d"))
	_add_static_box("Backstop", Vector3(0, 2.5, -47), Vector3(38, 5, 0.5), Color("183e35"))

	for lane in range(-2, 3):
		var x := float(lane) * 4.5
		_add_target(Vector3(x, 1.4, -28.0 - abs(lane) * 3.0), 1.2, lane)
	for side in [-1, 1]:
		for row in range(5):
			_add_tree(Vector3(float(side) * (10.0 + row * 1.5), 1.5, -5.0 - row * 9.0))


func _build_camera() -> void:
	_camera_rig = Node3D.new()
	_camera_rig.name = "CameraRig"
	_camera_rig.position = Vector3(0, 1.7, 8)
	add_child(_camera_rig)
	_camera = Camera3D.new()
	_camera.name = "PlayerCamera"
	_camera.current = true
	_camera.fov = 74
	_camera.rotation.x = _pitch
	_camera_rig.add_child(_camera)


func _build_hud() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	_audio_player = AudioStreamPlayer.new()
	add_child(_audio_player)
	var top_panel := ColorRect.new()
	top_panel.set_anchors_and_offsets_preset(Control.PRESET_TOP_WIDE)
	top_panel.custom_minimum_size.y = 74
	top_panel.color = Color(0.02, 0.04, 0.07, 0.78)
	layer.add_child(top_panel)

	_status_label = Label.new()
	_status_label.position = Vector2(24, 14)
	_status_label.add_theme_font_size_override("font_size", 17)
	_status_label.add_theme_color_override("font_color", Color("c9eaff"))
	top_panel.add_child(_status_label)
	_power_label = Label.new()
	_power_label.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	_power_label.position = Vector2(-260, 12)
	_power_label.size = Vector2(235, 30)
	_power_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_power_label.text = "READY TO SWING"
	_power_label.add_theme_font_size_override("font_size", 20)
	_power_label.add_theme_color_override("font_color", Color("ffe36e"))
	top_panel.add_child(_power_label)

	_message_label = Label.new()
	_message_label.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	_message_label.offset_top = -70
	_message_label.offset_bottom = -30
	_message_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_message_label.text = "Tilt phone to aim • swing to launch • arrow keys test aim"
	_message_label.add_theme_font_size_override("font_size", 18)
	_message_label.add_theme_color_override("font_color", Color.WHITE)
	layer.add_child(_message_label)

	var crosshair := Label.new()
	crosshair.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	crosshair.position = Vector2(-12, -18)
	crosshair.text = "+"
	crosshair.add_theme_font_size_override("font_size", 32)
	crosshair.add_theme_color_override("font_color", Color.WHITE)
	layer.add_child(crosshair)


func _add_static_box(node_name: String, position: Vector3, size: Vector3, color: Color) -> void:
	var body := StaticBody3D.new()
	body.name = node_name
	body.position = position
	var mesh_instance := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = size
	mesh.material = _material(color)
	mesh_instance.mesh = mesh
	body.add_child(mesh_instance)
	var collision := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = size
	collision.shape = shape
	body.add_child(collision)
	add_child(body)


func _add_target(position: Vector3, radius: float, index: int) -> void:
	var target := MeshInstance3D.new()
	target.position = position
	var mesh := CylinderMesh.new()
	mesh.top_radius = radius
	mesh.bottom_radius = radius
	mesh.height = 0.18
	mesh.radial_segments = 48
	mesh.material = _material(Color("ff6b55") if index % 2 == 0 else Color("ffe270"))
	target.mesh = mesh
	target.rotation.x = PI / 2.0
	add_child(target)
	var pole_size := Vector3(0.12, position.y * 2.0, 0.12)
	_add_static_box("TargetPole", Vector3(position.x, position.y * 0.5, position.z + 0.15), pole_size, Color("edf4f7"))


func _add_tree(position: Vector3) -> void:
	var trunk := MeshInstance3D.new()
	trunk.position = position - Vector3(0, 1.0, 0)
	var trunk_mesh := CylinderMesh.new()
	trunk_mesh.top_radius = 0.22
	trunk_mesh.bottom_radius = 0.32
	trunk_mesh.height = 2.3
	trunk_mesh.material = _material(Color("6f4b2c"))
	trunk.mesh = trunk_mesh
	add_child(trunk)
	var crown := MeshInstance3D.new()
	crown.position = position + Vector3(0, 0.8, 0)
	var crown_mesh := SphereMesh.new()
	crown_mesh.radius = 1.35
	crown_mesh.height = 2.7
	crown_mesh.material = _material(Color("205f3b"))
	crown.mesh = crown_mesh
	add_child(crown)


func _material(color: Color) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = 0.82
	return material


func _active_controller() -> String:
	var state := ControllerManager.get_controller_state(_last_controller)
	if not state.is_empty() and bool(state.get("connected", false)):
		return _last_controller
	for controller_id in CONTROLLER_IDS:
		state = ControllerManager.get_controller_state(controller_id)
		if not state.is_empty() and bool(state.get("connected", false)):
			return controller_id
	return "controller_1"


func _effective_stick(controller_id: String) -> Vector2:
	var state := ControllerManager.get_controller_state(controller_id)
	if state.is_empty() or not bool(state.get("connected", false)):
		return Vector2.ZERO
	var stick_state: Dictionary = state.get("stick", {})
	var received_at := int(stick_state.get("last_receive_time_ms", 0))
	if received_at <= 0 or Time.get_ticks_msec() - received_at > 250:
		return Vector2.ZERO
	var vector: Array = stick_state.get("vector", [0.0, 0.0])
	return Vector2(float(vector[0]), float(vector[1]))


func _on_stick_received(controller_id: String, stick: Vector2) -> void:
	_stick_by_controller[controller_id] = stick
	if stick.length_squared() > 0.015:
		_last_controller = controller_id


func _on_golf_swing(controller_id: String, power: float, _direction: Vector3) -> void:
	_last_controller = controller_id
	_launch_ball(controller_id, power)
	_power_label.text = "POWER %d" % roundi(power)
	_message_label.text = "%s launched shot %d" % [_player_name(controller_id), _shot_count]
	_request_commentary({
		"event": "golf_shot",
		"player": controller_id,
		"power": power,
		"shot": _shot_count,
	})


func _on_punch(controller_id: String, power: float, _direction: Vector3) -> void:
	_message_label.text = "%s punch received • switch phone to Golf to launch" % _player_name(controller_id)
	_power_label.text = "PUNCH %d" % roundi(power)


func _on_bowling_swing(controller_id: String, power: float, _direction: Vector3) -> void:
	_message_label.text = "%s bowl received • switch phone to Golf to launch" % _player_name(controller_id)
	_power_label.text = "BOWL %d" % roundi(power)


func _launch_ball(controller_id: String, power: float) -> void:
	_shot_count += 1
	var ball := RigidBody3D.new()
	ball.name = "GolfBall_%d" % _shot_count
	ball.mass = 0.12
	ball.continuous_cd = true
	var forward := -_camera.global_transform.basis.z.normalized()
	ball.position = _camera.global_position + forward * 1.0 - _camera.global_transform.basis.y * 0.18
	var mesh_instance := MeshInstance3D.new()
	var mesh := SphereMesh.new()
	mesh.radius = 0.16
	mesh.height = 0.32
	mesh.material = _material(PLAYER_COLORS[controller_id])
	mesh_instance.mesh = mesh
	ball.add_child(mesh_instance)
	var collision := CollisionShape3D.new()
	var shape := SphereShape3D.new()
	shape.radius = 0.16
	collision.shape = shape
	ball.add_child(collision)
	add_child(ball)
	var speed := lerpf(9.0, 29.0, clampf(power / 100.0, 0.0, 1.0))
	ball.apply_central_impulse((forward + Vector3.UP * 0.075).normalized() * speed * ball.mass)
	get_tree().create_timer(12.0).timeout.connect(ball.queue_free)


func _request_commentary(event: Dictionary) -> void:
	if _commentary_busy:
		_pending_commentary = event
		return
	_commentary_busy = true
	var request := HTTPRequest.new()
	add_child(request)
	request.request_completed.connect(_on_commentary_ready.bind(request))
	var error := request.request(
		_commentary_base_url + "/api/commentary",
		["Content-Type: application/json"],
		HTTPClient.METHOD_POST,
		JSON.stringify(event)
	)
	if error != OK:
		request.queue_free()
		_finish_commentary_request()


func _on_commentary_ready(
	_result: int,
	response_code: int,
	_headers: PackedStringArray,
	body: PackedByteArray,
	request: HTTPRequest
) -> void:
	request.queue_free()
	if response_code >= 200 and response_code < 300:
		var parsed: Variant = JSON.parse_string(body.get_string_from_utf8())
		if typeof(parsed) == TYPE_DICTIONARY:
			var payload: Dictionary = parsed
			var text := String(payload.get("text", ""))
			if not text.is_empty():
				_message_label.text = text
			var audio_path := String(payload.get("url", ""))
			if not audio_path.is_empty():
				_download_commentary_audio(audio_path)
	_finish_commentary_request()


func _download_commentary_audio(audio_path: String) -> void:
	var request := HTTPRequest.new()
	add_child(request)
	request.request_completed.connect(_on_commentary_audio_ready.bind(request))
	var error := request.request(_commentary_base_url + audio_path)
	if error != OK:
		request.queue_free()


func _on_commentary_audio_ready(
	_result: int,
	response_code: int,
	_headers: PackedStringArray,
	body: PackedByteArray,
	request: HTTPRequest
) -> void:
	request.queue_free()
	if response_code < 200 or response_code >= 300 or body.is_empty():
		return
	var stream := AudioStreamMP3.new()
	stream.data = body
	_audio_player.stream = stream
	_audio_player.play()


func _finish_commentary_request() -> void:
	_commentary_busy = false
	if _pending_commentary.is_empty():
		return
	var next := _pending_commentary
	_pending_commentary = {}
	_request_commentary(next)


func _on_controller_changed(_controller_id: String) -> void:
	_refresh_status()


func _on_controller_disconnected(controller_id: String) -> void:
	_stick_by_controller[controller_id] = Vector2.ZERO
	_refresh_status()


func _refresh_status() -> void:
	var connected: Array[String] = []
	for controller_id in CONTROLLER_IDS:
		var state := ControllerManager.get_controller_state(controller_id)
		if not state.is_empty() and bool(state.get("connected", false)):
			connected.append(_player_name(controller_id))
	_status_label.text = (
		"PHONE AIM ONLINE • %s" % ", ".join(connected)
		if not connected.is_empty()
		else "WAITING FOR PHONE • WS PORT %d • ARROW KEYS ENABLED" % ControllerManager.get_port()
	)


func _player_name(controller_id: String) -> String:
	return "PLAYER 2" if controller_id == "controller_2" else "PLAYER 1"
