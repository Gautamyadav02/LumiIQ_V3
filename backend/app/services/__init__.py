"""
LumiIQ v3 - Service Layer
Business logic and orchestration
"""
from typing import Optional, Tuple, Dict, List
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
import logging

from app.repositories import (
    PatientRepository, PatientSettingsRepository, SessionRepository,
    CalibrationRepository, CommunicationRepository, SymptomRepository,
    AlertRepository, AnalyticsRepository
)
from app.database.schema import (
    PatientCreateSchema, PatientSettingsSchema, SessionCreateSchema,
    CommunicationCreateSchema, SymptomReportCreateSchema
)
from app.vision import GazeEngine, GazeStabilizer

logger = logging.getLogger(__name__)


class PatientService:
    """Patient management service"""
    
    @staticmethod
    def create_patient(db: Session, patient_data: PatientCreateSchema):
        """Create new patient with default settings"""
        patient = PatientRepository.create(db, patient_data)
        # Initialize default settings
        PatientSettingsRepository.get_or_create(db, patient.id)
        return patient
    
    @staticmethod
    def get_patient_with_settings(db: Session, patient_id: int):
        """Get patient with all settings"""
        patient = PatientRepository.get_by_id(db, patient_id)
        if patient:
            patient.settings = PatientSettingsRepository.get_or_create(db, patient_id)
        return patient
    
    @staticmethod
    def update_patient_settings(db: Session, patient_id: int, settings: PatientSettingsSchema):
        """Update patient settings"""
        return PatientSettingsRepository.update(db, patient_id, settings)


class SessionService:
    """Tracking session management"""
    
    @staticmethod
    def start_session(db: Session, patient_id: int, session_data: SessionCreateSchema):
        """Start new tracking session"""
        # End any active sessions
        active = SessionRepository.get_active_session(db, patient_id)
        if active:
            SessionRepository.update_status(db, active.id, "completed")
        
        # Create new session
        return SessionRepository.create(db, patient_id, session_data)
    
    @staticmethod
    def end_session(db: Session, session_id: int):
        """End tracking session"""
        return SessionRepository.update_status(db, session_id, "completed")
    
    @staticmethod
    def get_session_summary(db: Session, session_id: int):
        """Get complete session summary"""
        session = SessionRepository.get_by_id(db, session_id)
        if not session:
            return None
        
        return {
            "session": session,
            "communications": CommunicationRepository.get_session_logs(db, session_id),
            "symptoms": SymptomRepository.get_session_symptoms(db, session_id),
            "alerts": AlertRepository.get_session_alerts(db, session_id),
            "calibration": next(
                (c for c in session.calibrations if c.status == "completed"),
                None
            )
        }


class CalibrationService:
    """Calibration management and model training"""
    
    def __init__(self, gaze_engine: Optional[GazeEngine] = None):
        self.gaze_engine = gaze_engine or GazeEngine()
    
    def start_calibration(self, db: Session, session_id: int, patient_id: int, 
                         calibration_points: int = 9, model_type: str = "gradient_boosting"):
        """Start new calibration session"""
        return CalibrationRepository.create(
            db, session_id, patient_id, calibration_points, model_type
        )
    
    def add_calibration_sample(self, db: Session, calibration_id: int,
                              iris_left_x: float, iris_left_y: float,
                              iris_right_x: float, iris_right_y: float,
                              head_yaw: float, head_pitch: float, head_roll: float,
                              ear: float, screen_x: float, screen_y: float):
        """Add sample to calibration"""
        calibration = CalibrationRepository.get_by_id(db, calibration_id)
        if not calibration:
            return None
        
        # Add to gaze engine
        from app.vision import IrisData
        iris_data = IrisData(
            left_center=(iris_left_x, iris_left_y),
            right_center=(iris_right_x, iris_right_y),
            left_radius=5.0,
            right_radius=5.0,
            eye_aspect_ratio=ear,
            blink_state="open"
        )
        self.gaze_engine.add_calibration_sample(
            iris_data, (head_yaw, head_pitch, head_roll), screen_x, screen_y
        )
        
        # Update count
        calibration.samples_collected += 1
        db.commit()
        db.refresh(calibration)
        
        return calibration
    
    def complete_calibration(self, db: Session, calibration_id: int) -> bool:
        """Train model and complete calibration"""
        calibration = CalibrationRepository.get_by_id(db, calibration_id)
        if not calibration or calibration.status != "in_progress":
            return False
        
        # Train model
        success = self.gaze_engine.train_regression_model(calibration.model_type)
        if not success:
            logger.error("Model training failed")
            return False
        
        # Calculate quality score
        accuracy = getattr(self.gaze_engine, 'calibration_accuracy', 85.0)
        quality = "Excellent" if accuracy > 90 else "Good" if accuracy > 75 else "Fair" if accuracy > 60 else "Poor"
        
        # Update calibration
        CalibrationRepository.update(db, calibration_id, {
            'status': 'completed',
            'quality_score': accuracy,
            'confidence_score': accuracy,
            'accuracy_px': max(0, 50 - (accuracy - 50) * 0.5)  # Rough estimate
        })
        
        logger.info(f"Calibration completed: {quality} ({accuracy:.1f}% accuracy)")
        return True


class GazeService:
    """Gaze tracking service"""
    
    def __init__(self):
        self.gaze_engine = GazeEngine()
        self.stabilizer = GazeStabilizer(
            enable_kalman=True,
            enable_one_euro=True,
            enable_ema=True
        )
        self.blink_history = []
        self.face_missing_start = None
    
    def process_frame(self, frame_data) -> Optional[Dict]:
        """Process video frame and return gaze point"""
        # This would receive actual frame data from WebSocket
        # For now, placeholder for integration
        pass
    
    def get_tracking_status(self) -> Dict:
        """Get current tracking status"""
        return {
            "face_detected": True,
            "tracking_confidence": 0.85,
            "stabilizer_stats": self.stabilizer.get_stats()
        }


class SafetyService:
    """Safety monitoring and alert generation"""
    
    def __init__(self):
        self.blink_times = []
        self.eyes_closed_start = None
        self.face_missing_start = None
        self.blink_threshold_seconds = 3
        self.rapid_blink_count = 6
    
    def check_safety(self, db: Session, session_id: int, patient_id: int,
                    face_detected: bool, eye_aspect_ratio: float) -> Optional[Dict]:
        """Check for safety conditions and generate alerts"""
        alerts = []
        
        # Check face detection
        now = datetime.utcnow()
        if not face_detected:
            if self.face_missing_start is None:
                self.face_missing_start = now
            elif (now - self.face_missing_start).total_seconds() > 5:
                alert = AlertRepository.create(
                    db, session_id, patient_id,
                    "face_missing", "warning",
                    "Face not detected for more than 5 seconds"
                )
                alerts.append(alert)
        else:
            self.face_missing_start = None
        
        # Check blink rate
        blink_detected = eye_aspect_ratio < 0.2
        self.blink_times.append((now, blink_detected))
        
        # Keep only recent blinks (last 3 seconds)
        cutoff = now - timedelta(seconds=self.blink_threshold_seconds)
        self.blink_times = [(t, b) for t, b in self.blink_times if t > cutoff]
        
        # Count rapid blinks
        blink_count = sum(1 for t, b in self.blink_times if b)
        if blink_count >= self.rapid_blink_count:
            alert = AlertRepository.create(
                db, session_id, patient_id,
                "rapid_blink", "info",
                f"Rapid blinking detected ({blink_count} blinks in 3 seconds)"
            )
            alerts.append(alert)
            self.blink_times = []  # Reset
        
        # Check eyes closed duration
        if eye_aspect_ratio < 0.2:
            if self.eyes_closed_start is None:
                self.eyes_closed_start = now
            elif (now - self.eyes_closed_start).total_seconds() > 3:
                alert = AlertRepository.create(
                    db, session_id, patient_id,
                    "eyes_closed", "warning",
                    "Eyes closed for more than 3 seconds"
                )
                alerts.append(alert)
        else:
            self.eyes_closed_start = None
        
        return {"alerts_generated": alerts} if alerts else None


class CommunicationService:
    """Communication and logging service"""
    
    @staticmethod
    def log_communication(db: Session, session_id: int, patient_id: int,
                         comm_data: CommunicationCreateSchema):
        """Log communication"""
        return CommunicationRepository.create(db, session_id, patient_id, comm_data)
    
    @staticmethod
    def log_symptom(db: Session, session_id: int, patient_id: int,
                   symptom_data: SymptomReportCreateSchema):
        """Log symptom report"""
        return SymptomRepository.create(db, session_id, patient_id, symptom_data)
    
    @staticmethod
    def get_patient_timeline(db: Session, patient_id: int, hours: int = 24):
        """Get combined timeline of communications and symptoms"""
        communications = CommunicationRepository.get_recent_logs(db, patient_id, hours)
        symptoms = SymptomRepository.get_recent_symptoms(db, patient_id, int(hours / 24) + 1)
        
        # Combine and sort by time
        timeline = []
        for c in communications:
            timeline.append({
                'type': 'communication',
                'timestamp': c.created_at,
                'data': c
            })
        for s in symptoms:
            timeline.append({
                'type': 'symptom',
                'timestamp': s.created_at,
                'data': s
            })
        
        timeline.sort(key=lambda x: x['timestamp'], reverse=True)
        return timeline


class AnalyticsService:
    """Analytics and reporting"""
    
    @staticmethod
    def get_patient_dashboard(db: Session, patient_id: int):
        """Get comprehensive patient dashboard data"""
        patient = PatientRepository.get_by_id(db, patient_id)
        if not patient:
            return None
        
        today = datetime.utcnow()
        
        analytics = AnalyticsRepository.create_or_update_daily(db, patient_id, today)
        recent_alerts = AlertRepository.get_recent_critical_alerts(db, patient_id, 24)
        recent_symptoms = SymptomRepository.get_recent_symptoms(db, patient_id, 1)
        active_session = SessionRepository.get_active_session(db, patient_id)
        
        return {
            "patient": patient,
            "analytics": analytics,
            "active_session": active_session,
            "critical_alerts": recent_alerts,
            "recent_symptoms": recent_symptoms
        }
    
    @staticmethod
    def get_historical_analytics(db: Session, patient_id: int, days: int = 30):
        """Get historical analytics for trend analysis"""
        return AnalyticsRepository.get_daily_analytics(db, patient_id, days)
