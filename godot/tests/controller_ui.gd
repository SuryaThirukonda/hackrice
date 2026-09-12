extends Node

var failures := 0
var sequence := 0

func check(condition: bool, label: String) -> void:
	if not condition:
		failures += 1
		push_error(label)

func _ready() -> void:
	get_tree().set_meta("sport", "boxing")
	var game = load("res://scenes/main.tscn").instantiate()
	add_child(game)
	game.set_process(false)
	var clients: Array[WebSocketPeer] = []
	for number in [1, 2]:
		var socket := WebSocketPeer.new()
		socket.connect_to_url("ws://127.0.0.1:%d" % ControllerManager.get_port())
		for tick in range(100):
			socket.poll()
			if socket.get_ready_state() == WebSocketPeer.STATE_OPEN: break
			await get_tree().create_timer(0.01).timeout
		check(socket.get_ready_state() == WebSocketPeer.STATE_OPEN,"Socket opens")
		socket.send_text(JSON.stringify({"type":"hello","controllerId":"controller_%d" % number,"seq":0}))
		await get_tree().create_timer(0.05).timeout
		socket.poll()
		check(socket.get_available_packet_count()>0,"Hello acknowledged")
		if socket.get_available_packet_count()>0:
			var reply = JSON.parse_string(socket.get_packet().get_string_from_utf8())
			check(reply.get("sport")=="boxing","Hello includes Godot sport")
		clients.append(socket)
	for direction in [Vector2.UP,Vector2.DOWN,Vector2.LEFT,Vector2.RIGHT]:
		game._camera_rig.position=Vector3(0,1.65,2)
		sequence+=1
		clients[0].send_text(JSON.stringify({"type":"stick","controllerId":"controller_1","seq":sequence,"stick":[direction.x,direction.y],"calibrated":true}))
		await get_tree().create_timer(0.05).timeout
		var before: Vector3 = game._camera_rig.position
		game.shot_busy=true # Movement must work even after a shot.
		game._process(0.1)
		var expected := Vector3(direction.x,0,direction.y)*0.25
		check((game._camera_rig.position-before).is_equal_approx(expected),"D-pad moves %s" % direction)
		check(is_zero_approx(game._camera.rotation.y),"Camera stays forward")
	sequence+=1
	clients[0].send_text(JSON.stringify({"type":"stick","controllerId":"controller_1","seq":sequence,"stick":[0,0],"calibrated":true}))
	await get_tree().create_timer(0.05).timeout
	var stopped: Vector3 = game._camera_rig.position
	game._process(0.1)
	check(game._camera_rig.position.is_equal_approx(stopped),"Release stops movement")
	for active in [true,false]:
		sequence+=1
		clients[0].send_text(JSON.stringify({"type":"action","controllerId":"controller_1","seq":sequence,"eventId":"test_%d"%sequence,"action":"block_start" if active else "block_end","sport":"boxing"}))
		await get_tree().create_timer(0.05).timeout
		game._process(0.2)
		check(game.blocking==active,"Block toggle received")
		check(game.guard_arms[0].visible==active and game.guard_arms[1].visible==active,"Both guard arms toggle")
	for sport in ["golf","bowling","boxing"]:
		for socket in clients:
			socket.poll()
			while socket.get_available_packet_count()>0: socket.get_packet()
		ControllerManager.set_active_sport(sport)
		await get_tree().create_timer(0.05).timeout
		for socket in clients:
			socket.poll()
			check(socket.get_available_packet_count()>0,"Sport broadcast received")
			if socket.get_available_packet_count()>0:
				var reply = JSON.parse_string(socket.get_packet().get_string_from_utf8())
				check(reply.get("sport")==sport,"Both phones sync %s" % sport)
	for socket in clients: socket.close()
	print("Controller UI integration: %d failures" % failures)
	get_tree().quit(1 if failures else 0)
