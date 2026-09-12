extends Node

## Networking-only autoload for up to two phone motion controllers.
## Gameplay scenes subscribe to these signals instead of touching sockets.

signal controller_connected(controller_id: String)
signal controller_disconnected(controller_id: String)
signal motion_received(controller_id: String, motion: Dictionary)
signal gesture_received(controller_id: String, gesture: Dictionary)
signal controller_action(controller_id: String, action: String, payload: Dictionary)
signal punch(controller_id: String, power: float, direction: Vector3)
signal golf_swing(controller_id: String, power: float, direction: Vector3)
signal bowling_swing(controller_id: String, power: float, direction: Vector3)
signal block_changed(controller_id: String, blocking: bool)
signal emergency_power(controller_id: String)

const PORT := 9080
const BIND_ADDRESS := "*"
const CONTROLLER_IDS := ["controller_1", "controller_2"]
const MAX_EVENT_IDS := 256
const HELLO_TIMEOUT_MS := 5000

var _server := TCPServer.new()
var _peers: Array[Dictionary] = []
var _controllers: Dictionary = {}
var _seen_event_ids: Dictionary = {}
var _event_id_order: Dictionary = {}
var _listen_error := OK


func _ready() -> void:
	for controller_id in CONTROLLER_IDS:
		_controllers[controller_id] = _new_controller_state(controller_id)
		_seen_event_ids[controller_id] = {}
		_event_id_order[controller_id] = []

	_listen_error = _server.listen(PORT, BIND_ADDRESS)
	if _listen_error != OK:
		push_error(
			"ControllerManager could not listen on port %d: %s"
			% [PORT, error_string(_listen_error)]
		)
	else:
		print("ControllerManager listening for WebSockets on port %d" % PORT)


func _process(_delta: float) -> void:
	if _server.is_listening():
		_accept_connections()

	var peers_snapshot: Array = _peers.duplicate()
	for peer_value in peers_snapshot:
		var peer_record: Dictionary = peer_value
		var socket: WebSocketPeer = peer_record["socket"]
		socket.poll()

		match socket.get_ready_state():
			WebSocketPeer.STATE_OPEN:
				peer_record["opened"] = true
				_read_available_packets(peer_record)
				var hello_age_ms := (
					Time.get_ticks_msec() - int(peer_record["accepted_at_ms"])
				)
				if (
					String(peer_record["controller_id"]).is_empty()
					and hello_age_ms > HELLO_TIMEOUT_MS
				):
					_reject_peer(
						peer_record,
						"hello_timeout",
						"hello was not received in time"
					)
			WebSocketPeer.STATE_CLOSED:
				_drop_peer(peer_record)
			WebSocketPeer.STATE_CONNECTING:
				var age_ms := Time.get_ticks_msec() - int(peer_record["accepted_at_ms"])
				if age_ms > HELLO_TIMEOUT_MS:
					socket.close(1002, "WebSocket handshake timeout")
			WebSocketPeer.STATE_CLOSING:
				pass


func _exit_tree() -> void:
	for peer_record in _peers:
		var socket: WebSocketPeer = peer_record["socket"]
		if socket.get_ready_state() == WebSocketPeer.STATE_OPEN:
			socket.close(1001, "Godot receiver stopped")
	_server.stop()


func is_listening() -> bool:
	return _server.is_listening()


func get_listen_error() -> int:
	return _listen_error


func get_controller_state(controller_id: String) -> Dictionary:
	if not _controllers.has(controller_id):
		return {}
	return _controllers[controller_id].duplicate(true)


func get_all_controller_states() -> Dictionary:
	return _controllers.duplicate(true)


func _new_controller_state(controller_id: String) -> Dictionary:
	return {
		"id": controller_id,
		"connected": false,
		"remote_host": "",
		"connected_at_ms": 0,
		"disconnected_at_ms": 0,
		"connection_count": 0,
		"last_sequence": -1,
		"last_packet_time_ms": 0,
		"packets_received": 0,
		"gestures_received": 0,
		"last_gesture": {
			"name": "none",
			"event_id": "",
			"seq": -1,
			"power": 0.0,
			"direction": [0.0, 0.0, 0.0],
			"received_at_ms": 0,
		},
		"last_action": {
			"name": "none",
			"event_id": "",
			"seq": -1,
			"received_at_ms": 0,
		},
		"latency": {
			"rtt_now_ms": -1.0,
			"rtt_median_ms": -1.0,
			"rtt_p95_ms": -1.0,
		},
		"sensor": {
			"rate_hz": 0.0,
			"interval_ms": 0.0,
			"last_sample_t": 0.0,
			"last_receive_time_ms": 0,
			"acceleration": [0.0, 0.0, 0.0],
			"rotation": [0.0, 0.0, 0.0],
			"accel_magnitude": 0.0,
			"rotation_magnitude": 0.0,
		},
	}


func _accept_connections() -> void:
	while _server.is_connection_available():
		var tcp_peer := _server.take_connection()
		if tcp_peer == null:
			return

		tcp_peer.set_no_delay(true)
		var socket := WebSocketPeer.new()
		var accept_error := socket.accept_stream(tcp_peer)
		if accept_error != OK:
			push_warning(
				"Rejected TCP connection: %s" % error_string(accept_error)
			)
			tcp_peer.disconnect_from_host()
			continue
		socket.set_no_delay(true)

		_peers.append({
			"socket": socket,
			"controller_id": "",
			"accepted_at_ms": Time.get_ticks_msec(),
			"opened": false,
		})


func _read_available_packets(peer_record: Dictionary) -> void:
	var socket: WebSocketPeer = peer_record["socket"]
	while socket.get_available_packet_count() > 0:
		var packet := socket.get_packet()
		if not socket.was_string_packet():
			_send_error(peer_record, "binary_not_supported", "Send JSON text packets")
			continue

		var parsed: Variant = JSON.parse_string(packet.get_string_from_utf8())
		if typeof(parsed) != TYPE_DICTIONARY:
			_send_error(peer_record, "invalid_json", "Expected a JSON object")
			continue

		_handle_message(peer_record, parsed)
		if socket.get_ready_state() != WebSocketPeer.STATE_OPEN:
			return


func _handle_message(peer_record: Dictionary, message: Dictionary) -> void:
	var message_type := String(message.get("type", ""))
	if message_type == "hello":
		_handle_hello(peer_record, message)
		return

	var controller_id := String(peer_record["controller_id"])
	if controller_id.is_empty():
		_reject_peer(peer_record, "hello_required", "Send hello before other packets")
		return

	if message.has("controllerId"):
		var packet_controller_id := String(message["controllerId"])
		if packet_controller_id != controller_id:
			_reject_peer(
				peer_record,
				"controller_mismatch",
				"Packet controllerId does not match this socket"
			)
			return

	match message_type:
		"motion":
			if not message.has("controllerId"):
				_send_error(
					peer_record,
					"controller_id_required",
					"motion requires controllerId"
				)
				return
			_handle_motion(controller_id, message)
		"gesture":
			if not message.has("controllerId"):
				_send_error(
					peer_record,
					"controller_id_required",
					"gesture requires controllerId"
				)
				return
			_handle_gesture(controller_id, message)
		"action":
			if not message.has("controllerId"):
				_send_error(
					peer_record,
					"controller_id_required",
					"action requires controllerId"
				)
				return
			_handle_action(controller_id, message)
		"ping":
			# Keep this path short: answer before doing metrics or UI bookkeeping.
			_send_json(peer_record, {
				"type": "pong",
				"id": message.get("id", null),
			})
			_touch_controller(controller_id, message)
		_:
			_send_error(peer_record, "unknown_type", "Unsupported message type")


func _handle_hello(peer_record: Dictionary, message: Dictionary) -> void:
	var requested_id := String(message.get("controllerId", ""))
	if requested_id not in CONTROLLER_IDS:
		_reject_peer(
			peer_record,
			"invalid_controller_id",
			"controllerId must be controller_1 or controller_2"
		)
		return

	var current_id := String(peer_record["controller_id"])
	if not current_id.is_empty():
		if current_id == requested_id:
			_send_hello_ack(peer_record, requested_id)
		else:
			_reject_peer(
				peer_record,
				"controller_change_forbidden",
				"A connected socket cannot change controllerId"
			)
		return

	var state: Dictionary = _controllers[requested_id]
	if bool(state["connected"]):
		_reject_peer(
			peer_record,
			"controller_in_use",
			"%s is already connected" % requested_id
		)
		return

	var now_ms := Time.get_ticks_msec()
	peer_record["controller_id"] = requested_id
	state["connected"] = true
	state["remote_host"] = _get_remote_host(peer_record)
	state["connected_at_ms"] = now_ms
	state["disconnected_at_ms"] = 0
	state["connection_count"] = int(state["connection_count"]) + 1
	# An optional hello sequence establishes a reconnect floor, preventing
	# older buffered packets from firing after a new socket is claimed.
	state["last_sequence"] = _read_sequence(message)
	state["last_packet_time_ms"] = now_ms
	state["packets_received"] = int(state["packets_received"]) + 1
	_update_reported_metrics(state, message)

	_send_hello_ack(peer_record, requested_id)
	controller_connected.emit(requested_id)


func _send_hello_ack(peer_record: Dictionary, controller_id: String) -> void:
	_send_json(peer_record, {
		"type": "hello",
		"ok": true,
		"controllerId": controller_id,
		"serverTime": Time.get_ticks_msec(),
	})


func _handle_motion(controller_id: String, message: Dictionary) -> void:
	var sequence := _read_sequence(message)
	if sequence < 0:
		return

	var state: Dictionary = _controllers[controller_id]
	if sequence <= int(state["last_sequence"]):
		return

	state["last_sequence"] = sequence
	_touch_controller(controller_id, message)
	_update_sensor_state(state, message)
	motion_received.emit(controller_id, message.duplicate(true))


func _handle_gesture(controller_id: String, message: Dictionary) -> void:
	var sequence := _read_sequence(message)
	var event_id := String(message.get("eventId", ""))
	var gesture_name := String(message.get("gesture", ""))
	if sequence < 0 or event_id.is_empty():
		return
	if gesture_name not in ["punch", "golf_swing", "bowling_swing"]:
		return

	var state: Dictionary = _controllers[controller_id]
	if sequence <= int(state["last_sequence"]):
		return
	if _seen_event_ids[controller_id].has(event_id):
		return

	var direction := _read_direction(message.get("direction", []))
	var direction_report := _classify_direction(direction)
	var power := clampf(_read_number(message.get("power", 0.0), 0.0), 0.0, 100.0)
	var now_ms := Time.get_ticks_msec()
	var normalized_gesture := {
		"name": gesture_name,
		"event_id": event_id,
		"seq": sequence,
		"power": power,
		"direction": [direction.x, direction.y, direction.z],
		"dominant_axis": direction_report["axis"],
		"direction_label": direction_report["label"],
		"received_at_ms": now_ms,
		"phone_timestamp": _read_number(message.get("t", 0.0), 0.0),
		"peak_acceleration": _read_number(
			message.get("peakAcceleration", 0.0),
			0.0
		),
		"peak_rotation": _read_number(message.get("peakRotation", 0.0), 0.0),
		"duration_ms": _read_number(message.get("duration", 0.0), 0.0),
	}

	_remember_event_id(controller_id, event_id)
	state["last_sequence"] = sequence
	state["last_gesture"] = normalized_gesture
	state["gestures_received"] = int(state["gestures_received"]) + 1
	_touch_controller(controller_id, message)

	gesture_received.emit(controller_id, normalized_gesture.duplicate(true))
	match gesture_name:
		"punch":
			punch.emit(controller_id, power, direction)
		"golf_swing":
			golf_swing.emit(controller_id, power, direction)
		"bowling_swing":
			bowling_swing.emit(controller_id, power, direction)


func _handle_action(controller_id: String, message: Dictionary) -> void:
	var sequence := _read_sequence(message)
	var event_id := String(message.get("eventId", ""))
	var action := String(message.get("action", ""))
	var allowed_actions := [
		"block_start",
		"block_end",
		"emergency_power",
		"placeholder_primary",
		"placeholder_secondary",
	]
	if sequence < 0 or event_id.is_empty() or action not in allowed_actions:
		return

	var state: Dictionary = _controllers[controller_id]
	if sequence <= int(state["last_sequence"]):
		return
	if _seen_event_ids[controller_id].has(event_id):
		return

	var normalized_action := {
		"name": action,
		"event_id": event_id,
		"seq": sequence,
		"sport": String(message.get("sport", "")),
		"received_at_ms": Time.get_ticks_msec(),
	}
	_remember_event_id(controller_id, event_id)
	state["last_sequence"] = sequence
	state["last_action"] = normalized_action
	_touch_controller(controller_id, message)

	controller_action.emit(controller_id, action, normalized_action.duplicate(true))
	match action:
		"block_start":
			block_changed.emit(controller_id, true)
		"block_end":
			block_changed.emit(controller_id, false)
		"emergency_power":
			emergency_power.emit(controller_id)


func _touch_controller(controller_id: String, message: Dictionary) -> void:
	var state: Dictionary = _controllers[controller_id]
	state["last_packet_time_ms"] = Time.get_ticks_msec()
	state["packets_received"] = int(state["packets_received"]) + 1
	_update_reported_metrics(state, message)


func _update_sensor_state(state: Dictionary, message: Dictionary) -> void:
	var sensor: Dictionary = state["sensor"]
	var now_ms := Time.get_ticks_msec()
	var previous_receive_ms := int(sensor["last_receive_time_ms"])
	if previous_receive_ms > 0:
		var receive_delta_ms := now_ms - previous_receive_ms
		if receive_delta_ms > 0:
			var measured_rate := 1000.0 / float(receive_delta_ms)
			var old_rate := float(sensor["rate_hz"])
			sensor["rate_hz"] = (
				measured_rate
				if old_rate <= 0.0
				else lerpf(old_rate, measured_rate, 0.15)
			)

	sensor["last_receive_time_ms"] = now_ms
	sensor["last_sample_t"] = _read_number(message.get("t", 0.0), 0.0)

	var acceleration := _read_triplet(message.get("a", []))
	var rotation := _read_triplet(message.get("r", []))
	sensor["acceleration"] = acceleration
	sensor["rotation"] = rotation
	sensor["accel_magnitude"] = _triplet_magnitude(acceleration)
	sensor["rotation_magnitude"] = _triplet_magnitude(rotation)

	var interval_ms := _read_number(
		message.get("interval", message.get("i", 0.0)),
		0.0
	)
	if interval_ms > 0.0:
		sensor["interval_ms"] = interval_ms
		var metrics_value: Variant = message.get("metrics", {})
		var has_reported_sensor_rate := false
		if typeof(metrics_value) == TYPE_DICTIONARY:
			var reported_metrics: Dictionary = metrics_value
			has_reported_sensor_rate = reported_metrics.has("sensorHz")
		if not has_reported_sensor_rate:
			sensor["rate_hz"] = 1000.0 / interval_ms


func _update_reported_metrics(state: Dictionary, message: Dictionary) -> void:
	var metrics_value: Variant = message.get("metrics", {})
	if typeof(metrics_value) != TYPE_DICTIONARY:
		return

	var metrics: Dictionary = metrics_value
	var latency: Dictionary = state["latency"]
	var sensor: Dictionary = state["sensor"]
	if metrics.has("rttNow"):
		latency["rtt_now_ms"] = _read_number(metrics["rttNow"], -1.0)
	if metrics.has("rttMedian"):
		latency["rtt_median_ms"] = _read_number(metrics["rttMedian"], -1.0)
	if metrics.has("rttP95"):
		latency["rtt_p95_ms"] = _read_number(metrics["rttP95"], -1.0)
	if metrics.has("sensorHz"):
		sensor["rate_hz"] = maxf(
			0.0,
			_read_number(metrics["sensorHz"], 0.0)
		)


func _read_sequence(message: Dictionary) -> int:
	if not message.has("seq"):
		return -1
	var value: Variant = message["seq"]
	if not _is_number(value):
		return -1
	return int(value)


func _read_direction(value: Variant) -> Vector3:
	var triplet := _read_triplet(value)
	var direction := Vector3(triplet[0], triplet[1], triplet[2])
	if direction.length_squared() > 1.0:
		return direction.normalized()
	return direction


func _classify_direction(direction: Vector3) -> Dictionary:
	var absolute := direction.abs()
	if absolute.x >= absolute.y and absolute.x >= absolute.z:
		return {"axis": "x", "label": "right" if direction.x >= 0.0 else "left"}
	if absolute.y >= absolute.z:
		return {"axis": "y", "label": "up" if direction.y >= 0.0 else "down"}
	return {"axis": "z", "label": "front" if direction.z >= 0.0 else "back"}


func _read_triplet(value: Variant) -> Array:
	if typeof(value) != TYPE_ARRAY or value.size() < 3:
		return [0.0, 0.0, 0.0]
	return [
		_read_number(value[0], 0.0),
		_read_number(value[1], 0.0),
		_read_number(value[2], 0.0),
	]


func _triplet_magnitude(value: Array) -> float:
	return Vector3(
		float(value[0]),
		float(value[1]),
		float(value[2])
	).length()


func _read_number(value: Variant, fallback: float) -> float:
	if _is_number(value):
		return float(value)
	return fallback


func _is_number(value: Variant) -> bool:
	var value_type := typeof(value)
	return value_type == TYPE_INT or value_type == TYPE_FLOAT


func _remember_event_id(controller_id: String, event_id: String) -> void:
	var seen: Dictionary = _seen_event_ids[controller_id]
	var order: Array = _event_id_order[controller_id]
	seen[event_id] = true
	order.append(event_id)
	if order.size() > MAX_EVENT_IDS:
		var expired_id: String = order.pop_front()
		seen.erase(expired_id)


func _get_remote_host(peer_record: Dictionary) -> String:
	var socket: WebSocketPeer = peer_record["socket"]
	return socket.get_connected_host()


func _send_json(peer_record: Dictionary, payload: Dictionary) -> void:
	var socket: WebSocketPeer = peer_record["socket"]
	if socket.get_ready_state() == WebSocketPeer.STATE_OPEN:
		socket.send_text(JSON.stringify(payload))


func _send_error(
	peer_record: Dictionary,
	code: String,
	message: String
) -> void:
	_send_json(peer_record, {
		"type": "error",
		"code": code,
		"message": message,
	})


func _reject_peer(
	peer_record: Dictionary,
	code: String,
	message: String
) -> void:
	_send_error(peer_record, code, message)
	var socket: WebSocketPeer = peer_record["socket"]
	if socket.get_ready_state() == WebSocketPeer.STATE_OPEN:
		socket.close(1008, message.left(120))


func _drop_peer(peer_record: Dictionary) -> void:
	if not _peers.has(peer_record):
		return

	var controller_id := String(peer_record["controller_id"])
	_peers.erase(peer_record)
	if controller_id.is_empty() or not _controllers.has(controller_id):
		return

	var state: Dictionary = _controllers[controller_id]
	if bool(state["connected"]):
		state["connected"] = false
		state["remote_host"] = ""
		state["disconnected_at_ms"] = Time.get_ticks_msec()
		controller_disconnected.emit(controller_id)
