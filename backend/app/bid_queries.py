from datetime import datetime

from sqlalchemy import Select, func, select
from sqlalchemy.sql.selectable import Subquery

from app.models import Bid

PRICE_ORDER = (Bid.total_price, Bid.submitted_at, Bid.id)


def _latest_valid_bids(at: datetime, rfq_id: int | None = None) -> Subquery:
    statement = select(
        Bid.id,
        Bid.rfq_id,
        Bid.total_price,
        func.row_number()
        .over(
            partition_by=(Bid.rfq_id, Bid.supplier_id),
            order_by=(Bid.submitted_at.desc(), Bid.id.desc()),
        )
        .label("position"),
    ).where(Bid.submitted_at <= at, Bid.valid_until > at)
    if rfq_id is not None:
        statement = statement.where(Bid.rfq_id == rfq_id)
    return statement.subquery()


def ranked_bids(rfq_id: int, at: datetime) -> Select[tuple[Bid]]:
    latest = _latest_valid_bids(at, rfq_id)
    return (
        select(Bid)
        .join_from(Bid, latest, latest.c.id == Bid.id)
        .where(latest.c.position == 1)
        .order_by(*PRICE_ORDER)
    )


def lowest_bids_by_rfq(at: datetime) -> Subquery:
    latest = _latest_valid_bids(at)
    return (
        select(latest.c.rfq_id, func.min(latest.c.total_price).label("lowest_bid"))
        .where(latest.c.position == 1)
        .group_by(latest.c.rfq_id)
        .subquery()
    )
