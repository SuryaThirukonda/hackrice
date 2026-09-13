#!/usr/bin/env python3
"""
MediaPipe Head Tracker for Boxing (Tempo Arcade)
Tracks player head movements (duck, slip/sway left, slip/sway right) via webcam
and sends control events to the Tempo relay server.
"""

import argparse
import asyncio
import json
import math
import os
import sys
import threading
import time
import urllib.request
from collections import deque

import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

# Default configuration
DEFAULT_URL = "ws://127.0.0.1:8790/controller-ws"
MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite"
MODEL_DIR = os.path.expanduser("~/.cache/mediapipe")
MODEL_PATH = os.path.join(MODEL_DIR, "blaze_face_short_range.tflite")

# Movement thresholds (normalized relative to detected face scale)
# Distance: Requires a pronounced, intentional head movement (larger distance)
DODGE_THRESHOLD_X = 0.40  # Horizontal displacement to trigger slip/sway (was 0.22)
DUCK_THRESHOLD_Y = 0.38   # Vertical downward displacement to trigger duck (was 0.22)

# Sudden Jerk: Minimum velocity (face units per second) required
JERK_SPEED_X = 1.30       # Must snap/jerk horizontally fast
JERK_SPEED_Y = 1.10       # Must snap/jerk downward fast

# Deadzone & Timing
REARM_THRESHOLD_X = 0.18  # Must return close to center to re-arm
REARM_THRESHOLD_Y = 0.18  # Must return close to center to re-arm
COOLDOWN_SEC = 0.35       # Cooldown between triggers
CALIBRATION_SAMPLES = 25  # Frames to establish neutral center


def ensure_model():
    """Ensure the MediaPipe blaze_face model is present locally."""
    if os.path.exists(MODEL_PATH):
        return MODEL_PATH
    os.makedirs(MODEL_DIR, exist_ok=True)
    print(f"Downloading MediaPipe face model to {MODEL_PATH}...")
    try:
        urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
        print("Model downloaded successfully.")
    except Exception as e:
        print(f"Error downloading model: {e}", file=sys.stderr)
        raise
    return MODEL_PATH


class RelayClient:
    """WebSocket client for the Tempo relay, running its own asyncio loop on a daemon thread.

    A closed socket is detected by send/recv raising, never by a `closed` attribute: websockets 14 and
    later removed that attribute, and reading it threw inside the loop, so the client reconnected every
    second and never delivered a packet. Packets are only accepted while connected, so a dodge made while
    the relay was unreachable is dropped instead of firing seconds late.
    """

    MAX_QUEUED = 64

    def __init__(self, url: str):
        self.url = url
        self.connected = False
        self.seq = 0
        self.queue = deque(maxlen=self.MAX_QUEUED)
        self.loop = None
        self.thread = None
        self.running = True
        self.last_error = None
        # Event ids must not repeat across tracker restarts: the relay and the game both drop ids they have seen.
        self.session = os.urandom(4).hex()
        self._seq_lock = threading.Lock()

    def start(self):
        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()

    def _run_loop(self):
        asyncio.set_event_loop(self.loop)
        self.loop.run_until_complete(self._connect_and_serve())

    def _next_seq(self):
        # The camera loop and the socket thread both number packets, and the relay drops any that go backwards.
        with self._seq_lock:
            self.seq += 1
            return self.seq

    async def _connect_and_serve(self):
        import websockets

        while self.running:
            try:
                async with websockets.connect(self.url) as ws:
                    self.queue.clear()  # anything left from a previous connection is stale
                    # Claim the head_tracker slot; every later packet is numbered after this one.
                    await ws.send(json.dumps({"type": "hello", "controllerId": "head_tracker", "seq": self._next_seq()}))
                    self.connected = True
                    while self.running:
                        while self.queue:
                            await ws.send(json.dumps(self.queue.popleft()))
                        try:
                            # Reads acks and game_state. Raises once the socket closes, which ends this
                            # connection and schedules a reconnect.
                            raw = await asyncio.wait_for(ws.recv(), timeout=0.02)
                        except asyncio.TimeoutError:
                            continue
                        self._note(raw)
            except Exception:
                pass
            finally:
                self.connected = False
            if self.running:
                await asyncio.sleep(1.0)

    def _note(self, raw):
        """Say once why the relay refused the tracker, e.g. an agent service started before head_tracker existed."""
        try:
            packet = json.loads(raw)
        except (TypeError, ValueError):
            return
        if not isinstance(packet, dict):
            return
        if packet.get("type") == "hello" and packet.get("ok"):
            self.last_error = None
        elif packet.get("type") == "error" and packet.get("code") != self.last_error:
            self.last_error = packet.get("code")
            print(f"Relay refused the head tracker: {self.last_error}. "
                  "An agent service started before this feature says invalid_controller_id: restart `npm run agent`.",
                  file=sys.stderr)

    def send_action(self, action: str):
        if not self.connected:
            return
        seq = self._next_seq()
        self.queue.append({
            "type": "action",
            "controllerId": "head_tracker",
            "sport": "boxing",
            "action": action,
            "eventId": f"head-{self.session}-{seq}",
            "seq": seq,
        })

    def send_stick(self, x: float, y: float):
        if not self.connected:
            return
        seq = self._next_seq()
        self.queue.append({
            "type": "stick",
            "controllerId": "head_tracker",
            "sport": "boxing",
            "stick": [round(x, 2), round(y, 2)],
            "calibrated": True,
            "seq": seq,
        })

    def stop(self):
        self.running = False


class HeadTracker:
    def __init__(self, camera_id=0, relay_url=DEFAULT_URL, show_window=True):
        self.camera_id = camera_id
        self.show_window = show_window
        self.relay = RelayClient(relay_url)

        model_path = ensure_model()
        base_options = python.BaseOptions(model_asset_path=model_path)
        options = vision.FaceDetectorOptions(base_options=base_options)
        self.detector = vision.FaceDetector.create_from_options(options)

        # Calibration & tracking state
        self.neutral_cx = None
        self.neutral_cy = None
        self.neutral_scale = None
        self.calibrating = True
        self.calib_samples = []

        # Position history for sudden jerk / velocity computation (timestamp, dx, dy)
        self.pos_history = deque(maxlen=30)

        # Trigger latch
        self.current_gesture = "neutral"
        self.armed = True
        self.last_action_time = 0
        self.last_action_name = "NONE"

    def calibrate(self):
        self.calibrating = True
        self.calib_samples = []
        self.neutral_cx = None
        self.neutral_cy = None
        self.neutral_scale = None
        self.pos_history.clear()

    def process_frame(self, frame):
        # Mirror the frame so movement feels intuitive
        frame = cv2.flip(frame, 1)
        h, w, _ = frame.shape

        # Convert to RGB for MediaPipe
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        detection_result = self.detector.detect(mp_image)

        dx, dy = 0.0, 0.0
        vx, vy = 0.0, 0.0
        face_detected = False
        face_box = None

        if detection_result.detections:
            face_detected = True
            det = detection_result.detections[0]
            bbox = det.bounding_box
            bx = bbox.origin_x
            by = bbox.origin_y
            bw = bbox.width
            bh = bbox.height
            face_box = (bx, by, bw, bh)

            cx = bx + bw / 2.0
            cy = by + bh / 2.0
            scale = max(bw, bh)

            if self.calibrating:
                self.calib_samples.append((cx, cy, scale))
                if len(self.calib_samples) >= CALIBRATION_SAMPLES:
                    avg_cx = sum(s[0] for s in self.calib_samples) / len(self.calib_samples)
                    avg_cy = sum(s[1] for s in self.calib_samples) / len(self.calib_samples)
                    avg_scale = sum(s[2] for s in self.calib_samples) / len(self.calib_samples)
                    self.neutral_cx = avg_cx
                    self.neutral_cy = avg_cy
                    self.neutral_scale = max(1.0, avg_scale)
                    self.calibrating = False
            elif self.neutral_cx is not None and self.neutral_scale is not None:
                now = time.time()
                # Calculate normalized displacement
                dx = (cx - self.neutral_cx) / self.neutral_scale
                dy = (cy - self.neutral_cy) / self.neutral_scale

                # Compute jerk velocity looking backwards through recent history
                for past_t, past_dx, past_dy in reversed(self.pos_history):
                    dt = now - past_t
                    if dt >= 0.02:
                        vx = (dx - past_dx) / dt
                        vy = (dy - past_dy) / dt
                        if dt >= 0.10:
                            break

                # Append to position history
                self.pos_history.append((now, dx, dy))

                # Re-arm only when returning within the neutral deadzone
                if abs(dx) < REARM_THRESHOLD_X and abs(dy) < REARM_THRESHOLD_Y:
                    if not self.armed:
                        self.armed = True
                        self.pos_history.clear()
                        self.pos_history.append((now, dx, dy))
                    self.current_gesture = "neutral"

                # Check gestures: ONLY activate on sudden jerks with long distance
                if self.armed and (now - self.last_action_time > COOLDOWN_SEC):
                    # Sudden duck: fast downward movement and deep displacement
                    if dy > DUCK_THRESHOLD_Y and vy > JERK_SPEED_Y:
                        self.current_gesture = "duck"
                        self.armed = False
                        self.last_action_time = now
                        self.last_action_name = "JERK DUCK!"
                        self.relay.send_action("duck")
                    # Sudden slip left: fast snap left and long displacement
                    elif dx < -DODGE_THRESHOLD_X and vx < -JERK_SPEED_X:
                        self.current_gesture = "sway_left"
                        self.armed = False
                        self.last_action_time = now
                        self.last_action_name = "JERK SLIP ◀"
                        self.relay.send_action("sway_left")
                    # Sudden slip right: fast snap right and long displacement
                    elif dx > DODGE_THRESHOLD_X and vx > JERK_SPEED_X:
                        self.current_gesture = "sway_right"
                        self.armed = False
                        self.last_action_time = now
                        self.last_action_name = "JERK SLIP ▶"
                        self.relay.send_action("sway_right")

                # Send continuous stick for motion lab
                stick_x = max(-1.0, min(1.0, dx * 1.8))
                stick_y = max(-1.0, min(1.0, dy * 1.8))
                self.relay.send_stick(stick_x, stick_y)

        # Draw HUD overlays if display window is enabled
        if self.show_window:
            self.draw_hud(frame, face_box, dx, dy, vx, vy, face_detected)

        return frame

    def draw_hud(self, frame, face_box, dx, dy, vx, vy, face_detected):
        h, w, _ = frame.shape

        # Semi-transparent top bar
        overlay = frame.copy()
        cv2.rectangle(overlay, (0, 0), (w, 54), (20, 20, 24), -1)
        # Bottom status bar
        cv2.rectangle(overlay, (0, h - 64), (w, h), (20, 20, 24), -1)
        cv2.addWeighted(overlay, 0.75, frame, 0.25, 0, frame)

        # Header Title
        cv2.putText(frame, "TEMPO BOXING  ·  HEAD TRACKER", (18, 34),
                    cv2.FONT_HERSHEY_DUPLEX, 0.75, (255, 255, 255), 2, cv2.LINE_AA)

        # Connection status indicator
        conn_text = "● RELAY CONNECTED" if self.relay.connected else "○ CONNECTING TO RELAY..."
        conn_color = (60, 220, 90) if self.relay.connected else (60, 180, 255)
        cv2.putText(frame, conn_text, (w - 280, 34),
                    cv2.FONT_HERSHEY_DUPLEX, 0.55, conn_color, 1, cv2.LINE_AA)

        # Calibration or Tracking visuals
        if self.calibrating:
            msg = f"CALIBRATING NEUTRAL HEAD POSITION... ({len(self.calib_samples)}/{CALIBRATION_SAMPLES})"
            cv2.putText(frame, msg, (w // 2 - 260, h // 2),
                        cv2.FONT_HERSHEY_DUPLEX, 0.65, (0, 220, 255), 2, cv2.LINE_AA)
            cv2.putText(frame, "Look straight ahead at the screen and hold still", (w // 2 - 220, h // 2 + 35),
                        cv2.FONT_HERSHEY_DUPLEX, 0.5, (200, 200, 200), 1, cv2.LINE_AA)
        elif face_detected and face_box:
            bx, by, bw, bh = face_box
            # Draw face target box
            box_color = (0, 255, 200) if self.current_gesture != "neutral" else (180, 180, 180)
            cv2.rectangle(frame, (bx, by), (bx + bw, by + bh), box_color, 2)

            # Draw neutral center crosshair
            if self.neutral_cx and self.neutral_cy:
                ncx, ncy = int(self.neutral_cx), int(self.neutral_cy)
                cv2.drawMarker(frame, (ncx, ncy), (80, 80, 220), cv2.MARKER_CROSS, 24, 2)

        # Active Gesture Badge at bottom
        badge_color = (60, 60, 70)
        badge_text = "READY  (SNAP HEAD)" if self.armed else "RETURN TO CENTER"
        if not self.armed:
            badge_color = (40, 40, 50)
        if self.current_gesture == "duck":
            badge_color = (255, 120, 0)
            badge_text = "▼  JERK DUCK!  ▼"
        elif self.current_gesture == "sway_left":
            badge_color = (0, 210, 255)
            badge_text = "◀  JERK SLIP LEFT"
        elif self.current_gesture == "sway_right":
            badge_color = (0, 210, 255)
            badge_text = "JERK SLIP RIGHT  ▶"

        # Badge pill
        pill_w, pill_h = 280, 44
        pill_x = w // 2 - pill_w // 2
        pill_y = h - 54
        cv2.rectangle(frame, (pill_x, pill_y), (pill_x + pill_w, pill_y + pill_h), badge_color, -1)
        cv2.rectangle(frame, (pill_x, pill_y), (pill_x + pill_w, pill_y + pill_h), (255, 255, 255), 1)

        text_size = cv2.getTextSize(badge_text, cv2.FONT_HERSHEY_DUPLEX, 0.62, 2)[0]
        tx = pill_x + (pill_w - text_size[0]) // 2
        ty = pill_y + (pill_h + text_size[1]) // 2
        cv2.putText(frame, badge_text, (tx, ty), cv2.FONT_HERSHEY_DUPLEX, 0.62, (255, 255, 255), 2, cv2.LINE_AA)

        # Real-time Meters: Distance & Jerk Velocity
        cv2.putText(frame, f"DIST  dX:{dx:+.2f} dY:{dy:+.2f}  [REQ: >0.40]", (16, h - 38),
                    cv2.FONT_HERSHEY_DUPLEX, 0.42, (180, 180, 180), 1, cv2.LINE_AA)
        cv2.putText(frame, f"JERK  vX:{vx:+.2f} vY:{vy:+.2f}  [REQ: >1.30]", (16, h - 16),
                    cv2.FONT_HERSHEY_DUPLEX, 0.42, (0, 220, 255) if (abs(vx) > JERK_SPEED_X or vy > JERK_SPEED_Y) else (140, 140, 140), 1, cv2.LINE_AA)

        # Hint
        cv2.putText(frame, "Press 'C' to Recalibrate  ·  'Q' to Exit", (w - 310, h - 25),
                    cv2.FONT_HERSHEY_DUPLEX, 0.46, (160, 160, 160), 1, cv2.LINE_AA)

    def _open_camera(self):
        # AVFoundation is the macOS backend; elsewhere OpenCV picks its own (V4L2 on Linux, MSMF on Windows).
        if sys.platform == "darwin":
            cap = cv2.VideoCapture(self.camera_id, cv2.CAP_AVFOUNDATION)
            if cap.isOpened():
                return cap
        return cv2.VideoCapture(self.camera_id)

    def run(self):
        print(f"Opening webcam camera {self.camera_id}...")
        cap = self._open_camera()

        # On macOS the first run waits for the camera permission prompt.
        if not cap.isOpened() and sys.platform == "darwin":
            print("Waiting for camera authorization...")
            for _ in range(6):
                time.sleep(0.6)
                cap = self._open_camera()
                if cap.isOpened():
                    break

        if not cap.isOpened():
            print(f"\n[Error] Could not open camera {self.camera_id}.", file=sys.stderr)
            if sys.platform == "darwin":
                print("macOS camera permission required:", file=sys.stderr)
                print("  1. Open System Settings -> Privacy & Security -> Camera", file=sys.stderr)
                print("  2. Turn the toggle ON for Terminal (or your code editor)", file=sys.stderr)
                print("  3. Re-run: npm run head-tracker\n", file=sys.stderr)
            else:
                print("Check that a webcam is connected and not in use by another app", file=sys.stderr)
                print("(on Linux, `ls /dev/video*` lists them), or choose one with --camera N.\n", file=sys.stderr)
            sys.exit(1)

        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

        self.relay.start()
        print(f"Head tracker running. Connecting to relay at {self.relay.url}...")
        print("Move head left/right to dodge, down to duck. Press 'C' to recalibrate.")

        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    time.sleep(0.01)
                    continue

                processed = self.process_frame(frame)

                if self.show_window:
                    cv2.imshow("Tempo Head Tracker (Boxing)", processed)
                    key = cv2.waitKey(1) & 0xFF
                    if key in (ord("q"), 27):  # q or Esc
                        break
                    elif key == ord("c"):
                        self.calibrate()
        finally:
            cap.release()
            if self.show_window:
                cv2.destroyAllWindows()
            self.relay.stop()
            print("Head tracker stopped.")


def main():
    parser = argparse.ArgumentParser(description="MediaPipe Head Tracker for Tempo Boxing")
    parser.add_argument("--camera", type=int, default=0, help="Camera device index (default: 0)")
    parser.add_argument("--url", type=str, default=DEFAULT_URL, help="Relay WebSocket URL")
    parser.add_argument("--no-window", action="store_true", help="Run headless without OpenCV preview window")
    args = parser.parse_args()

    tracker = HeadTracker(camera_id=args.camera, relay_url=args.url, show_window=not args.no_window)
    tracker.run()


if __name__ == "__main__":
    main()
