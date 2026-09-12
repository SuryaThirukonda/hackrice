# Godot Phone Sports Club

Current main scene uses `scripts/match_scene.gd` and separate boxing, golf,
and bowling rule models. See `../docs/HANDOFF.md` for current match controls.
Godot sets the phone sport. Both human-vs-human and human-vs-AI have automatic
turn progression. The setup notes below describe the earlier range receiver.

From the repository root, run regressions with:

```sh
HAP_CONTROLLER_PORT=19089 godot --headless --path godot res://tests/match_rules.tscn
HAP_CONTROLLER_PORT=19089 godot --headless --path godot res://tests/controller_ui.tscn
```

Godot 4.x first-person golf range for two Wii-style phone controllers.
Networking lives entirely in the autoloaded
`ControllerManager`; game scenes only need to subscribe to its signals.

## Run

1. Install Godot 4.3 or newer (standard, non-.NET build is sufficient).
2. Open Godot Project Manager, choose **Import**, and select:

   ```text
   /path/to/hackrice/godot/project.godot
   ```

3. Click **Run Project** or press **F6/F5**. The golf range starts and
   `ControllerManager` listens on all interfaces on TCP port `9080`.
4. If macOS asks whether Godot may accept incoming connections, choose
   **Allow**.
5. Find the laptop's Wi-Fi address:

   ```bash
   ipconfig getifaddr en0
   ```

6. Point each controller WebSocket at:

   ```text
   ws://LAPTOP_WIFI_IP:9080
   ```

   The first phone sends `controller_1` in its hello; the second sends
   `controller_2`. Both devices and the laptop must be on the same LAN.

For a controller page served over HTTPS, Safari will block a direct insecure
`ws://` connection as mixed content. In that setup, expose this receiver
through the page's HTTPS reverse proxy (for example `/controller-ws` to local
port `9080`) and have the phone use same-origin
`wss://HOST/controller-ws`. The Godot receiver accepts any WebSocket request
path.

## Protocol

Send one compact JSON object per WebSocket text packet. A socket must claim
exactly one controller with `hello` before sending data. Only
`controller_1` and `controller_2` are accepted, and a second socket cannot
claim an occupied ID.

### Hello

```json
{"type":"hello","controllerId":"controller_1","seq":40}
```

Godot acknowledges the claim:

```json
{"type":"hello","ok":true,"controllerId":"controller_1","serverTime":1234}
```

`seq` is optional on hello. On reconnect, send the last sequence already
issued by the phone so it becomes the floor for the new connection; the next
motion or gesture must use a larger value. Omitting it starts the connection
at `-1`.

### Motion telemetry

```json
{"type":"motion","controllerId":"controller_1","seq":41,"t":59341.2,"a":[1.2,-3.4,8.2],"r":[22.1,74.8,-5.2],"interval":16.7}
```

`a` is acceleration without gravity when available, `r` is rotation rate,
`t` is the phone's monotonic sample timestamp, and `interval` is milliseconds.
Motion telemetry is optional debug traffic. Stale motion (`seq` less than or
equal to the last accepted sequence on that connection) is ignored.

### Aim stick

```json
{"type":"stick","controllerId":"controller_1","seq":42,"t":59344.0,"stick":[0.31,-0.18],"calibrated":true}
```

`stick` is a screen-relative two-axis vector clamped to the unit circle. It is
derived from phone tilt relative to the pose held during calibration and sent
at up to 30 Hz independently of debug motion telemetry.

### Gesture

```json
{"type":"gesture","controllerId":"controller_1","seq":43,"eventId":"controller_1_43","t":59347.4,"gesture":"punch","power":81,"direction":[0.82,0.14,-0.31],"peakAcceleration":19.4,"peakRotation":122.7,"duration":118}
```

Supported gesture names are `punch`, `golf_swing`, and `bowling_swing`.
`power` is clamped to `0–100`. Direction is a three-number array and is
normalized if its length exceeds one.

Every gesture needs a monotonically increasing `seq` and non-empty,
controller-unique `eventId`. Godot rejects a gesture when its sequence is
not newer than the controller's last accepted packet or when its event ID
appears in the rolling 256-ID duplicate cache. Sequence tracking resets only
after a successful reconnecting `hello` (to its optional hello `seq` floor);
recent event IDs remain cached. Event IDs should remain unique across
reconnects.

### Ping/pong

After hello, the phone can measure RTT:

```json
{"type":"ping","controllerId":"controller_1","id":123,"t":12345.67}
```

Godot answers in the packet handler immediately:

```json
{"type":"pong","id":123}
```

The phone calculates RTT because phone and Godot monotonic clocks are not
directly comparable.

### Controller action

```json
{"type":"action","controllerId":"controller_1","seq":44,"eventId":"controller_1_action_44","t":59401.2,"sport":"boxing","action":"block_start"}
```

Supported actions are `block_start`, `block_end`, `emergency_power`,
`placeholder_primary`, and `placeholder_secondary`. They use the same sequence
and duplicate protection as gestures.

### Optional reported metrics

The phone may attach this object to `hello`, `motion`, `gesture`, or `ping`:

```json
{"metrics":{"sensorHz":59.8,"rttNow":7.4,"rttMedian":8.1,"rttP95":14.7}}
```

The diagnostic cards show these values along with packet age, sensor vectors,
magnitudes, connection count, and the last accepted sequence/gesture.

## Godot API

Subscribe from any gameplay script:

```gdscript
func _ready() -> void:
    ControllerManager.punch.connect(_on_punch)

func _on_punch(
    controller_id: String,
    power: float,
    direction: Vector3
) -> void:
    print(controller_id, power, direction)
```

Available signals:

- `controller_connected(controller_id)`
- `controller_disconnected(controller_id)`
- `motion_received(controller_id, motion)`
- `stick_received(controller_id, stick)`
- `gesture_received(controller_id, gesture)`
- `controller_action(controller_id, action, payload)`
- `punch(controller_id, power, direction)`
- `golf_swing(controller_id, power, direction)`
- `bowling_swing(controller_id, power, direction)`
- `block_changed(controller_id, blocking)`
- `emergency_power(controller_id)`

Read a safe copy of current diagnostic state with
`ControllerManager.get_controller_state("controller_1")` or
`ControllerManager.get_all_controller_states()`.

The included `main.gd` maps stick input to yaw/pitch and `golf_swing` power to
a physics impulse. When both phones are connected, the most recently aimed or
swung controller becomes active and each player's balls use a distinct color.

## AI commentator

Run the backend alongside Godot:

```bash
cd backend
uv run --env-file .env uvicorn app.main:app --port 8000 --reload
```

Copy `backend/.env.example` to `backend/.env` and set:

- `OPENAI_KEY` for fresh event-aware commentary text.
- `ELEVENLABS_API_KEY` for spoken commentary using the configured announcer
  voice and on-disk MP3 cache.

The feature degrades safely: ElevenLabs without OpenAI voices deterministic
play-by-play, and no keys still produces on-screen fallback commentary. Set
`HAP_COMMENTARY_URL` when the backend is not at `http://127.0.0.1:8000`.

Verify the configured key/voice with one short cached phrase:

```bash
cd backend
uv run --env-file .env python -m scripts.verify_elevenlabs
```
