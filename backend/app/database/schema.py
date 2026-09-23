"""
LumiIQ v3 - Pydantic Schemas
Request and response validation schemas
"""
from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


# ============================================================================
# Patient Schemas
# ============================================================================

class PatientSettingsSchema(BaseModel):
    """Patient settings for gaze and voice configuration"""
    dwell_time_ms: int = Field(1000, ge=300, le=5000)
    smoothing_strength: float = Field(0.7, ge=0.0, le=1.0)
    active_eye: str = Field("both", pattern="^(left|right|both)$")
    ear_threshold: float = Field(0.2, ge=0.1, le=0.5)
    
    voice_volume: float = Field(1.0, ge=0.0, le=1.0)
    voice_pitch: float = Field(1.0, ge=0.5, le=2.0)
    voice_rate: float = Field(1.0, ge=0.5, le=2.0)
    language: str = Field("en", pattern="^(en|hi|gu)$")
    
    enable_safety_monitoring: bool = True
    blink_alert_threshold: int = Field(6, ge=3, le=20)
    eyes_closed_alert_ms: int = Field(3000, ge=1000, le=10000)
    
    calibration_points: int = Field(9, pattern="^(5|9|16|25)$")
    regression_model_type: str = "gradient_boosting"
    
    class Config:
        json_schema_extra = {
            "example": {
                "dwell_time_ms": 1000,
                "smoothing_strength": 0.7,
                "active_eye": "both",
                "voice_volume": 1.0,
            }
        }


class PatientCreateSchema(BaseModel):
    """Create new patient"""
    name: str = Field(..., min_length=1, max_length=255)
    date_of_birth: Optional[datetime] = None
    condition: Optional[str] = None
    notes: Optional[str] = None


class PatientResponseSchema(BaseModel):
    """Patient response with settings"""
    id: int
    name: str
    date_of_birth: Optional[datetime]
    condition: Optional[str]
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime
    settings: Optional[PatientSettingsSchema]
    
    class Config:
        from_attributes = True


# ============================================================================
# Session Schemas
# ============================================================================

class SessionCreateSchema(BaseModel):
    """Create new tracking session"""
    session_type: str = "communication"
    camera_device: Optional[str] = None
    screen_width: Optional[int] = None
    screen_height: Optional[int] = None


class SessionUpdateSchema(BaseModel):
    """Update session status"""
    status: str = Field(..., pattern="^(active|paused|completed)$")
    frames_processed: Optional[int] = None
    tracking_confidence_avg: Optional[float] = None
    blink_count: Optional[int] = None


class SessionResponseSchema(BaseModel):
    """Session response"""
    id: int
    patient_id: int
    session_type: str
    status: str
    start_time: datetime
    end_time: Optional[datetime]
    duration_seconds: Optional[int]
    frames_processed: int
    tracking_confidence_avg: Optional[float]
    blink_count: int
    
    class Config:
        from_attributes = True


# ============================================================================
# Calibration Schemas
# ============================================================================

class CalibrationDataPoint(BaseModel):
    """Single calibration point"""
    point_id: int
    screen_x: float
    screen_y: float
    samples: List[Dict[str, float]]  # raw iris/head data


class CalibrationCreateSchema(BaseModel):
    """Start calibration session"""
    calibration_points: int = Field(9, pattern="^(5|9|16|25)$")
    model_type: str = "gradient_boosting"


class CalibrationSampleSchema(BaseModel):
    """Submit calibration sample"""
    point_id: int
    iris_left_x: float
    iris_left_y: float
    iris_right_x: float
    iris_right_y: float
    head_yaw: float
    head_pitch: float
    head_roll: float
    eye_aspect_ratio: float
    screen_x: float
    screen_y: float


class CalibrationCompleteSchema(BaseModel):
    """Complete calibration and train model"""
    samples: List[CalibrationSampleSchema]


class CalibrationResponseSchema(BaseModel):
    """Calibration response"""
    id: int
    session_id: int
    calibration_points: int
    samples_collected: int
    quality_score: Optional[float]
    accuracy_px: Optional[float]
    confidence_score: Optional[float]
    model_type: str
    status: str
    completed_at: Optional[datetime]
    
    class Config:
        from_attributes = True


# ============================================================================
# Communication Schemas
# ============================================================================

class CommunicationCreateSchema(BaseModel):
    """Log communication"""
    text: str = Field(..., min_length=1, max_length=1000)
    communication_type: str = Field("spoken", pattern="^(spoken|typed|keyboard|emergency)$")
    language: str = "en"
    priority: str = Field("normal", pattern="^(normal|urgent|emergency)$")


class CommunicationResponseSchema(BaseModel):
    """Communication response"""
    id: int
    session_id: int
    text: str
    communication_type: str
    language: str
    priority: str
    created_at: datetime
    
    class Config:
        from_attributes = True


# ============================================================================
# Symptom Schemas
# ============================================================================

class SymptomReportCreateSchema(BaseModel):
    """Report symptom"""
    body_region: str = Field(..., pattern="^(Head|Eyes|Ears|Nose|Mouth|Jaw|Neck|Chest|Heart|Lungs|Abdomen|Stomach|Pelvis|Shoulder|Arm|Hand|Back|Leg|Foot)$")
    specific_part: Optional[str] = None
    symptom_type: str = Field(..., pattern="^(Pain|Burning|Numbness|Spasm|Weakness|Pressure|Itching|Cold|Hot|Swelling|Tingling|Difficulty Moving)$")
    severity: int = Field(..., ge=1, le=10)
    duration_minutes: Optional[int] = None
    notes: Optional[str] = None


class SymptomReportResponseSchema(BaseModel):
    """Symptom report response"""
    id: int
    session_id: int
    body_region: str
    specific_part: Optional[str]
    symptom_type: str
    severity: int
    duration_minutes: Optional[int]
    notes: Optional[str]
    created_at: datetime
    
    class Config:
        from_attributes = True


# ============================================================================
# Alert Schemas
# ============================================================================

class AlertResponseSchema(BaseModel):
    """Alert response"""
    id: int
    session_id: int
    alert_type: str
    alert_level: str
    message: str
    acknowledged: bool
    acknowledged_at: Optional[datetime]
    created_at: datetime
    
    class Config:
        from_attributes = True


class AlertAcknowledgeSchema(BaseModel):
    """Acknowledge alert"""
    response: Optional[str] = None


# ============================================================================
# Gaze Schemas
# ============================================================================

class GazePointSchema(BaseModel):
    """Single gaze point update"""
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    gaze_x: float = Field(..., ge=0.0, le=1.0)  # Normalized 0-1
    gaze_y: float = Field(..., ge=0.0, le=1.0)
    confidence: float = Field(..., ge=0.0, le=1.0)
    left_iris_x: float
    left_iris_y: float
    right_iris_x: float
    right_iris_y: float
    head_yaw: float
    head_pitch: float
    head_roll: float
    eye_aspect_ratio: float
    blink_state: str = Field("open", pattern="^(open|closed|blinking)$")


class FaceDetectionSchema(BaseModel):
    """Face detection status"""
    detected: bool
    confidence: float = Field(0.0, ge=0.0, le=1.0)
    face_x: Optional[float] = None
    face_y: Optional[float] = None
    face_width: Optional[float] = None
    face_height: Optional[float] = None
    head_yaw: Optional[float] = None
    head_pitch: Optional[float] = None
    head_roll: Optional[float] = None


class TrackingStatusSchema(BaseModel):
    """Current tracking status"""
    session_active: bool
    face_detected: bool
    face_confidence: float
    eyes_visible: bool
    last_gaze_time: Optional[datetime]
    frames_processed: int
    tracking_confidence_avg: float
    blink_count: int


# ============================================================================
# Analytics Schemas
# ============================================================================

class AnalyticsResponseSchema(BaseModel):
    """Analytics summary"""
    date: datetime
    total_sessions: int
    total_tracking_minutes: int
    avg_tracking_confidence: Optional[float]
    total_communications: int
    total_symptom_reports: int
    total_alerts: int
    critical_alerts_count: int
    
    class Config:
        from_attributes = True


# ============================================================================
# Health & Status Schemas
# ============================================================================

class HealthCheckSchema(BaseModel):
    """System health check response"""
    status: str
    version: str
    timestamp: datetime
    database: str
    services: Dict[str, str]


class ErrorSchema(BaseModel):
    """Error response"""
    detail: str
    error_code: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)
