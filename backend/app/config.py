"""
LumiIQ v3 - Configuration
"""
from pydantic_settings import BaseSettings
from typing import Optional
import os


class Settings(BaseSettings):
    """Application settings"""
    
    # App Info
    app_name: str = "LumiIQ v3"
    app_version: str = "3.0.0"
    debug: bool = False
    
    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    reload: bool = False
    
    # CORS
    cors_origins: list = ["http://localhost", "http://localhost:8000", "http://127.0.0.1:8000"]
    cors_credentials: bool = True
    cors_methods: list = ["*"]
    cors_headers: list = ["*"]
    
    # Database
    database_url: Optional[str] = None  # Uses SQLite by default
    
    # CV/Gaze Engine
    cv_backend: str = "opencv"  # opencv for WebCamera
    mediapipe_model: str = "heavy"  # lite, full, heavy
    min_face_confidence: float = 0.7
    min_iris_confidence: float = 0.6
    target_fps: int = 30
    
    # Calibration
    default_calibration_points: int = 9
    min_calibration_samples: int = 3  # samples per point
    calibration_outlier_threshold: float = 50.0  # pixels
    
    # Gaze stabilization
    enable_kalman_filter: bool = True
    enable_one_euro_filter: bool = True
    one_euro_fcmin: float = 1.0
    one_euro_beta: float = 0.1
    
    # Safety monitoring
    enable_safety_alerts: bool = True
    rapid_blink_threshold: int = 6  # blinks in 3 seconds
    eyes_closed_threshold_ms: int = 3000
    face_missing_threshold_ms: int = 5000
    
    # Logging
    log_level: str = "INFO"
    log_format: str = "json"  # json or text
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
