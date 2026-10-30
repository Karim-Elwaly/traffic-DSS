"""
Database engine and session factory for IT-DSS.
A single absolute SQLite path is used regardless of the working directory.
"""

from pathlib import Path
from sqlmodel import SQLModel, create_engine, Session

_ROOT_DIR = Path(__file__).resolve().parent.parent.parent
DB_PATH = _ROOT_DIR / "traffic_dss.db"
DATABASE_URL = f"sqlite:///{DB_PATH.as_posix()}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    echo=False,
)


def get_session():
    """FastAPI dependency / context-manager factory for database sessions."""
    return Session(engine)


def create_db_and_tables() -> None:
    SQLModel.metadata.create_all(engine)
