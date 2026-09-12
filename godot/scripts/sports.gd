extends "res://scripts/main.gd"

var sport := "golf"
var bot_health := 100.0
var human_health := 100.0
var blocking := false
var round_active := false
var round_left := 30.0
var bot_clock := 0.0
var referee: Node3D
var bot: Node3D
var round_label: Label
var round_button: Button
var pins: Array[RigidBody3D] = []
var bowl_busy := false
var round_number := 0
var round_result := ""
var versus_human := false
var second_blocking := false
var turn := "controller_1"
var shot_busy := false
var mode_button: Button
var guard_arms: Array[Node3D] = []
var guard_amount := 0.0
var step_clock := 0.0
var shake_amount := 0.0


func _ready() -> void:
	sport = String(get_tree().get_meta("sport", "golf"))
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--sport=") and not get_tree().has_meta("sport"):
			sport = argument.trim_prefix("--sport=")
	versus_human = bool(get_tree().get_meta("versus_human", false))
	turn = String(get_tree().get_meta("turn", "controller_1"))
	super._ready()
	ControllerManager.set_active_sport(sport)
	ControllerManager.block_changed.connect(_on_block)
	ControllerManager.controller_disconnected.connect(func(id: String): _on_block(id, false))
	_build_sport_menu()
	_message_label.text = "Move with the D-pad, then press A and swing." if sport != "boxing" else "Referee: Ready when you are!"


func _active_controller() -> String:
	return "controller_1" if sport == "boxing" else turn


func _build_course() -> void:
	if sport == "boxing":
		_add_static_box("Arena", Vector3(0,-0.5,0),Vector3(30,1,30),Color("293864"))
		_add_static_box("Ring",Vector3(0,0,0),Vector3(10,0.2,10),Color("87cee6"))
		for x in [-4.7,4.7]:
			for z in [-4.7,4.7]:
				_add_static_box("Corner",Vector3(x,1,z),Vector3(0.3,2,0.3),Color("ff797a"))
		for height in [0.65,1.1,1.55]:
			for side in [-4.7,4.7]:
				_add_static_box("Rope",Vector3(side,height,0),Vector3(0.07,0.07,9.4),Color.WHITE)
				_add_static_box("Rope",Vector3(0,height,side),Vector3(9.4,0.07,0.07),Color.WHITE)
		bot = _figure(Vector3(0,0,-1.4),Color("ee757f"),true)
		referee = _figure(Vector3(2.1,0,-2.0),Color.WHITE,false)
	elif sport == "bowling":
		_add_static_box("Alley",Vector3(0,-0.4,-10),Vector3(28,0.7,48),Color("343665"))
		_add_static_box("Lane",Vector3(0,0,-8),Vector3(4,0.15,32),Color("eac78a"))
		for side in [-2.3,2.3]:
			_add_static_box("Gutter",Vector3(side,-0.1,-8),Vector3(0.5,0.1,32),Color("58718b"))
		_add_static_box("BackWall",Vector3(0,3,-25),Vector3(28,6,0.3),Color("6856a1"))
		for x in [-9,-5,5,9]:
			_add_static_box("Neon",Vector3(x,3,-24.8),Vector3(0.18,4,0.1),Color("63e8ff"))
		for row in range(4):
			for column in range(row+1):
				var pin := RigidBody3D.new()
				pin.position = Vector3((column-row*0.5)*0.6,0.6,-17-row*0.65)
				var mesh := CylinderMesh.new()
				mesh.top_radius=0.10
				mesh.bottom_radius=0.19
				mesh.height=1.0
				var visual := MeshInstance3D.new()
				visual.mesh=mesh
				visual.material_override=_material(Color("fff5f0"))
				pin.add_child(visual)
				var collision := CollisionShape3D.new()
				var shape := CylinderShape3D.new()
				shape.radius=0.19
				shape.height=1.0
				collision.shape=shape
				pin.add_child(collision)
				add_child(pin)
				pins.append(pin)
	else:
		_add_static_box("Garden",Vector3(0,-0.3,-8),Vector3(40,0.5,48),Color("8fcf91"))
		_add_static_box("PuttingGreen",Vector3(0,0,-5),Vector3(7,0.15,27),Color("4fba85"))
		for side in [-3.6,3.6]:
			_add_static_box("Border",Vector3(side,0.3,-5),Vector3(0.2,0.6,27),Color("fff1cc"))
		_add_static_box("End",Vector3(0,0.3,-18.5),Vector3(7.4,0.6,0.2),Color("fff1cc"))
		_add_static_box("Obstacle",Vector3(-1,0.35,-5),Vector3(3,0.7,0.5),Color("ffa58a"))
		_add_static_box("Obstacle",Vector3(1,0.35,-10),Vector3(3,0.7,0.5),Color("a99be9"))
		_add_static_box("FlagPole",Vector3(0,0.8,-16),Vector3(0.08,1.6,0.08),Color.WHITE)
		_add_static_box("Flag",Vector3(0.4,1.5,-16),Vector3(0.8,0.4,0.05),Color("ff8374"))
		var cup := MeshInstance3D.new()
		var disk := CylinderMesh.new()
		disk.top_radius=0.38
		disk.bottom_radius=0.38
		disk.height=0.02
		cup.mesh=disk
		cup.material_override=_material(Color("254f42"))
		cup.position=Vector3(0,0.09,-16)
		add_child(cup)
		for side in [-7,7]:
			for row in range(4):
				_add_tree(Vector3(side,1.5,-row*7))


func _build_camera() -> void:
	super._build_camera()
	if sport == "boxing":
		_camera_rig.position=Vector3(0,1.65,2.4)
		_pitch=0.0
	else:
		_camera_rig.position=Vector3(0,1.65,7)
		_pitch=-0.15
	_camera.rotation.x = _pitch
	if sport == "boxing":
		for side in [-1.0, 1.0]:
			var arm := Node3D.new()
			_camera.add_child(arm)
			_part(arm,Vector3(0,-0.18,0.025),Vector3(1,0.65,0.16),Color("e7ad88"),false)
			_part(arm,Vector3(0,-0.015,0),Vector3(1,0.13,0.2),Color("fff4dc"),false)
			_part(arm,Vector3(0,0.18,0),Vector3(1,0.43,0.25),Color("3b9ee8"),true)
			_part(arm,Vector3(-side*0.15,0.23,0.11),Vector3(0.18,0.17,0.025),Color("a4e4ff"),true)
			guard_arms.append(arm)


func _material(color: Color) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = 1.0
	material.specular_mode = BaseMaterial3D.SPECULAR_DISABLED
	return material


func _build_environment() -> void:
	super._build_environment()
	for child in get_children():
		if child is DirectionalLight3D:
			child.light_energy = 0.55
		if child is WorldEnvironment:
			child.environment.ambient_light_energy = 0.35
			child.environment.tonemap_mode = Environment.TONE_MAPPER_LINEAR
			child.environment.background_color = Color("29334c") if sport != "golf" else Color("a4dce8")


func _part(parent: Node3D, at: Vector3, size: Vector3, color: Color, rounded: bool = true) -> MeshInstance3D:
	var part := MeshInstance3D.new()
	if rounded:
		var sphere := SphereMesh.new()
		sphere.radius = 0.5
		sphere.height = 1.0
		part.mesh = sphere
	else:
		var box := BoxMesh.new()
		box.size = Vector3.ONE
		part.mesh = box
	part.position = at
	part.scale = size
	part.material_override = _material(color)
	parent.add_child(part)
	return part


func _figure(at: Vector3, color: Color, gloves: bool) -> Node3D:
	var figure := Node3D.new()
	figure.position = at
	add_child(figure)
	var skin := Color("e9b88c")
	var hair := Color("302c31")
	var navy := Color("25334a")
	# Oversized expressive head, fitted shirt and a complete standing silhouette.
	_part(figure, Vector3(0,1.72,0), Vector3(0.76,0.84,0.62), skin)
	_part(figure, Vector3(0,2.02,-0.06), Vector3(0.79,0.36,0.64), hair)
	for side in [-1,1]:
		_part(figure, Vector3(side*0.39,1.72,0), Vector3(0.15,0.22,0.15), skin)
		_part(figure, Vector3(side*0.14,1.80,0.293), Vector3(0.075,0.11,0.028), hair)
		_part(figure, Vector3(side*0.14,1.825,0.311), Vector3(0.019,0.025,0.012), Color.WHITE)
		_part(figure, Vector3(side*0.14,1.93,0.265), Vector3(0.14,0.034,0.034), hair)
		_part(figure, Vector3(side*0.20,1.64,0.279), Vector3(0.13,0.06,0.02), Color("d78a7c"))
	_part(figure, Vector3(0,1.69,0.32), Vector3(0.09,0.1,0.065), skin.lightened(0.12))
	_part(figure, Vector3(0,1.55,0.282), Vector3(0.20,0.10,0.036), Color("703e36"))
	_part(figure, Vector3(0,1.578,0.305), Vector3(0.14,0.027,0.012), Color.WHITE, false)
	_part(figure, Vector3(0,1.30,0), Vector3(0.2,0.22,0.2), skin)
	_part(figure, Vector3(0,1.01,0), Vector3(0.64,0.62,0.35), color)
	_part(figure, Vector3(0,0.70,0), Vector3(0.59,0.12,0.37), Color.WHITE, false)
	_part(figure, Vector3(0,0.57,0), Vector3(0.60,0.24,0.36), navy, false)
	for side in [-1,1]:
		_part(figure, Vector3(side*0.17,0.34,0), Vector3(0.19,0.40,0.2), skin if gloves else navy)
		_part(figure, Vector3(side*0.17,0.08,0.08), Vector3(0.25,0.17,0.39), navy)
		_part(figure, Vector3(side*0.17,0.025,0.09), Vector3(0.27,0.055,0.4), Color("f4eee2"),false)
		var arm := _part(figure,Vector3(side*0.40,1.02,0.03),Vector3(0.2,0.46,0.22),skin if gloves else color)
		arm.rotation.z=side*0.55
		if gloves:
			_part(figure,Vector3(side*0.48,1.22,0.33),Vector3(0.24,0.37,0.24),skin)
			_part(figure,Vector3(side*0.47,1.42,0.45),Vector3(0.36,0.36,0.34),color)
			_part(figure,Vector3(side*0.47,1.26,0.40),Vector3(0.27,0.10,0.27),Color.WHITE,false)
		else:
			_part(figure,Vector3(side*0.56,0.88,0.04),Vector3(0.21,0.24,0.22),skin)
	if not gloves:
		for x in [-0.2,0,0.2]:
			_part(figure,Vector3(x,1.03,0.175),Vector3(0.055,0.4,0.025),navy,false)
		_part(figure,Vector3(0,1.21,0.19),Vector3(0.11,0.065,0.045),navy,false)
	var nameplate := Label3D.new()
	nameplate.text = ("CONTROLLER 2" if versus_human else "CLUB BOT") if gloves else "REFEREE"
	nameplate.position=Vector3(0,2.42,0)
	nameplate.font_size=32
	nameplate.pixel_size=0.003
	figure.add_child(nameplate)
	return figure


func _build_sport_menu() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	var menu := HBoxContainer.new()
	menu.position=Vector2(24,78)
	layer.add_child(menu)
	for entry in [["golf","Mini golf [G]"],["boxing","Boxing [B]"],["bowling","Bowling [N]"]]:
		var button := Button.new()
		button.text=entry[1]
		button.custom_minimum_size=Vector2(160,44)
		button.pressed.connect(_switch_sport.bind(entry[0]))
		menu.add_child(button)
	var diagnostic := Button.new()
	diagnostic.text="Controller test [F3]"
	diagnostic.pressed.connect(func(): get_tree().change_scene_to_file("res://scenes/diagnostics.tscn"))
	menu.add_child(diagnostic)
	var join := Button.new()
	join.text="Join QR"
	join.pressed.connect(func(): OS.shell_open("http://localhost:5173/"))
	menu.add_child(join)
	mode_button = Button.new()
	mode_button.text = "Human vs Human" if versus_human else "Human vs AI"
	mode_button.pressed.connect(func():
		get_tree().set_meta("versus_human", not versus_human)
		get_tree().set_meta("turn", "controller_1")
		get_tree().reload_current_scene()
	)
	menu.add_child(mode_button)
	round_label=Label.new()
	round_label.position=Vector2(24,138)
	round_label.add_theme_font_size_override("font_size",22)
	layer.add_child(round_label)
	round_button=Button.new()
	round_button.position=Vector2(24,178)
	round_button.text="Start round / Reset course [R]"
	round_button.pressed.connect(_reset_round)
	layer.add_child(round_button)


func _unhandled_key_input(event: InputEvent) -> void:
	if not event is InputEventKey or not event.pressed or event.echo: return
	match event.keycode:
		KEY_B: _switch_sport("boxing")
		KEY_G: _switch_sport("golf")
		KEY_N: _switch_sport("bowling")
		KEY_R: _reset_round()
		KEY_F3: get_tree().change_scene_to_file("res://scenes/diagnostics.tscn")
		KEY_SPACE:
			if sport=="golf": _on_golf_swing("controller_1",65,Vector3.ZERO)
			elif sport=="boxing": _on_punch("controller_1",65,Vector3.ZERO)
			else: _on_bowling_swing("controller_1",65,Vector3.ZERO)


func _switch_sport(next: String) -> void:
	get_tree().set_meta("sport",next)
	get_tree().reload_current_scene()


func _reset_round() -> void:
	for crown in get_tree().get_nodes_in_group("winner_crown"):
		crown.queue_free()
	if sport!="boxing":
		get_tree().reload_current_scene()
		return
	bot_health=100
	human_health=100
	round_left=30
	bot_clock=0
	round_active=true
	round_number+=1
	round_result=""
	referee.scale=Vector3.ONE
	_referee_says("Start!")


func _referee_says(line: String) -> void:
	_message_label.text="Referee: "+line
	var voices := DisplayServer.tts_get_voices()
	if not voices.is_empty():
		DisplayServer.tts_speak(line,voices[0]["id"],80,1.0,1.0,0,true)


func _process(delta: float) -> void:
	var movement := _effective_stick(_active_controller())
	var keys := Vector2(Input.get_axis("ui_left","ui_right"),Input.get_axis("ui_up","ui_down"))
	if keys.length_squared() > 0: movement = keys.normalized()
	var previous_position := _camera_rig.position
	_camera_rig.position += Vector3(movement.x,0,movement.y)*delta*2.5
	_camera_rig.position.x = clampf(_camera_rig.position.x,-2.6,2.6)
	_camera_rig.position.z = clampf(_camera_rig.position.z,0.5,3.5) if sport=="boxing" else clampf(_camera_rig.position.z,2.5,7)
	_update_camera_feedback(delta, _camera_rig.position.distance_to(previous_position) > 0.0001)
	if sport=="boxing" and versus_human and round_active:
		var second := _effective_stick("controller_2")
		bot.position += Vector3(-second.x,0,-second.y)*delta*2.5
		bot.position.x=clampf(bot.position.x,-2.6,2.6)
		bot.position.z=clampf(bot.position.z,-3,0)
	_refresh_status()
	if round_label==null: return
	if sport=="boxing":
		round_label.text=round_result if not round_result.is_empty() else "YOU %d   •   CLUB BOT %d   •   %ds" % [human_health,bot_health,ceili(round_left)]
		if round_active:
			round_left=maxf(0,round_left-delta)
			bot_clock+=delta
			if bot_clock>=3 and not versus_human:
				bot_clock=0
				human_health-=2 if blocking else 8
				shake_amount=0.018 if blocking else 0.055
				var tween := create_tween()
				tween.tween_property(bot,"position:z",-0.8,0.15)
				tween.tween_property(bot,"position:z",-1.4,0.25)
			if round_left<=0 or bot_health<=0 or human_health<=0:
				round_active=false
				var winner := "Controller 1 wins!" if human_health>bot_health else ("Controller 2 wins!" if versus_human else "Club Bot wins!") if bot_health>human_health else "It's a draw!"
				_referee_says("Stop! "+winner)
				round_label.text=winner
				round_result=winner
				var crown := Label3D.new()
				crown.text="WINNER"
				crown.position=Vector3(0,2.7,-1.4) if bot_health>human_health else Vector3(0,2.2,0.5)
				crown.modulate=Color("ffe166")
				crown.font_size=70
				add_child(crown)
				crown.add_to_group("winner_crown")
	else:
		round_label.text=("%s turn • D-pad moves • Human vs Human" % turn.replace("_"," ").capitalize()) if versus_human else "Controller 1 • Club Bot placeholder • D-pad moves"
	if sport=="boxing" and versus_human:
		round_label.text=round_label.text.replace("CLUB BOT","CONTROLLER 2")


func _on_block(controller_id: String, active: bool) -> void:
	if controller_id=="controller_1": blocking=active
	if controller_id=="controller_2": second_blocking=active
	if controller_id=="controller_1" and active: shake_amount=0.025


func _update_camera_feedback(delta: float, moving: bool) -> void:
	step_clock += delta * 11.0
	var bob := Vector3(sin(step_clock)*0.012,abs(sin(step_clock))*0.025,0) if moving else Vector3.ZERO
	shake_amount = move_toward(shake_amount,0.0,delta*0.15)
	var impact := Vector3(sin(step_clock*3.1),cos(step_clock*3.7),0)*shake_amount
	_camera.position = _camera.position.lerp(bob+impact,minf(1,delta*14))
	# Translation-only feedback: keep forward aim and pitch fixed.
	_camera.rotation = Vector3(_pitch,0,0)
	guard_amount = move_toward(guard_amount,1.0 if blocking else 0.0,delta*8)
	var half_height := tan(deg_to_rad(_camera.fov)*0.5)*0.65
	var half_width := half_height*get_viewport().get_visible_rect().size.aspect()
	for index in range(guard_arms.size()):
		var arm := guard_arms[index]
		var side := -1.0 if index==0 else 1.0
		arm.visible = guard_amount>0.001
		arm.position = Vector3(side*half_width*0.70,-(1.0-guard_amount)*1.1,-0.65)
		arm.scale = Vector3(half_width*0.65,half_height*2.0,1)


func _on_punch(controller_id: String, power: float, _direction: Vector3) -> void:
	if sport!="boxing" or (controller_id=="controller_2" and not versus_human): return
	_power_label.text="POWER %d" % roundi(power)
	if not round_active:
		_message_label.text="Referee: Press Start round when you're ready."
		return
	if controller_id=="controller_2":
		human_health=maxf(0,human_health-power*(0.05 if blocking else 0.25))
		shake_amount=0.018 if blocking else 0.055
	else:
		bot_health=maxf(0,bot_health-power*(0.05 if second_blocking and versus_human else 0.25))
	var tween := create_tween()
	tween.tween_property(bot,"rotation:z",0.15,0.08)
	tween.tween_property(bot,"rotation:z",0.0,0.2)


func _on_golf_swing(controller_id: String, power: float, _direction: Vector3) -> void:
	if controller_id!=turn or sport!="golf" or shot_busy: return
	shot_busy=true
	_roll_ball(power,false)
	_power_label.text="POWER %d" % roundi(power)
	_shot_count+=1
	_request_commentary({"event":"golf_shot","player":controller_id,"power":power,"shot":_shot_count})


func _on_bowling_swing(controller_id: String, power: float, _direction: Vector3) -> void:
	if controller_id!=turn or sport!="bowling" or bowl_busy: return
	shot_busy=true
	bowl_busy=true
	_roll_ball(power,true)
	_power_label.text="POWER %d" % roundi(power)
	await get_tree().create_timer(6).timeout
	var down := 0
	for pin in pins:
		if pin.global_transform.basis.y.dot(Vector3.UP)<0.8 or pin.position.y<0.3: down+=1
	_message_label.text="%d pins! Reset the lane to play again." % down
	_advance_turn()


func _roll_ball(power: float, bowling: bool) -> void:
	var ball := RigidBody3D.new()
	var radius := 0.3 if bowling else 0.15
	ball.mass=3 if bowling else 0.3
	ball.continuous_cd=true
	ball.position=Vector3(_camera_rig.position.x,radius+0.1,_camera_rig.position.z-0.7)
	var visual := MeshInstance3D.new()
	var mesh := SphereMesh.new()
	mesh.radius=radius
	mesh.height=radius*2
	visual.mesh=mesh
	visual.material_override=_material(Color("9179dc") if bowling else Color.WHITE)
	ball.add_child(visual)
	var collision := CollisionShape3D.new()
	var shape := SphereShape3D.new()
	shape.radius=radius
	collision.shape=shape
	ball.add_child(collision)
	add_child(ball)
	var direction := -_camera_rig.global_transform.basis.z
	direction.y=0
	ball.linear_velocity=direction.normalized()*lerpf(3,18,power/100.0)
	await get_tree().create_timer(6).timeout
	if not bowling:
		var distance := Vector2(ball.position.x,ball.position.z+16).length()
		_message_label.text="In the cup!" if distance<0.45 else "%.1fm from the cup. Reset to try again." % distance
		_advance_turn()
	get_tree().create_timer(6).timeout.connect(ball.queue_free)


func _advance_turn() -> void:
	if versus_human:
		get_tree().set_meta("turn","controller_2" if turn=="controller_1" else "controller_1")
		_message_label.text += " Next controller: press Reset course."
