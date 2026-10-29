"""
FastAPI Application Entry Point for Intelligent Traffic Decision Support System (IT-DSS).
Features automatic SQLite database schema creation, startup telemetry seeding,
and full CORS configuration for the React frontend command center.
"""

import sys
from pathlib import Path

# Ensure project root is always in Python path regardless of execution directory
_ROOT_DIR = Path(__file__).resolve().parent.parent.parent
if str(_ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(_ROOT_DIR))

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import SQLModel, create_engine, Session

from backend.app.api.routes import router as api_router
from backend.app.services.synthetic_seeder import seed_corridors_and_telemetry


DATABASE_URL = "sqlite:///traffic_dss.db"
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    echo=False,
)


def get_session():
    return Session(engine)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create tables and seed synthetic Egyptian corridor data
    SQLModel.metadata.create_all(engine)
    with get_session() as session:
        seed_corridors_and_telemetry(session)
    yield
    # Shutdown logic (if any)


app = FastAPI(
    title="Intelligent Traffic Decision Support System (IT-DSS) API",
    description=(
        "Production-grade Decision Support API powered by deterministic Highway Capacity Manual (HCM), "
        "Webster's Intersection Delay, LWR Shockwave, and Dynamic Reversible Lane physics."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5199",
        "http://127.0.0.1:5199",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://localhost:8080",
        "*",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount API routes
app.include_router(api_router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:app", host="0.0.0.0", port=8765, reload=True)
