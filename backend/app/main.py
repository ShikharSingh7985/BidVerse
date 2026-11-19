from fastapi import FastAPI, HTTPException, status
from sqlalchemy import func, select, text
from sqlalchemy.exc import SQLAlchemyError

from app.auction_updates import router as auction_updates_router
from app.bids import router as bids_router
from app.db import engine
from app.models import User
from app.rfqs import DatabaseSession, router as rfqs_router
from app.schemas import UserOption

app = FastAPI(title="BidVerse API")
app.include_router(rfqs_router)
app.include_router(bids_router)
app.include_router(auction_updates_router)


def _user_options(session: DatabaseSession, role: str) -> list[UserOption]:
    statement = select(User.id, User.name).where(User.role == role).order_by(func.lower(User.name), User.id)
    return [UserOption(id=user_id, name=name) for user_id, name in session.execute(statement)]


@app.get("/buyers", tags=["RFQs"])
def list_buyers(session: DatabaseSession) -> list[UserOption]:
    return _user_options(session, "buyer")


@app.get("/suppliers", tags=["Bids"])
def list_suppliers(session: DatabaseSession) -> list[UserOption]:
    return _user_options(session, "supplier")


@app.get("/health/db")
def database_health() -> dict[str, str]:
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database unavailable",
        ) from exc

    return {"status": "ok"}
