#!/usr/bin/env python3
"""
LumiIQ v3 Backend Server
Entry point for running the FastAPI application
"""
import sys
import os
import argparse
import logging
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent))

import uvicorn
from app.config import settings
from app.database import init_db

# Configure logging
logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(description="LumiIQ v3 Backend Server")
    parser.add_argument("--port", type=int, default=8000, help="Server port (default: 8000)")
    parser.add_argument("--host", default="0.0.0.0", help="Server host (default: 0.0.0.0)")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload on file changes")
    parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    
    args = parser.parse_args()
    
    # Update settings
    settings.port = args.port
    settings.host = args.host
    settings.reload = args.reload
    settings.debug = args.debug
    
    logger.info(f"Starting {settings.app_name} v{settings.app_version}")
    logger.info(f"Server: {settings.host}:{settings.port}")
    
    # Initialize database
    try:
        init_db()
        logger.info("Database initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
        sys.exit(1)
    
    # Start server
    try:
        uvicorn.run(
            "app.main:app",
            host=settings.host,
            port=settings.port,
            reload=settings.reload,
            log_level=settings.log_level.lower()
        )
    except Exception as e:
        logger.error(f"Server failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
