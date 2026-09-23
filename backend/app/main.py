"""
LumiIQ v3 - Main FastAPI Application
"""
import logging
from datetime import datetime
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path

from app.config import settings
from app.database import init_db, get_db, SessionLocal
from app.database.schema import (
    HealthCheckSchema, ErrorSchema,
    PatientCreateSchema, PatientResponseSchema, PatientSettingsSchema,
    SessionCreateSchema, SessionResponseSchema,
    CalibrationCreateSchema, CalibrationResponseSchema, CalibrationSampleSchema,
    CommunicationCreateSchema, CommunicationResponseSchema,
    SymptomReportCreateSchema, SymptomReportResponseSchema,
    AlertResponseSchema, AlertAcknowledgeSchema,
    AnalyticsResponseSchema
)

# Configure logging
logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Professional eye-gaze communication and patient monitoring platform",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=settings.cors_credentials,
    allow_methods=settings.cors_methods,
    allow_headers=settings.cors_headers,
)

# Initialize database
init_db()

# Mount static files (frontend)
frontend_dir = Path(__file__).parent.parent.parent / "frontend"
if frontend_dir.exists():
    app.mount("/static", StaticFiles(directory=frontend_dir), name="static")


# ============================================================================
# Health & Status Routes
# ============================================================================

@app.get("/api/health", response_model=HealthCheckSchema)
def health_check():
    """System health check"""
    return HealthCheckSchema(
        status="ok",
        version=settings.app_version,
        timestamp=datetime.utcnow(),
        database="sqlite",
        services={
            "gaze_engine": "ready",
            "video_capture": "ready",
            "database": "connected"
        }
    )


@app.get("/")
def root():
    """Serve main app"""
    index_path = Path(__file__).parent.parent.parent / "frontend" / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return {"message": "LumiIQ v3 API Server"}


# ============================================================================
# Patient Routes
# ============================================================================

@app.post("/api/patients")
def create_patient(patient_data: PatientCreateSchema, db = Depends(get_db)):
    """Create new patient"""
    from app.services import PatientService
    patient = PatientService.create_patient(db, patient_data)
    return patient


@app.get("/api/patients/{patient_id}")
def get_patient(patient_id: int, db = Depends(get_db)):
    """Get patient details"""
    from app.services import PatientService
    patient = PatientService.get_patient_with_settings(db, patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    return patient


@app.get("/api/patients")
def list_patients(skip: int = 0, limit: int = 50, db = Depends(get_db)):
    """List all patients"""
    from app.repositories import PatientRepository
    return PatientRepository.get_all(db, skip, limit)


@app.put("/api/patients/{patient_id}/settings")
def update_settings(patient_id: int, settings: PatientSettingsSchema, db = Depends(get_db)):
    """Update patient settings"""
    from app.services import PatientService
    updated = PatientService.update_patient_settings(db, patient_id, settings)
    if not updated:
        raise HTTPException(status_code=404, detail="Patient not found")
    return updated


# ============================================================================
# Session Routes
# ============================================================================

@app.post("/api/sessions")
def start_session(patient_id: int, session_data: SessionCreateSchema, db = Depends(get_db)):
    """Start new tracking session"""
    from app.services import SessionService
    session = SessionService.start_session(db, patient_id, session_data)
    return session


@app.get("/api/sessions/{session_id}")
def get_session(session_id: int, db = Depends(get_db)):
    """Get session details"""
    from app.services import SessionService
    summary = SessionService.get_session_summary(db, session_id)
    if not summary:
        raise HTTPException(status_code=404, detail="Session not found")
    return summary


@app.post("/api/sessions/{session_id}/end")
def end_session(session_id: int, db = Depends(get_db)):
    """End tracking session"""
    from app.services import SessionService
    session = SessionService.end_session(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


# ============================================================================
# Calibration Routes
# ============================================================================

@app.post("/api/calibrations")
def start_calibration(session_id: int, patient_id: int, calibration_points: int = 9,
                     model_type: str = "gradient_boosting", db = Depends(get_db)):
    """Start calibration session"""
    from app.services import CalibrationService
    service = CalibrationService()
    calibration = service.start_calibration(db, session_id, patient_id, 
                                           calibration_points, model_type)
    return calibration


@app.post("/api/calibrations/{calibration_id}/sample")
def add_calibration_sample(calibration_id: int, sample: CalibrationSampleSchema, 
                          db = Depends(get_db)):
    """Add calibration sample"""
    from app.services import CalibrationService
    service = CalibrationService()
    calibration = service.add_calibration_sample(
        db, calibration_id,
        sample.iris_left_x, sample.iris_left_y,
        sample.iris_right_x, sample.iris_right_y,
        sample.head_yaw, sample.head_pitch, sample.head_roll,
        sample.eye_aspect_ratio, sample.screen_x, sample.screen_y
    )
    if not calibration:
        raise HTTPException(status_code=404, detail="Calibration not found")
    return calibration


@app.post("/api/calibrations/{calibration_id}/complete")
def complete_calibration(calibration_id: int, db = Depends(get_db)):
    """Complete calibration and train model"""
    from app.services import CalibrationService
    service = CalibrationService()
    success = service.complete_calibration(db, calibration_id)
    if not success:
        raise HTTPException(status_code=400, detail="Calibration completion failed")
    
    from app.repositories import CalibrationRepository
    calibration = CalibrationRepository.get_by_id(db, calibration_id)
    return calibration


# ============================================================================
# Communication & Logging Routes
# ============================================================================

@app.post("/api/communications")
def log_communication(session_id: int, patient_id: int, 
                     comm_data: CommunicationCreateSchema, db = Depends(get_db)):
    """Log communication"""
    from app.services import CommunicationService
    communication = CommunicationService.log_communication(db, session_id, patient_id, comm_data)
    return communication


@app.post("/api/symptoms")
def report_symptom(session_id: int, patient_id: int,
                  symptom_data: SymptomReportCreateSchema, db = Depends(get_db)):
    """Report symptom"""
    from app.services import CommunicationService
    symptom = CommunicationService.log_symptom(db, session_id, patient_id, symptom_data)
    return symptom


@app.get("/api/timeline/{patient_id}")
def get_timeline(patient_id: int, hours: int = 24, db = Depends(get_db)):
    """Get patient communication timeline"""
    from app.services import CommunicationService
    timeline = CommunicationService.get_patient_timeline(db, patient_id, hours)
    return timeline


# ============================================================================
# Alert Routes
# ============================================================================

@app.get("/api/alerts/{session_id}")
def get_session_alerts(session_id: int, db = Depends(get_db)):
    """Get alerts for session"""
    from app.repositories import AlertRepository
    alerts = AlertRepository.get_session_alerts(db, session_id)
    return alerts


@app.get("/api/alerts/patient/{patient_id}/critical")
def get_critical_alerts(patient_id: int, hours: int = 24, db = Depends(get_db)):
    """Get critical alerts for patient"""
    from app.repositories import AlertRepository
    alerts = AlertRepository.get_recent_critical_alerts(db, patient_id, hours)
    return alerts


@app.post("/api/alerts/{alert_id}/acknowledge")
def acknowledge_alert(alert_id: int, response: str = None, db = Depends(get_db)):
    """Acknowledge alert"""
    from app.repositories import AlertRepository
    alert = AlertRepository.acknowledge(db, alert_id, response)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    return alert


# ============================================================================
# Analytics Routes
# ============================================================================

@app.get("/api/analytics/{patient_id}/dashboard")
def get_dashboard(patient_id: int, db = Depends(get_db)):
    """Get patient dashboard"""
    from app.services import AnalyticsService
    dashboard = AnalyticsService.get_patient_dashboard(db, patient_id)
    if not dashboard:
        raise HTTPException(status_code=404, detail="Patient not found")
    return dashboard


@app.get("/api/analytics/{patient_id}/history")
def get_analytics_history(patient_id: int, days: int = 30, db = Depends(get_db)):
    """Get historical analytics"""
    from app.services import AnalyticsService
    analytics = AnalyticsService.get_historical_analytics(db, patient_id, days)
    return analytics


# ============================================================================
# Error Handling
# ============================================================================

@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    """Handle HTTP exceptions"""
    return {
        "detail": exc.detail,
        "status_code": exc.status_code
    }


@app.exception_handler(Exception)
async def general_exception_handler(request, exc):
    """Handle general exceptions"""
    logger.exception("Unhandled exception")
    return {
        "detail": "Internal server error",
        "error_code": "INTERNAL_ERROR"
    }


# Imports at top
from datetime import datetime
from app.database.schema import (
    PatientCreateSchema, PatientSettingsSchema, SessionCreateSchema,
    CalibrationSampleSchema, CommunicationCreateSchema, SymptomReportCreateSchema
)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.reload
    )
