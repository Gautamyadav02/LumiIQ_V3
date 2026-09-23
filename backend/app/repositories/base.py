"""
LumiIQ v3 - Repository Pattern Implementation
Data access layer for database operations
"""
from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, desc
from datetime import datetime, timedelta

from app.database.models import (
    Patient, PatientSettings, Session as DBSession, Calibration,
    Communication, SymptomReport, Alert, Analytics
)
from app.database.schema import (
    PatientCreateSchema, PatientSettingsSchema, SessionCreateSchema,
    CalibrationSampleSchema, CommunicationCreateSchema,
    SymptomReportCreateSchema
)


class PatientRepository:
    """Patient data access"""
    
    @staticmethod
    def create(db: Session, patient: PatientCreateSchema) -> Patient:
        """Create new patient"""
        db_patient = Patient(**patient.dict())
        db.add(db_patient)
        db.commit()
        db.refresh(db_patient)
        return db_patient
    
    @staticmethod
    def get_by_id(db: Session, patient_id: int) -> Optional[Patient]:
        """Get patient by ID"""
        return db.query(Patient).filter(Patient.id == patient_id).first()
    
    @staticmethod
    def get_all(db: Session, skip: int = 0, limit: int = 100) -> List[Patient]:
        """Get all patients with pagination"""
        return db.query(Patient).offset(skip).limit(limit).all()
    
    @staticmethod
    def update(db: Session, patient_id: int, update_data: dict) -> Optional[Patient]:
        """Update patient"""
        db_patient = PatientRepository.get_by_id(db, patient_id)
        if not db_patient:
            return None
        for key, value in update_data.items():
            setattr(db_patient, key, value)
        db.commit()
        db.refresh(db_patient)
        return db_patient
    
    @staticmethod
    def delete(db: Session, patient_id: int) -> bool:
        """Delete patient"""
        db_patient = PatientRepository.get_by_id(db, patient_id)
        if not db_patient:
            return False
        db.delete(db_patient)
        db.commit()
        return True


class PatientSettingsRepository:
    """Patient settings data access"""
    
    @staticmethod
    def get_or_create(db: Session, patient_id: int) -> PatientSettings:
        """Get or create settings for patient"""
        settings = db.query(PatientSettings).filter(
            PatientSettings.patient_id == patient_id
        ).first()
        
        if not settings:
            settings = PatientSettings(patient_id=patient_id)
            db.add(settings)
            db.commit()
            db.refresh(settings)
        
        return settings
    
    @staticmethod
    def update(db: Session, patient_id: int, update_data: PatientSettingsSchema) -> Optional[PatientSettings]:
        """Update patient settings"""
        settings = PatientSettingsRepository.get_or_create(db, patient_id)
        for key, value in update_data.dict(exclude_unset=True).items():
            setattr(settings, key, value)
        db.commit()
        db.refresh(settings)
        return settings


class SessionRepository:
    """Session (tracking session) data access"""
    
    @staticmethod
    def create(db: Session, patient_id: int, session_data: SessionCreateSchema) -> DBSession:
        """Create new tracking session"""
        db_session = DBSession(
            patient_id=patient_id,
            **session_data.dict()
        )
        db.add(db_session)
        db.commit()
        db.refresh(db_session)
        return db_session
    
    @staticmethod
    def get_by_id(db: Session, session_id: int) -> Optional[DBSession]:
        """Get session by ID"""
        return db.query(DBSession).filter(DBSession.id == session_id).first()
    
    @staticmethod
    def get_active_session(db: Session, patient_id: int) -> Optional[DBSession]:
        """Get active session for patient"""
        return db.query(DBSession).filter(
            and_(
                DBSession.patient_id == patient_id,
                DBSession.status == "active"
            )
        ).order_by(desc(DBSession.start_time)).first()
    
    @staticmethod
    def get_patient_sessions(db: Session, patient_id: int, limit: int = 50) -> List[DBSession]:
        """Get recent sessions for patient"""
        return db.query(DBSession).filter(
            DBSession.patient_id == patient_id
        ).order_by(desc(DBSession.start_time)).limit(limit).all()
    
    @staticmethod
    def update_status(db: Session, session_id: int, status: str) -> Optional[DBSession]:
        """Update session status"""
        db_session = SessionRepository.get_by_id(db, session_id)
        if not db_session:
            return None
        db_session.status = status
        if status == "completed":
            db_session.end_time = datetime.utcnow()
            if db_session.start_time:
                db_session.duration_seconds = int(
                    (db_session.end_time - db_session.start_time).total_seconds()
                )
        db.commit()
        db.refresh(db_session)
        return db_session
    
    @staticmethod
    def update_metrics(db: Session, session_id: int, frames: int, confidence: float, blinks: int) -> Optional[DBSession]:
        """Update session metrics"""
        db_session = SessionRepository.get_by_id(db, session_id)
        if not db_session:
            return None
        db_session.frames_processed = frames
        db_session.tracking_confidence_avg = confidence
        db_session.blink_count = blinks
        db.commit()
        db.refresh(db_session)
        return db_session


class CalibrationRepository:
    """Calibration data access"""
    
    @staticmethod
    def create(db: Session, session_id: int, patient_id: int, 
               calibration_points: int, model_type: str) -> Calibration:
        """Create new calibration"""
        calibration = Calibration(
            session_id=session_id,
            patient_id=patient_id,
            calibration_points=calibration_points,
            model_type=model_type,
            status="in_progress"
        )
        db.add(calibration)
        db.commit()
        db.refresh(calibration)
        return calibration
    
    @staticmethod
    def get_by_id(db: Session, calibration_id: int) -> Optional[Calibration]:
        """Get calibration by ID"""
        return db.query(Calibration).filter(Calibration.id == calibration_id).first()
    
    @staticmethod
    def get_latest_for_patient(db: Session, patient_id: int) -> Optional[Calibration]:
        """Get latest completed calibration for patient"""
        return db.query(Calibration).filter(
            and_(
                Calibration.patient_id == patient_id,
                Calibration.status == "completed"
            )
        ).order_by(desc(Calibration.completed_at)).first()
    
    @staticmethod
    def update(db: Session, calibration_id: int, update_data: dict) -> Optional[Calibration]:
        """Update calibration"""
        calibration = CalibrationRepository.get_by_id(db, calibration_id)
        if not calibration:
            return None
        for key, value in update_data.items():
            setattr(calibration, key, value)
        if update_data.get('status') == 'completed':
            calibration.completed_at = datetime.utcnow()
        db.commit()
        db.refresh(calibration)
        return calibration


class CommunicationRepository:
    """Communication logs data access"""
    
    @staticmethod
    def create(db: Session, session_id: int, patient_id: int,
               comm_data: CommunicationCreateSchema) -> Communication:
        """Log communication"""
        communication = Communication(
            session_id=session_id,
            patient_id=patient_id,
            **comm_data.dict()
        )
        db.add(communication)
        db.commit()
        db.refresh(communication)
        return communication
    
    @staticmethod
    def get_session_logs(db: Session, session_id: int) -> List[Communication]:
        """Get all communications for session"""
        return db.query(Communication).filter(
            Communication.session_id == session_id
        ).order_by(Communication.created_at).all()
    
    @staticmethod
    def get_recent_logs(db: Session, patient_id: int, hours: int = 24) -> List[Communication]:
        """Get recent communications for patient"""
        since = datetime.utcnow() - timedelta(hours=hours)
        return db.query(Communication).filter(
            and_(
                Communication.patient_id == patient_id,
                Communication.created_at >= since
            )
        ).order_by(desc(Communication.created_at)).limit(200).all()


class SymptomRepository:
    """Symptom reports data access"""
    
    @staticmethod
    def create(db: Session, session_id: int, patient_id: int,
               symptom_data: SymptomReportCreateSchema) -> SymptomReport:
        """Log symptom report"""
        symptom = SymptomReport(
            session_id=session_id,
            patient_id=patient_id,
            **symptom_data.dict()
        )
        db.add(symptom)
        db.commit()
        db.refresh(symptom)
        return symptom
    
    @staticmethod
    def get_session_symptoms(db: Session, session_id: int) -> List[SymptomReport]:
        """Get symptoms reported in session"""
        return db.query(SymptomReport).filter(
            SymptomReport.session_id == session_id
        ).order_by(SymptomReport.created_at).all()
    
    @staticmethod
    def get_recent_symptoms(db: Session, patient_id: int, days: int = 7) -> List[SymptomReport]:
        """Get recent symptom reports"""
        since = datetime.utcnow() - timedelta(days=days)
        return db.query(SymptomReport).filter(
            and_(
                SymptomReport.patient_id == patient_id,
                SymptomReport.created_at >= since
            )
        ).order_by(desc(SymptomReport.created_at)).limit(200).all()


class AlertRepository:
    """Alert/anomaly data access"""
    
    @staticmethod
    def create(db: Session, session_id: int, patient_id: int, alert_type: str,
               alert_level: str, message: str, details: dict = None) -> Alert:
        """Log alert"""
        alert = Alert(
            session_id=session_id,
            patient_id=patient_id,
            alert_type=alert_type,
            alert_level=alert_level,
            message=message,
            details=details
        )
        db.add(alert)
        db.commit()
        db.refresh(alert)
        return alert
    
    @staticmethod
    def get_session_alerts(db: Session, session_id: int) -> List[Alert]:
        """Get alerts for session"""
        return db.query(Alert).filter(
            Alert.session_id == session_id
        ).order_by(desc(Alert.created_at)).all()
    
    @staticmethod
    def get_recent_critical_alerts(db: Session, patient_id: int, hours: int = 24) -> List[Alert]:
        """Get recent critical alerts"""
        since = datetime.utcnow() - timedelta(hours=hours)
        return db.query(Alert).filter(
            and_(
                Alert.patient_id == patient_id,
                Alert.alert_level == "critical",
                Alert.created_at >= since
            )
        ).order_by(desc(Alert.created_at)).all()
    
    @staticmethod
    def acknowledge(db: Session, alert_id: int, response: str = None) -> Optional[Alert]:
        """Acknowledge alert"""
        alert = db.query(Alert).filter(Alert.id == alert_id).first()
        if not alert:
            return None
        alert.acknowledged = True
        alert.acknowledged_at = datetime.utcnow()
        alert.response = response
        db.commit()
        db.refresh(alert)
        return alert


class AnalyticsRepository:
    """Analytics data access"""
    
    @staticmethod
    def create_or_update_daily(db: Session, patient_id: int, date: datetime = None) -> Analytics:
        """Create or update daily analytics"""
        if date is None:
            date = datetime.utcnow()
        
        # Round to start of day
        date = date.replace(hour=0, minute=0, second=0, microsecond=0)
        
        analytics = db.query(Analytics).filter(
            and_(
                Analytics.patient_id == patient_id,
                Analytics.date == date
            )
        ).first()
        
        if not analytics:
            analytics = Analytics(patient_id=patient_id, date=date)
            db.add(analytics)
        
        # Aggregate from sessions
        sessions = db.query(DBSession).filter(
            and_(
                DBSession.patient_id == patient_id,
                DBSession.created_at >= date,
                DBSession.created_at < date + timedelta(days=1)
            )
        ).all()
        
        analytics.total_sessions = len(sessions)
        analytics.total_tracking_minutes = sum(
            (s.duration_seconds or 0) // 60 for s in sessions
        )
        
        if sessions:
            confidences = [s.tracking_confidence_avg for s in sessions if s.tracking_confidence_avg]
            analytics.avg_tracking_confidence = (
                sum(confidences) / len(confidences) if confidences else None
            )
        
        # Count communications, symptoms, alerts
        analytics.total_communications = db.query(Communication).filter(
            and_(
                Communication.patient_id == patient_id,
                Communication.created_at >= date,
                Communication.created_at < date + timedelta(days=1)
            )
        ).count()
        
        analytics.total_symptom_reports = db.query(SymptomReport).filter(
            and_(
                SymptomReport.patient_id == patient_id,
                SymptomReport.created_at >= date,
                SymptomReport.created_at < date + timedelta(days=1)
            )
        ).count()
        
        alerts = db.query(Alert).filter(
            and_(
                Alert.patient_id == patient_id,
                Alert.created_at >= date,
                Alert.created_at < date + timedelta(days=1)
            )
        ).all()
        
        analytics.total_alerts = len(alerts)
        analytics.critical_alerts_count = sum(1 for a in alerts if a.alert_level == "critical")
        
        db.commit()
        db.refresh(analytics)
        return analytics
    
    @staticmethod
    def get_daily_analytics(db: Session, patient_id: int, days: int = 30) -> List[Analytics]:
        """Get analytics for past N days"""
        since = datetime.utcnow() - timedelta(days=days)
        return db.query(Analytics).filter(
            and_(
                Analytics.patient_id == patient_id,
                Analytics.date >= since
            )
        ).order_by(desc(Analytics.date)).all()
