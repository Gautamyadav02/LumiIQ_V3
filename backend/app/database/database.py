"""
LumiIQ v3 - Database Connection & Session Management
"""
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, Session
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

# Database path
DB_PATH = Path(__file__).parent.parent.parent.parent / "lumiiq.db"
SQLALCHEMY_DATABASE_URL = f"sqlite:///{DB_PATH}"

# Create engine with connection pooling settings optimized for SQLite
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},  # SQLite-specific
    pool_pre_ping=True,  # Verify connections before using
    echo=False  # Set to True for SQL debugging
)

# Enable WAL mode for better concurrency
@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    """Enable WAL mode and other SQLite optimizations"""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA cache_size=10000")
    cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Session:
    """
    Dependency for getting DB session in FastAPI routes
    Usage: def my_route(db: Session = Depends(get_db)):
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Initialize database - create all tables"""
    from .models import Base
    Base.metadata.create_all(bind=engine)
    logger.info(f"Database initialized at {DB_PATH}")


def drop_db():
    """Drop all tables - use with caution"""
    from .models import Base
    Base.metadata.drop_all(bind=engine)
    logger.warning(f"Database dropped at {DB_PATH}")
