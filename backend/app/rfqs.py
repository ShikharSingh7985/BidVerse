from collections.abc import Sequence
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, status
from psycopg.errors import UniqueViolation
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.bid_queries import lowest_bids_by_rfq
from app.db import get_session
from app.models import RFQ, AuctionActivity, AuctionConfiguration, User
from app.schemas import (
    MAX_POSTGRES_INTEGER,
    AuctionActivityRead,
    AuctionConfigurationSchema,
    RFQCreate,
    RFQListRead,
    RFQRead,
    RFQStatus,
)

router = APIRouter(prefix="/rfqs", tags=["RFQs"])
DatabaseSession = Annotated[Session, Depends(get_session)]
RFQId = Annotated[int, Path(gt=0, le=MAX_POSTGRES_INTEGER)]


def get_server_time() -> datetime:
    return datetime.now(timezone.utc)


ServerTime = Annotated[datetime, Depends(get_server_time)]


def require_rfq(
    session: Session, rfq_id: int, *, lock: bool = False, with_configuration: bool = False
) -> RFQ:
    statement = select(RFQ).where(RFQ.id == rfq_id)
    if lock:
        statement = statement.with_for_update(of=RFQ)
    if with_configuration:
        statement = statement.options(joinedload(RFQ.auction_configuration))
    rfq = session.scalar(statement)
    if rfq is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RFQ not found")
    return rfq


def get_rfq_status(rfq: RFQ, now: datetime) -> RFQStatus:
    if now < rfq.bid_start_at:
        return RFQStatus.UPCOMING
    if now < rfq.current_close_at:
        return RFQStatus.ACTIVE
    if rfq.current_close_at == rfq.forced_close_at:
        return RFQStatus.FORCE_CLOSED
    return RFQStatus.CLOSED


def _rfq_response(rfq: RFQ, now: datetime) -> RFQRead:
    configuration = rfq.auction_configuration
    return RFQRead(
        id=rfq.id,
        buyer_id=rfq.buyer_id,
        reference_id=rfq.reference_id,
        name=rfq.name,
        currency=rfq.currency,
        service_date=rfq.service_date,
        bid_start_at=rfq.bid_start_at,
        original_close_at=rfq.original_close_at,
        current_close_at=rfq.current_close_at,
        forced_close_at=rfq.forced_close_at,
        created_at=rfq.created_at,
        auction_configuration=(
            AuctionConfigurationSchema.model_validate(configuration) if configuration is not None else None
        ),
        status=get_rfq_status(rfq, now),
    )


@router.post("", status_code=status.HTTP_201_CREATED)
def create_rfq(payload: RFQCreate, session: DatabaseSession, now: ServerTime) -> RFQRead:
    rfq = RFQ(
        **payload.model_dump(exclude={"auction_configuration"}),
        current_close_at=payload.original_close_at,
    )
    if payload.auction_configuration is not None:
        rfq.auction_configuration = AuctionConfiguration(**payload.auction_configuration.model_dump())

    try:
        with session.begin():
            buyer = session.get(User, payload.buyer_id, with_for_update={"read": True})
            if buyer is None or buyer.role != "buyer":
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="buyer_id must identify an existing buyer",
                )
            session.add(rfq)
    except IntegrityError as exc:
        if isinstance(exc.orig, UniqueViolation) and exc.orig.diag.constraint_name == "uq_rfqs_reference_id":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An RFQ already uses this reference_id",
            ) from exc
        raise

    return _rfq_response(rfq, now)


@router.get("")
def list_rfqs(session: DatabaseSession, now: ServerTime, auction_only: bool = False) -> list[RFQListRead]:
    lowest_bids = lowest_bids_by_rfq(now)
    statement = (
        select(RFQ, lowest_bids.c.lowest_bid)
        .outerjoin(lowest_bids, lowest_bids.c.rfq_id == RFQ.id)
        .options(joinedload(RFQ.auction_configuration))
        .order_by(RFQ.created_at.desc(), RFQ.id.desc())
    )
    if auction_only:
        statement = statement.where(RFQ.auction_configuration.has())
    return [
        RFQListRead(**_rfq_response(rfq, now).model_dump(), lowest_bid=lowest_bid)
        for rfq, lowest_bid in session.execute(statement)
    ]


@router.get("/{rfq_id}")
def get_rfq(rfq_id: RFQId, session: DatabaseSession, now: ServerTime) -> RFQRead:
    rfq = require_rfq(session, rfq_id, with_configuration=True)
    return _rfq_response(rfq, now)


@router.get("/{rfq_id}/activity", response_model=list[AuctionActivityRead])
def list_auction_activity(rfq_id: RFQId, session: DatabaseSession) -> Sequence[AuctionActivity]:
    require_rfq(session, rfq_id)
    statement = (
        select(AuctionActivity)
        .where(AuctionActivity.rfq_id == rfq_id)
        .order_by(AuctionActivity.occurred_at, AuctionActivity.id)
    )
    return session.scalars(statement).all()
