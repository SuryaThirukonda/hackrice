import os
import sys
import time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import numpy as np
import cv2
from scripts.head_tracker import HeadTracker, DODGE_THRESHOLD_X, DUCK_THRESHOLD_Y

def test_head_tracker_gestures():
    print("Initializing HeadTracker with no-window and mock relay...")
    tracker = HeadTracker(camera_id=0, show_window=False)
    
    # Track sent actions
    actions_sent = []
    tracker.relay.send_action = lambda action: actions_sent.append(action)
    tracker.relay.send_stick = lambda x, y: None

    # Helper to draw a mock face (circle with eyes/mouth for detector)
    def make_face_frame(center_x, center_y, size=100):
        # 640x480 black canvas
        img = np.zeros((480, 640, 3), dtype=np.uint8)
        # Face skin tone
        cv2.circle(img, (int(center_x), int(center_y)), size, (180, 210, 240), -1)
        # Eyes
        cv2.circle(img, (int(center_x - size * 0.35), int(center_y - size * 0.2)), int(size * 0.12), (30, 30, 30), -1)
        cv2.circle(img, (int(center_x + size * 0.35), int(center_y - size * 0.2)), int(size * 0.12), (30, 30, 30), -1)
        # Mouth
        cv2.ellipse(img, (int(center_x), int(center_y + size * 0.4)), (int(size * 0.3), int(size * 0.15)), 0, 0, 180, (40, 40, 160), -1)
        return img

    print("Simulating calibration at center (320, 240)...")
    # Feed 30 neutral frames for calibration
    center_frame = make_face_frame(320, 240, 90)
    for _ in range(30):
        tracker.process_frame(center_frame)
    
    assert not tracker.calibrating, "Calibration should be complete"
    print(f"Calibrated center: cx={tracker.neutral_cx:.1f}, cy={tracker.neutral_cy:.1f}, scale={tracker.neutral_scale:.1f}")

    # 1. Test small movement (slight lean): should NOT trigger
    print("Testing small head drift (should NOT trigger)...")
    actions_sent.clear()
    small_drift_frame = make_face_frame(345, 240, 90) # only 25px shift (dx ~ 0.18 < 0.40)
    tracker.process_frame(small_drift_frame)
    assert len(actions_sent) == 0, f"Small drift should not trigger, got {actions_sent}"
    tracker.process_frame(center_frame)

    # 2. Test sudden jerk left (fast shift towards camera right x=410, player left dx < -0.40)
    print("Testing sudden jerk left...")
    actions_sent.clear()
    time.sleep(0.06)
    left_jerk_frame = make_face_frame(410, 240, 90) # 90px shift (dx ~ 0.66, vx > 1.30)
    tracker.process_frame(left_jerk_frame)
    print(f"Actions sent on jerk left: {actions_sent}")
    assert "sway_left" in actions_sent, f"Expected sway_left, got {actions_sent}"

    # Return to neutral to re-arm
    print("Returning to neutral to re-arm...")
    time.sleep(0.36)
    tracker.process_frame(center_frame)
    assert tracker.armed, "Tracker should re-arm at neutral"

    # 3. Test sudden jerk right (fast shift towards camera left x=230, player right dx > 0.40)
    print("Testing sudden jerk right...")
    actions_sent.clear()
    time.sleep(0.06)
    right_jerk_frame = make_face_frame(230, 240, 90) # 90px shift (dx ~ 0.66, vx > 1.30)
    tracker.process_frame(right_jerk_frame)
    print(f"Actions sent on jerk right: {actions_sent}")
    assert "sway_right" in actions_sent, f"Expected sway_right, got {actions_sent}"

    # Return to neutral to re-arm
    print("Returning to neutral to re-arm...")
    time.sleep(0.36)
    tracker.process_frame(center_frame)
    assert tracker.armed, "Tracker should re-arm at neutral"

    # 4. Test sudden jerk duck (fast shift down y=330, dy > 0.38)
    print("Testing sudden jerk duck...")
    actions_sent.clear()
    time.sleep(0.06)
    duck_jerk_frame = make_face_frame(320, 330, 90) # 90px shift down
    tracker.process_frame(duck_jerk_frame)
    print(f"Actions sent on jerk duck: {actions_sent}")
    assert "duck" in actions_sent, f"Expected duck, got {actions_sent}"

    print("\nALL SUDDEN JERK TESTS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    test_head_tracker_gestures()
