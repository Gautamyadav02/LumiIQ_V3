#!/usr/bin/env python3
"""
LumiIQ v3 - System Validation Script
Verifies all components are properly installed and configured
"""
import sys
import os
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent / "backend"))

def check_python_version():
    """Check Python version"""
    print("\n🐍 Python Version Check")
    print(f"   Current: {sys.version}")
    
    if sys.version_info < (3, 10):
        print("   ❌ Python 3.10+ required")
        return False
    
    print("   ✅ Python 3.10+")
    return True


def check_dependencies():
    """Check all dependencies"""
    print("\n📦 Dependency Check")
    
    required = {
        'fastapi': 'FastAPI',
        'uvicorn': 'Uvicorn',
        'sqlalchemy': 'SQLAlchemy',
        'pydantic': 'Pydantic',
        'pydantic_settings': 'Pydantic Settings',
        'cv2': 'OpenCV',
        'mediapipe': 'MediaPipe',
        'numpy': 'NumPy',
        'scipy': 'SciPy',
        'sklearn': 'scikit-learn',
    }
    
    missing = []
    for module, name in required.items():
        try:
            __import__(module)
            print(f"   ✅ {name}")
        except ImportError:
            print(f"   ❌ {name}")
            missing.append(module)
    
    if missing:
        print(f"\n   Install missing packages:")
        print(f"   pip install -r backend/requirements.txt")
        return False
    
    return True


def check_files():
    """Check critical files exist"""
    print("\n📁 File Structure Check")
    
    critical_files = {
        'backend/app/main.py': 'FastAPI app',
        'backend/app/config.py': 'Configuration',
        'backend/app/database/models.py': 'Database models',
        'backend/app/database/schema.py': 'Schemas',
        'backend/app/vision/gaze_engine.py': 'Gaze engine',
        'backend/app/vision/stabilization.py': 'Stabilization filters',
        'backend/app/repositories/base.py': 'Repositories',
        'backend/app/services/__init__.py': 'Services',
        'backend/requirements.txt': 'Requirements',
        'backend/server.py': 'Server entry point',
        'frontend/index.html': 'Frontend UI',
        'frontend/styles.css': 'Styles',
        'frontend/app.js': 'App controller',
    }
    
    missing = []
    for filepath, description in critical_files.items():
        if Path(filepath).exists():
            print(f"   ✅ {description}")
        else:
            print(f"   ❌ {description} - {filepath}")
            missing.append(filepath)
    
    return len(missing) == 0


def check_database():
    """Check database setup"""
    print("\n🗄️  Database Check")
    
    try:
        from app.database import init_db, SessionLocal
        from app.database.models import Base
        
        # Try to initialize
        try:
            init_db()
            print("   ✅ Database initialized")
        except Exception as e:
            print(f"   ⚠️  Database status: {e}")
        
        # Try to get session
        try:
            db = SessionLocal()
            db.close()
            print("   ✅ Database connection works")
            return True
        except Exception as e:
            print(f"   ❌ Database connection failed: {e}")
            return False
            
    except Exception as e:
        print(f"   ❌ Database setup error: {e}")
        return False


def check_gaze_engine():
    """Check gaze engine"""
    print("\n👁️  Gaze Engine Check")
    
    try:
        from app.vision import GazeEngine, GazeStabilizer
        
        print("   ✅ Gaze engine imported")
        
        # Try to initialize
        try:
            engine = GazeEngine()
            print("   ✅ GazeEngine instantiated")
        except Exception as e:
            print(f"   ⚠️  GazeEngine initialization: {e}")
            return False
        
        try:
            stabilizer = GazeStabilizer()
            print("   ✅ GazeStabilizer instantiated")
        except Exception as e:
            print(f"   ❌ GazeStabilizer error: {e}")
            return False
        
        return True
        
    except Exception as e:
        print(f"   ❌ Vision module error: {e}")
        return False


def check_api():
    """Check API structure"""
    print("\n🌐 API Structure Check")
    
    try:
        from app.main import app
        
        # Get all routes
        routes = []
        for route in app.routes:
            if hasattr(route, 'path'):
                routes.append(route.path)
        
        api_routes = [r for r in routes if r.startswith('/api')]
        
        print(f"   ✅ API app created")
        print(f"   ✅ {len(api_routes)} API endpoints registered")
        
        # Check specific endpoints
        endpoints = [
            '/api/health',
            '/api/patients',
            '/api/sessions',
            '/api/calibrations',
            '/api/communications',
            '/api/symptoms',
        ]
        
        for endpoint in endpoints:
            if any(endpoint in route for route in api_routes):
                print(f"      ✅ {endpoint}")
            else:
                print(f"      ❌ {endpoint}")
        
        return True
        
    except Exception as e:
        print(f"   ❌ API check error: {e}")
        return False


def check_frontend():
    """Check frontend files"""
    print("\n🎨 Frontend Check")
    
    frontend_files = {
        'frontend/index.html': 'HTML markup',
        'frontend/styles.css': 'Styling',
        'frontend/app.js': 'Application logic',
    }
    
    all_good = True
    for filepath, description in frontend_files.items():
        if Path(filepath).exists():
            size = Path(filepath).stat().st_size
            if size > 100:  # Should have meaningful content
                print(f"   ✅ {description} ({size} bytes)")
            else:
                print(f"   ⚠️  {description} seems empty")
                all_good = False
        else:
            print(f"   ❌ {description} missing")
            all_good = False
    
    return all_good


def main():
    """Run all checks"""
    print("\n" + "="*50)
    print("LumiIQ v3 - System Validation")
    print("="*50)
    
    checks = [
        ("Python Version", check_python_version),
        ("Dependencies", check_dependencies),
        ("File Structure", check_files),
        ("Database", check_database),
        ("Gaze Engine", check_gaze_engine),
        ("API", check_api),
        ("Frontend", check_frontend),
    ]
    
    results = {}
    for name, check_fn in checks:
        try:
            results[name] = check_fn()
        except Exception as e:
            print(f"\n❌ {name} check failed: {e}")
            results[name] = False
    
    # Summary
    print("\n" + "="*50)
    print("Summary")
    print("="*50)
    
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    
    for name, result in results.items():
        status = "✅" if result else "❌"
        print(f"{status} {name}")
    
    print(f"\n{passed}/{total} checks passed")
    
    if passed == total:
        print("\n🎉 System is ready!")
        print("\nStart server with:")
        print("  cd backend")
        print("  python3 server.py")
        print("\nAccess at: http://localhost:8000")
        return 0
    else:
        print("\n⚠️  Some checks failed. Please review errors above.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
