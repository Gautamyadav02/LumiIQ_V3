import cv2
import dlib
import numpy as np
import bz2
import os
import urllib.request
from scipy.spatial import distance as dist

MODEL_PATH = "shape_predictor_68_face_landmarks.dat"

# Download the dlib model if not present. Certificates are verified: a 100 MB
# binary fetched without verification could be swapped in transit. If macOS
# Python reports a certificate error, run "Install Certificates.command" from
# the Python folder in Applications — do not disable verification.
if not os.path.exists(MODEL_PATH):
    print("Downloading Dlib shape predictor model...")
    url = "https://github.com/tzutalin/dlib-android/raw/master/data/shape_predictor_68_face_landmarks.dat"

    try:
        with urllib.request.urlopen(url) as response:
            with open(MODEL_PATH, "wb") as out_file:
                out_file.write(response.read())
        print("Download complete.")
    except Exception as e:
        print(f"Direct download failed: {e}")
        print("Fallback: Attempting compressed dlib source...")
        alt_url = "https://dlib.net/files/shape_predictor_68_face_landmarks.dat.bz2"
        with urllib.request.urlopen(alt_url) as response:
            with bz2.BZ2File(response) as bz_file:
                with open(MODEL_PATH, "wb") as out_file:
                    out_file.write(bz_file.read())
        print("Download complete.")

detector = dlib.get_frontal_face_detector()
predictor = dlib.shape_predictor(MODEL_PATH)

def get_ear(eye_pts):
    A = dist.euclidean(eye_pts[1], eye_pts[5])
    B = dist.euclidean(eye_pts[2], eye_pts[4])
    C = dist.euclidean(eye_pts[0], eye_pts[3])
    return (A + B) / (2.0 * C)

def track_pupil(gray, eye_pts):
    x, y, w, h = cv2.boundingRect(eye_pts)
    roi = gray[y:y+h, x:x+w]
    if roi.size == 0:
        return 0.5, 0.5
    _, thresh = cv2.threshold(roi, 35, 255, cv2.THRESH_BINARY_INV)
    M = cv2.moments(thresh)
    if M["m00"] != 0:
        cx = int(M["m10"] / M["m00"])
        cy = int(M["m01"] / M["m00"])
    else:
        cx, cy = w // 2, h // 2
    return cx / float(w), cy / float(h)

cap = cv2.VideoCapture(0)

print("Starting Dlib Eye Tracker. Press 'q' to quit.")
while cap.isOpened():
    ret, frame = cap.read()
    if not ret:
        break

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    faces = detector(gray)

    for face in faces:
        shape = predictor(gray, face)
        pts = np.array([(shape.part(i).x, shape.part(i).y) for i in range(68)])

        left_eye = pts[36:42]
        right_eye = pts[42:48]

        ear = (get_ear(left_eye) + get_ear(right_eye)) / 2.0
        lx, ly = track_pupil(gray, left_eye)
        rx, ry = track_pupil(gray, right_eye)

        cv2.polylines(frame, [left_eye], True, (0, 255, 0), 1)
        cv2.polylines(frame, [right_eye], True, (0, 255, 0), 1)

        state = "CLOSED/BLINK" if ear < 0.18 else "OPEN"
        cv2.putText(frame, f"Eye State: {state} | EAR: {ear:.2f}", (20, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
        cv2.putText(frame, f"Gaze - Left: ({lx:.2f}, {ly:.2f}) Right: ({rx:.2f}, {ry:.2f})", 
                    (20, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 0), 2)

    cv2.imshow("LumiIQ - Dlib Tracking Window", frame)
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()