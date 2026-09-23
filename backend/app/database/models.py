"""
LumiIQ v3 - Database Models
Professional medical-grade SQLAlchemy models for eye-gaze platform
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import Column, Integer, String, Float, DateTime, JSON, ForeignKey, Text, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship

Base = declarative_base()


class Patient(Base):
    """Patient profile and metadata"""
    __tablename__ = "patients"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    date_of_birth = Column(DateTime, nullable=True)
    condition = Column(String(100), nullable=True)  # ALS, Locked-In, Stroke, etc.
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    sessions = relationship("Session", back_populates="patient", cascade="all, delete-orphan")
    settings = relationship("PatientSettings", back_populates="patient", uselist=False, cascade="all, delete-orphan")
    
    class Config:
        orm_mode = True


class PatientSettings(Base):
    """User-configurable settings"""
    __tablename__ = "patient_settings"
    
    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), unique=True)
    
    # Gaze engine settings
    dwell_time_ms = Column(Integer, default=1000)
    smoothing_strength = Column(Float, default=0.7)  # 0.0-1.0
    active_eye = Column(String(10), default="both")  # left, right, both
    ear_threshold = Column(Float, default=0.2)  # Eye aspect ratio for blink detection
    
    # Voice settings
    voice_volume = Column(Float, default=1.0)  # 0.0-1.0
    voice_pitch = Column(Float, default=1.0)  # 0.5-2.0
    voice_rate = Column(Float, default=1.0)  # 0.5-2.0
    language = Column(String(10), default="en")  # en, hi, gu
    
    # Safety settings
    enable_safety_monitoring = Column(Boolean, default=True)
    blink_alert_threshold = Column(Integer, default=6)  # rapid blinks in 3s
    eyes_closed_alert_ms = Column(Integer, default=3000)
    
    # Advanced settings
    calibration_points = Column(Integer, default=9)  # 5, 9, 16, 25
    regression_model_type = Column(String(50), default="gradient_boosting")
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    patient = relationship("Patient", back_populates="settings")
    
    class Config:
        orm_mode = True


class Session(Base):
    """Tracking session - one per patient per activity period"""
    __tablename__ = "sessions"
    
    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    
    session_type = Column(String(50), default="communication")  # communication, calibration, monitoring
    status = Column(String(20), default="active")  # active, paused, completed
    
    # Session metrics
    start_time = Column(DateTime, default=datetime.utcnow)
    end_time = Column(DateTime, nullable=True)
    duration_seconds = Column(Integer, nullable=True)
    
    # Tracking stats
    frames_processed = Column(Integer, default=0)
    tracking_confidence_avg = Column(Float, nullable=True)  # 0-100
    blink_count = Column(Integer, default=0)
    
    # Metadata
    camera_device = Column(String(255), nullable=True)
    screen_width = Column(Integer, nullable=True)
    screen_height = Column(Integer, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    patient = relationship("Patient", back_populates="sessions")
    calibrations = relationship("Calibration", back_populates="session", cascade="all, delete-orphan")
    communications = relationship("Communication", back_populates="session", cascade="all, delete-orphan")
    symptoms = relationship("SymptomReport", back_populates="session", cascade="all, delete-orphan")
    alerts = relationship("Alert", back_populates="session", cascade="all, delete-orphan")
    
    class Config:
        orm_mode = True


class Calibration(Base):
    """Calibration session and data"""
    __tablename__ = "calibrations"
    
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=False)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    
    calibration_points = Column(Integer)  # 5, 9, 16, 25
    samples_collected = Column(Integer, default=0)
    
    # Quality metrics
    quality_score = Column(Float, nullable=True)  # 0-100: Excellent/Good/Fair/Poor
    accuracy_px = Column(Float, nullable=True)  # pixels
    confidence_score = Column(Float, nullable=True)  # 0-100
    
    # Raw calibration data (JSON for flexibility)
    calibration_data = Column(JSON, nullable=True)  # {point_id: [samples]}
    
    # Regression model
    model_type = Column(String(50))  # gradient_boosting, random_forest, xgboost
    model_params = Column(JSON, nullable=True)
    
    status = Column(String(20), default="pending")  # pending, in_progress, completed
    completed_at = Column(DateTime, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    session = relationship("Session", back_populates="calibrations")
    
    class Config:
        orm_mode = True


class Communication(Base):
    """Logged communications/text output"""
    __tablename__ = "communications"
    
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=False)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    
    text = Column(Text, nullable=False)
    communication_type = Column(String(20))  # spoken, typed, keyboard, emergency
    language = Column(String(10), default="en")
    
    # Voice metadata (if applicable)
    voice_volume = Column(Float, nullable=True)
    voice_pitch = Column(Float, nullable=True)
    voice_rate = Column(Float, nullable=True)
    
    # Priority (for emergency commands)
    priority = Column(String(20), default="normal")  # normal, urgent, emergency
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    session = relationship("Session", back_populates="communications")
    
    class Config:
        orm_mode = True


class SymptomReport(Base):
    """Patient reported symptoms"""
    __tablename__ = "symptom_reports"
    
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=False)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    
    # Anatomical location
    body_region = Column(String(50), nullable=False)  # Head, Chest, Left Arm, etc.
    specific_part = Column(String(100), nullable=True)
    
    # Symptom details
    symptom_type = Column(String(50), nullable=False)  # Pain, Numbness, Burning, Spasm, etc.
    severity = Column(Integer, nullable=False)  # 1-10 scale
    duration_minutes = Column(Integer, nullable=True)
    
    # Additional context
    notes = Column(Text, nullable=True)
    onset_time = Column(DateTime, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    session = relationship("Session", back_populates="symptoms")
    
    class Config:
        orm_mode = True


class Alert(Base):
    """Safety alerts and anomalies"""
    __tablename__ = "alerts"
    
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=False)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    
    alert_type = Column(String(50), nullable=False)  # face_missing, eyes_closed, rapid_blink, etc.
    alert_level = Column(String(20), default="info")  # info, warning, critical
    
    # Alert details
    message = Column(Text)
    details = Column(JSON, nullable=True)  # Additional metadata
    
    # Response
    acknowledged = Column(Boolean, default=False)
    acknowledged_at = Column(DateTime, nullable=True)
    response = Column(Text, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    session = relationship("Session", back_populates="alerts")
    
    class Config:
        orm_mode = True


class Analytics(Base):
    """Aggregated analytics for dashboards"""
    __tablename__ = "analytics"
    
    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    
    # Time period
    date = Column(DateTime, default=datetime.utcnow)
    
    # Session stats
    total_sessions = Column(Integer, default=0)
    total_tracking_minutes = Column(Integer, default=0)
    avg_tracking_confidence = Column(Float, nullable=True)
    
    # Communication stats
    total_communications = Column(Integer, default=0)
    total_symptom_reports = Column(Integer, default=0)
    total_alerts = Column(Integer, default=0)
    
    # Safety stats
    critical_alerts_count = Column(Integer, default=0)
    avg_blink_rate = Column(Float, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    class Config:
        orm_mode = True
