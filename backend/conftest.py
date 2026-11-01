import sys
from pathlib import Path

# Ensure .venv site-packages is prepended so all dependencies are found
backend_dir = Path(__file__).resolve().parent
project_root = backend_dir.parent
venv_site_packages = project_root / ".venv" / "Lib" / "site-packages"

if venv_site_packages.exists() and str(venv_site_packages) not in sys.path:
    sys.path.insert(0, str(venv_site_packages))

if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))
