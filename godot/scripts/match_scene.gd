extends "res://scripts/sports.gd"

const GolfRules = preload("res://scripts/golf_match.gd")
const BowlingRules = preload("res://scripts/bowling_match.gd")
const BoxingRules = preload("res://scripts/boxing_match.gd")
var golf = GolfRules.new()
var bowling = BowlingRules.new()
var boxing = BoxingRules.new()
var aim := 0.0
var spin := 0.0
var club := 0
var aim_mode := false
var aim_locked := false
var sweep_time := 0.0
var control_delay := 0.0
var bot_delay := 2.0
var result_delay := 0.0
var shown_hole := 0
var ground_art: Node3D
var ball_art: MeshInstance3D
var pin_art: Node3D
var arrow: Node3D
var details: Label
var health_bars: Array[ProgressBar] = []
var stamina_bars: Array[ProgressBar] = []
var course_title: Label
var pause_button: Button
var paused := false
var previous_phase := "ready"
var overview: Camera3D

func _ready() -> void:
	super._ready()
	turn="controller_1"
	ControllerManager.controller_action.connect(_on_game_action)
	_build_match_hud()
	if sport!="boxing":
		overview=Camera3D.new()
		overview.projection=Camera3D.PROJECTION_ORTHOGONAL
		overview.size=30
		overview.position=Vector3(0,25,-6)
		overview.rotation.x=-PI/2
		add_child(overview)
		ball_art=_part(self,Vector3.ZERO,Vector3.ONE*(0.6 if sport=="bowling" else 0.25),Color("9674e8") if sport=="bowling" else Color.WHITE)
		arrow=Node3D.new()
		add_child(arrow)
		_part(arrow,Vector3(0,0,-1.4),Vector3(0.09,0.04,2.8),Color("ffe271"),false)
		for side in [-1,1]:
			var tip := _part(arrow,Vector3(side*0.22,0,-2.6),Vector3(0.08,0.04,0.65),Color("ffe271"),false)
			tip.rotation.y=side*0.8
		if sport=="bowling": _render_pins()
	_message_label.text="Calibrate, then throw your first punch toward the opponent." if sport=="boxing" else "A: lock aim / start swing · B: aim mode · D-pad: move or adjust aim"
	_update_match_hud()

func _build_course() -> void:
	if sport!="golf":
		super._build_course()
		if sport=="bowling":
			for pin in pins: pin.queue_free()
			pins.clear()
		return
	_add_static_box("Garden",Vector3(0,-0.3,-8),Vector3(40,0.5,48),Color("8fcf91"))
	_add_static_box("Fairway",Vector3(0,0,-6),Vector3(6.7,0.15,26),Color("4fba85"))
	for side in [-7,7]:
		for row in range(4): _add_tree(Vector3(side,1.5,-row*7))
	_render_hole()

func _render_hole() -> void:
	if is_instance_valid(ground_art): ground_art.queue_free()
	ground_art=Node3D.new()
	add_child(ground_art)
	var hole: Dictionary = GolfRules.HOLES[mini(golf.hole,2)]
	for kind in ["water","sand"]:
		var area: Rect2 = hole[kind]
		_part(ground_art,Vector3(area.get_center().x,0.095,area.get_center().y),Vector3(area.size.x,0.025,area.size.y),Color("51bddd") if kind=="water" else Color("efd696"),false)
	var cup: Vector2 = hole.cup
	_part(ground_art,Vector3(cup.x,0.11,cup.y),Vector3(0.76,0.02,0.76),Color("214f3e"))
	_part(ground_art,Vector3(cup.x,0.9,cup.y),Vector3(0.04,1.7,0.04),Color.WHITE,false)
	_part(ground_art,Vector3(cup.x+0.3,1.6,cup.y),Vector3(0.6,0.32,0.025),Color("ff8374"),false)
	shown_hole=golf.hole

func _render_pins() -> void:
	if is_instance_valid(pin_art): pin_art.queue_free()
	pin_art=Node3D.new()
	add_child(pin_art)
	for pin in bowling.pins:
		var body := Node3D.new()
		pin_art.add_child(body)
		_part(body,Vector3(0,0.35,0),Vector3(0.37,0.65,0.37),Color("fffaf0"))
		_part(body,Vector3(0,0.72,0),Vector3(0.2,0.3,0.2),Color("fffaf0"))
		_part(body,Vector3(0,0.68,0),Vector3(0.21,0.1,0.21),Color("ed697c"))
		body.position=Vector3(pin.pos.x,0.1,pin.pos.y)

func _build_match_hud() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	course_title=Label.new()
	course_title.position=Vector2(24,218)
	course_title.add_theme_font_size_override("font_size",20)
	layer.add_child(course_title)
	details=Label.new()
	details.position=Vector2(24,250)
	details.add_theme_font_size_override("font_size",16)
	layer.add_child(details)
	var controls := HBoxContainer.new()
	controls.position=Vector2(24,178)
	# Existing reset button remains at the left.
	controls.position.x=360
	layer.add_child(controls)
	pause_button=Button.new()
	pause_button.text="Pause [Esc]"
	pause_button.pressed.connect(_toggle_pause)
	controls.add_child(pause_button)
	if sport=="boxing":
		round_button.text="Start / New match [R]"
		for p in [0,1]:
			var row := VBoxContainer.new()
			row.position=Vector2(24+p*902,288)
			row.custom_minimum_size=Vector2(330,0)
			layer.add_child(row)
			var label := Label.new()
			label.text="Controller 1" if p==0 else "Controller 2" if versus_human else "Club Bot"
			row.add_child(label)
			for kind in ["Health","Stamina"]:
				var caption := Label.new()
				caption.text=kind
				row.add_child(caption)
				var bar := ProgressBar.new()
				bar.custom_minimum_size=Vector2(330,16)
				bar.show_percentage=false
				var fill := StyleBoxFlat.new()
				fill.bg_color=Color("ef708a") if kind=="Health" else Color("52cdb0")
				fill.set_corner_radius_all(7)
				bar.add_theme_stylebox_override("fill",fill)
				row.add_child(bar)
				if kind=="Health": health_bars.append(bar)
				else: stamina_bars.append(bar)
	else:
		round_button.text="New match [R]"
		for entry in [["Aim ←",-1],["Aim →",1]]:
			var button := Button.new()
			button.text=entry[0]
			button.pressed.connect(func(): aim+=float(entry[1])*0.08; aim_locked=true)
			controls.add_child(button)
		var option := Button.new()
		option.text="Club [C]" if sport=="golf" else "Hook [C]"
		option.pressed.connect(_cycle_option)
		controls.add_child(option)
		var map_button := Button.new()
		map_button.text="Top view [Tab]"
		map_button.pressed.connect(_toggle_overview)
		controls.add_child(map_button)

func _toggle_overview() -> void:
	if is_instance_valid(overview):
		if overview.current: _camera.make_current()
		else: overview.make_current()

func _toggle_pause() -> void:
	paused=not paused
	pause_button.text="Resume [Esc]" if paused else "Pause [Esc]"

func _cycle_option() -> void:
	if sport=="golf": club=(club+1)%3
	else: spin=0.0 if spin>0.5 else spin+0.5

func _reset_round() -> void:
	if sport=="boxing":
		boxing=BoxingRules.new()
		boxing.start()
		blocking=false
		second_blocking=false
		bot.position=Vector3(0,0,-1.4)
		_camera_rig.position=Vector3(0,1.65,2.4)
		paused=false
		_referee_says("Start!")
	else: get_tree().reload_current_scene()

func _unhandled_key_input(event: InputEvent) -> void:
	if not event is InputEventKey or not event.pressed or event.echo: return
	match event.keycode:
		KEY_TAB: _toggle_overview()
		KEY_ESCAPE: _toggle_pause()
		KEY_C: _cycle_option()
		KEY_Q: aim-=0.08; aim_locked=true
		KEY_E: aim+=0.08; aim_locked=true
		KEY_Z: spin=maxf(-1,spin-0.2)
		KEY_X: spin=minf(1,spin+0.2)
		KEY_SPACE:
			if sport=="boxing": _on_punch("controller_1",65,Vector3.ZERO)
			elif sport=="golf": _on_golf_swing(turn,65,Vector3.ZERO)
			else: _on_bowling_swing(turn,65,Vector3.ZERO)
		_: super._unhandled_key_input(event)

func _on_game_action(id: String, action: String, _payload: Dictionary) -> void:
	if id!=turn or sport=="boxing" or paused: return
	if action=="placeholder_secondary": aim_mode=not aim_mode; aim_locked=aim_mode
	if action=="placeholder_primary": aim_locked=true

func _process(delta: float) -> void:
	_refresh_status()
	if paused: return
	turn="controller_1" if sport=="boxing" else "controller_%d" % ((golf.player if sport=="golf" else bowling.player)+1)
	var movement := _effective_stick(turn)
	var keys := Vector2(Input.get_axis("ui_left","ui_right"),Input.get_axis("ui_up","ui_down"))
	if keys.length_squared()>0: movement=keys.normalized()
	control_delay=maxf(0,control_delay-delta)
	var before := _camera_rig.position
	if aim_mode and sport!="boxing":
		aim=clampf(aim+movement.x*delta*0.7,-PI,PI)
		if absf(movement.y)>0.5 and control_delay==0:
			if sport=="golf": club=posmod(club+(-1 if movement.y<0 else 1),3)
			else: spin=clampf(spin-movement.y*0.2,-1,1)
			control_delay=0.3
	else:
		_camera_rig.position+=Vector3(movement.x,0,movement.y)*delta*2.5
		_camera_rig.position.x=clampf(_camera_rig.position.x,-3,3)
		_camera_rig.position.z=clampf(_camera_rig.position.z,-0.3,3.5) if sport=="boxing" else clampf(_camera_rig.position.z,-17,7)
	if sport=="boxing":
		if versus_human:
			var second := _effective_stick("controller_2")
			bot.position+=Vector3(-second.x,0,-second.y)*delta*2.5
			bot.position.x=clampf(bot.position.x,-3,3)
			bot.position.z=clampf(bot.position.z,-3,0)
		# Solid fighters: separate horizontally on the ring plane.
		var offset := Vector2(_camera_rig.position.x-bot.position.x,_camera_rig.position.z-bot.position.z)
		if offset.length()<0.9:
			var correction := offset.normalized()*(0.9-offset.length())
			_camera_rig.position+=Vector3(correction.x,0,correction.y)
	_update_camera_feedback(delta,_camera_rig.position.distance_to(before)>0.001)
	_update_match_hud()
	if sport!="boxing": _update_ball_art()

func _physics_process(dt: float) -> void:
	if paused: return
	result_delay=maxf(0,result_delay-dt)
	if sport=="boxing":
		boxing.step(dt)
		blocking=boxing.guard[0]
		second_blocking=boxing.guard[1]
		for p in [0,1]: ControllerManager.set_guard_feedback("controller_%d"%(p+1),boxing.guard[p])
		round_active=boxing.phase=="fight"
		human_health=boxing.health[0]
		bot_health=boxing.health[1]
		if boxing.phase!=previous_phase:
			previous_phase=boxing.phase
			_referee_says(boxing.message.replace("Referee: ",""))
		bot.rotation.z=lerp_angle(bot.rotation.z,1.15 if boxing.phase=="count" and boxing.down_player==1 else 0.0,dt*5)
		if not versus_human and boxing.phase=="fight":
			bot_delay-=dt
			var target := Vector3(_camera_rig.position.x,0,_camera_rig.position.z-1.6)
			bot.position=bot.position.move_toward(target,dt*0.8)
			boxing.guard[1]=boxing.stamina[1]<25
			if bot_delay<=0:
				_resolve_punch(1,45)
				bot_delay=1.4
		return
	if sport=="golf":
		if golf.step(dt):
			_message_label.text=golf.result
			result_delay=1.8
			bot_delay=2.0
			if not golf.finished:
				if shown_hole!=golf.hole: _render_hole()
				_focus_ball()
	else:
		if not aim_locked and not bowling.rolling:
			sweep_time+=dt
			aim=sin(sweep_time*1.3)*0.12
		if bowling.step(dt):
			_message_label.text=bowling.result
			result_delay=1.8
			bot_delay=2.0
			aim_locked=false
			_render_pins()
			_camera_rig.position=Vector3(0,1.65,7)
	var rules = golf if sport=="golf" else bowling
	if not versus_human and rules.player==1 and not rules.rolling and not rules.finished and result_delay==0:
		bot_delay-=dt
		if bot_delay<=0:
			if sport=="golf":
				var shot: Dictionary = golf.bot_shot()
				golf.launch(shot.power,shot.angle,shot.club)
			else: bowling.launch(72,0.012,-0.25,0.1)
			bot_delay=2

func _focus_ball() -> void:
	var at: Vector2 = golf.positions[golf.player]
	_camera_rig.position=Vector3(at.x,1.65,at.y+2)
	aim=atan2((GolfRules.HOLES[golf.hole].cup-at).x,-(GolfRules.HOLES[golf.hole].cup-at).y)

func _update_ball_art() -> void:
	if not is_instance_valid(ball_art): return
	if sport=="golf":
		var at: Vector2 = golf.positions[golf.player]
		ball_art.position=Vector3(at.x,0.22+golf.height,at.y)
		arrow.position=Vector3(at.x,0.14,at.y)
		arrow.visible=not golf.rolling and not golf.finished
	else:
		ball_art.position=Vector3(bowling.ball.x,0.4,bowling.ball.y) if bowling.rolling else Vector3(clampf(_camera_rig.position.x,-1.65,1.65),0.4,5)
		arrow.position=Vector3(ball_art.position.x,0.15,5)
		arrow.visible=not bowling.rolling and not bowling.finished
		for i in range(mini(pin_art.get_child_count(),bowling.pins.size())):
			var pin: Dictionary = bowling.pins[i]
			var art := pin_art.get_child(i) as Node3D
			art.position=Vector3(pin.pos.x,0.1,pin.pos.y)
			art.rotation.x=PI*0.46 if pin.down else 0.0
	arrow.rotation.y=-aim

func _on_block(id: String, active: bool) -> void:
	super._on_block(id,active)
	var p := 0 if id=="controller_1" else 1
	boxing.guard[p]=active and boxing.stagger[p]<=0

func _on_punch(id: String, power: float, _direction: Vector3) -> void:
	if sport!="boxing" or paused or (id=="controller_2" and not versus_human): return
	_resolve_punch(0 if id=="controller_1" else 1,power)

func _resolve_punch(p: int, power: float) -> void:
	var distance := Vector2(_camera_rig.position.x-bot.position.x,_camera_rig.position.z-bot.position.z).length()
	var stick := _effective_stick("controller_%d" % (p+1))
	var message: String = boxing.punch(p,power,distance,maxf(0,-stick.y))
	if message.is_empty(): return
	_power_label.text="POWER %d" % roundi(power)
	_message_label.text=message
	if message=="Hit!" or message=="Blocked" or message=="Guard break!":
		shake_amount=0.018 if message=="Blocked" else 0.05
		if p==0: bot.position.z=maxf(-3,bot.position.z-0.15)
		else: _camera_rig.position.z=minf(3.5,_camera_rig.position.z+0.15)

func _on_golf_swing(id: String, power: float, _direction: Vector3) -> void:
	if sport!="golf" or paused or result_delay>0 or id!="controller_%d"%(golf.player+1) or (golf.player==1 and not versus_human): return
	if golf.launch(power,aim,club):
		_power_label.text="POWER %d" % roundi(power)
		_message_label.text="%s shot" % GolfRules.CLUBS[club]

func _on_bowling_swing(id: String, power: float, _direction: Vector3) -> void:
	if sport!="bowling" or paused or result_delay>0 or id!="controller_%d"%(bowling.player+1) or (bowling.player==1 and not versus_human): return
	if bowling.launch(power,aim,_camera_rig.position.x,spin):
		aim_locked=true
		_power_label.text="POWER %d" % roundi(power)
		_message_label.text="Rolling…"

func _update_match_hud() -> void:
	if not is_instance_valid(details): return
	var opponent := "Controller 2" if versus_human else "Club Bot"
	if sport=="boxing":
		round_label.text="ROUND %d / 3 · %02d:%02d · %s" % [boxing.round,int(boxing.remaining)/60,int(boxing.remaining)%60,boxing.phase.to_upper()]
		course_title.text=boxing.message.replace("Controller 2",opponent)
		details.text="Step into reach · A toggles guard · stamina recovers when resting · knockdowns %d : %d" % [boxing.knockdowns[0],boxing.knockdowns[1]]
		for p in [0,1]:
			health_bars[p].value=boxing.health[p]
			stamina_bars[p].value=boxing.stamina[p]
	else:
		var rules = golf if sport=="golf" else bowling
		var who := "Controller 1" if rules.player==0 else opponent
		round_label.text="%s · %s" % [who,"AIM MODE" if aim_mode else "D-pad moves · B to aim"]
		if sport=="golf":
			course_title.text="Hole %d / 3 · %s · par %d · %s" % [mini(golf.hole+1,3),GolfRules.HOLES[mini(golf.hole,2)].name,GolfRules.HOLES[mini(golf.hole,2)].par,GolfRules.CLUBS[club]]
			details.text="Strokes %d : %d · Total %d : %d\nCards %s / %s · Q/E aim · C club · Tab overview" % [golf.strokes[0],golf.strokes[1],golf.totals[0]+(0 if golf.finished else golf.strokes[0]),golf.totals[1]+(0 if golf.finished else golf.strokes[1]),str(golf.cards[0]),str(golf.cards[1])]
		else:
			course_title.text="Ten-pin bowling · %s · hook %+.1f · %s" % ["AIM LOCKED" if aim_locked else "A locks sweeping aim",spin,"GUTTER" if bowling.gutter else ""]
			details.text="Score %d : %d\nController 1: %s\n%s: %s\nQ/E aim · Z/X hook · D-pad lane position" % [BowlingRules.score(bowling.rolls[0]),BowlingRules.score(bowling.rolls[1]),str(BowlingRules.frames(bowling.rolls[0])),opponent,str(BowlingRules.frames(bowling.rolls[1]))]
		if rules.finished:
			var a: int = golf.totals[0] if sport=="golf" else BowlingRules.score(bowling.rolls[0])
			var b: int = golf.totals[1] if sport=="golf" else BowlingRules.score(bowling.rolls[1])
			var first_wins := a<b if sport=="golf" else a>b
			round_label.text="MATCH COMPLETE · %s · %d : %d" % ["Draw" if a==b else ("Controller 1" if first_wins else opponent)+" wins!",a,b]
