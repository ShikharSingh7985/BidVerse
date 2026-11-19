from datetime import datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auction_updates import auction_updates
from app.bid_queries import PRICE_ORDER, ranked_bids
from app.models import RFQ, AuctionActivity, AuctionConfiguration, Bid, ExtensionTrigger, User
from app.rfqs import DatabaseSession, RFQId, get_rfq_status, get_server_time, require_rfq
from app.schemas import BidCreate, BidRanking, BidRead, RFQStatus

router = APIRouter(prefix="/rfqs/{rfq_id}", tags=["Bids"])


def _ranked_supplier_ids(session: Session, rfq_id: int, at: datetime) -> list[int]:
    return list(session.scalars(ranked_bids(rfq_id, at).with_only_columns(Bid.supplier_id)))


def _available_extension(
    rfq: RFQ, configuration: AuctionConfiguration, submitted_at: datetime
) -> timedelta | None:
    remaining_extension = rfq.forced_close_at - rfq.current_close_at
    trigger_window = timedelta(minutes=configuration.trigger_window_minutes)
    if remaining_extension <= timedelta(0) or rfq.current_close_at - submitted_at > trigger_window:
        return None
    return min(timedelta(minutes=configuration.extension_minutes), remaining_extension)


def _trigger_matches(
    session: Session, bid: Bid, trigger: ExtensionTrigger, previous_ranks: list[int]
) -> bool:
    if trigger == ExtensionTrigger.BID_RECEIVED:
        return True
    if not previous_ranks:
        return False

    session.flush()
    current_ranks = _ranked_supplier_ids(session, bid.rfq_id, bid.submitted_at)
    if trigger == ExtensionTrigger.LOWEST_BIDDER_CHANGED:
        return previous_ranks[0] != current_ranks[0]

    # Filling a new last place leaves all previously ranked suppliers in place.
    return previous_ranks != current_ranks[: len(previous_ranks)]


@router.post("/bids", status_code=status.HTTP_201_CREATED)
def submit_bid(
    rfq_id: RFQId, payload: BidCreate, session: DatabaseSession, background_tasks: BackgroundTasks
) -> BidRead:
    deadline_extended = False
    with session.begin():
        # Serialize submissions for this RFQ before checking the current deadline.
        rfq = require_rfq(session, rfq_id, lock=True)
        configuration = rfq.auction_configuration
        if configuration is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="This RFQ has no auction configuration"
            )

        supplier = session.get(User, payload.supplier_id, with_for_update={"read": True})
        if supplier is None or supplier.role != "supplier":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="supplier_id must identify an existing supplier",
            )

        submitted_at = get_server_time()
        if get_rfq_status(rfq, submitted_at) != RFQStatus.ACTIVE:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The auction is not active")
        if payload.valid_until <= submitted_at:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="valid_until must be after the server submission time",
            )

        extension = _available_extension(rfq, configuration, submitted_at)
        trigger = configuration.extension_trigger
        previous_ranks = []
        if extension is not None and trigger != ExtensionTrigger.BID_RECEIVED:
            previous_ranks = _ranked_supplier_ids(session, rfq_id, submitted_at)

        bid = Bid(**payload.model_dump(), rfq=rfq, submitted_at=submitted_at)
        session.add(
            AuctionActivity(rfq=rfq, bid=bid, event_type="bid_submitted", occurred_at=submitted_at)
        )

        if extension is not None and _trigger_matches(session, bid, trigger, previous_ranks):
            deadline_extended = True
            previous_close = rfq.current_close_at
            rfq.current_close_at += extension
            session.add(
                AuctionActivity(
                    rfq=rfq,
                    bid=bid,
                    event_type="time_extended",
                    extension_trigger=trigger,
                    previous_close_at=previous_close,
                    new_close_at=rfq.current_close_at,
                    occurred_at=submitted_at,
                )
            )

    background_tasks.add_task(auction_updates.publish, rfq_id, bid.id, deadline_extended)
    return BidRead.model_validate(bid)


@router.get("/bids")
def list_bid_history(rfq_id: RFQId, session: DatabaseSession) -> list[BidRead]:
    require_rfq(session, rfq_id)
    statement = select(Bid).where(Bid.rfq_id == rfq_id).order_by(*PRICE_ORDER)
    return [BidRead.model_validate(bid) for bid in session.scalars(statement)]


@router.get("/rankings")
def list_rankings(rfq_id: RFQId, session: DatabaseSession) -> list[BidRanking]:
    require_rfq(session, rfq_id)
    statement = ranked_bids(rfq_id, get_server_time()).with_only_columns(
        Bid.id.label("bid_id"), Bid.supplier_id, Bid.carrier_name, Bid.total_price, Bid.submitted_at
    )
    return [
        BidRanking(rank=f"L{position}", **bid)
        for position, bid in enumerate(session.execute(statement).mappings(), start=1)
    ]
