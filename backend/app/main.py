"""
FastAPI Application Entry Point for Intelligent Traffic Decision Support System (IT-DSS).
Features automatic SQLite database schema creation, startup telemetry seeding,
and full CORS configuration for the React frontend command center.
"""

import sys
from pathlib import Path

# Ensure project root and backend dir are in Python path regardless of execution directory
_ROOT_DIR = Path(__file__).resolve().parent.parent.parent
_BACKEND_DIR = Path(__file__).resolve().parent.parent
for _p in (str(_ROOT_DIR), str(_BACKEND_DIR)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session

from backend.app.api.routes import router as api_router
from backend.app.database import create_db_and_tables, engine, get_session
from backend.app.services.synthetic_seeder import seed_corridors_and_telemetry


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create tables and seed synthetic Egyptian corridor data
    create_db_and_tables()
    with Session(engine) as session:
        seed_corridors_and_telemetry(session)
    yield
    # Shutdown logic (if any)


app = FastAPI(
    title="Intelligent Traffic Decision Support System (IT-DSS) API",
    description=(
        "Production-grade Decision Support API powered by 10 deterministic traffic operations engines: "
        "Work-Zone HCM, Webster/HCM Intersections, LWR Shockwave, Dynamic Reversible Lanes, "
        "AASHTO Fog SSD, ALINEA Ramp Metering, BPR Diversion Balancing, M/M/c Checkpoint Funneling, "
        "Bridge Defect ROI Prioritization, and Mega-Event Surge Dispersal."
    ),
    version="2.0.0",
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
        "http://localhost:8765",
        "http://127.0.0.1:8765",
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
