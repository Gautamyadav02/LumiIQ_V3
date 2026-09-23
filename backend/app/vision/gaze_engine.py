import cv2
import dlib
import numpy as np
import urllib.request
import bz2
import os
from scipy.spatial import distance as dist

class GazeEngine:
    def __init__(self):
        # Initialize Dlib's HOG-based face detector
        self.detector = dlib.get_frontal_face_detector()
        
        # Ensure the 68-point landmark model exists locally
        model_path = "shape_predictor_68_face_landmarks.dat"
        if not os.path.exists(model_path):
            print("[LumiIQ] Downloading Dlib shape predictor (this may take a moment)...")
            url = "http://dlib.net/files/shape_predictor_68_face_landmarks.dat.bz2"
            with urllib.request.urlopen(url) as response:
                with bz2.BZ2File(response) as bz_file:
                    with open(model_path, "wb") as out_file:
                        out_file.write(bz_file.read())
            print("[LumiIQ] Dlib model downloaded successfully.")
            
        self.predictor = dlib.shape_predictor(model_path)
        
        # 3D facial model points for Head Pose Estimation (SolvePnP)
        self.model_points = np.array([
            (0.0, 0.0, 0.0),             # Nose tip
            (0.0, -330.0, -65.0),        # Chin
            (-225.0, 170.0, -135.0),     # Left eye left corner
            (225.0, 170.0, -135.0),      # Right eye right corner
            (-150.0, -150.0, -125.0),    # Left Mouth corner
            (150.0, -150.0, -125.0)      # Right mouth corner
        ])

    def _calculate_ear(self, eye):
        """Calculates the Eye Aspect Ratio (EAR) for blink detection."""
        A = dist.euclidean(eye[1], eye[5])
        B = dist.euclidean(eye[2], eye[4])
        C = dist.euclidean(eye[0], eye[3])
        return (A + B) / (2.0 * C)

    def _get_iris_center(self, shape, eye_pts, frame, gray):
        """Extracts the eye region and finds the normalized pupil/iris center."""
        pts = np.array([shape[i] for i in eye_pts])
        x, y, w, h = cv2.boundingRect(pts)
        eye_roi = gray[y:y+h, x:x+w]
        
        if eye_roi.size == 0:
            return 0.5, 0.5

        # Apply threshold to find the darkest spot (pupil)
        _, thresh = cv2.threshold(eye_roi, 30, 255, cv2.THRESH_BINARY_INV)
        M = cv2.moments(thresh)
        
        if M["m00"] != 0:
            cx = int(M["m10"] / M["m00"])
            cy = int(M["m01"] / M["m00"])
        else:
            cx, cy = w // 2, h // 2

        # Normalize center between 0.0 and 1.0 relative to the eye bounding box
        return cx / float(w), cy / float(h)

    def process_frame(self, frame):
        """Processes a BGR camera frame and returns gaze features."""
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = self.detector(gray, 0)
        
        if not faces:
            return None

        # Focus on the first detected face
        face = faces[0]
        shape = self.predictor(gray, face)
        
        coords = np.zeros((68, 2), dtype="int")
        for i in range(0, 68):
            coords[i] = (shape.part(i).x, shape.part(i).y)

        # 1. EAR (Eye Aspect Ratio) Calculation
        left_eye_pts = coords[36:42]
        right_eye_pts = coords[42:48]
        
        ear_left = self._calculate_ear(left_eye_pts)
        ear_right = self._calculate_ear(right_eye_pts)
        avg_ear = (ear_left + ear_right) / 2.0

        # 2. Iris Ratios (X, Y mapped 0-1)
        lx, ly = self._get_iris_center(coords, range(36, 42), frame, gray)
        rx, ry = self._get_iris_center(coords, range(42, 48), frame, gray)

        # 3. Head Pose Estimation (Yaw, Pitch, Roll)
        image_points = np.array([
            coords[30],     # Nose tip
            coords[8],      # Chin
            coords[36],     # Left eye left corner
            coords[45],     # Right eye right corner
            coords[48],     # Left Mouth corner
            coords[54]      # Right mouth corner
        ], dtype="double")

        size = frame.shape
        focal_length = size[1]
        center = (size[1]/2, size[0]/2)
        camera_matrix = np.array([
            [focal_length, 0, center[0]],
            [0, focal_length, center[1]],
            [0, 0, 1]
        ], dtype="double")

        # Assume no lens distortion
        dist_coeffs = np.zeros((4,1)) 
        success, rotation_vector, translation_vector = cv2.solvePnP(
            self.model_points, image_points, camera_matrix, dist_coeffs, flags=cv2.SOLVEPNP_ITERATIVE
        )
        
        # Convert rotation vector to euler angles
        rmat, _ = cv2.Rodrigues(rotation_vector)
        angles, _, _, _, _, _ = cv2.RQDecomp3x3(rmat)
        pitch, yaw, roll = angles[0], angles[1], angles[2]

        return {
            # Features array matches the exact indices expected by ridge-regression.js
            "features": [lx, ly, rx, ry, yaw, pitch, roll, avg_ear],
            "eyeMode": "both",
            "lOpen": ear_left > 0.18,
            "rOpen": ear_right > 0.18,
            "earL": ear_left,
            "earR": ear_right,
            "rawRatios": {
                "x": (lx + rx) / 2.0, 
                "y": (ly + ry) / 2.0
            }
        }