"""Create a fresh set of local demo auctions with reusable demo accounts."""

import argparse
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.db import engine
from app.models import RFQ, AuctionConfiguration, ExtensionTrigger, User


DEMO_ACCOUNTS = (
    {"name": "Demo Harbor Retail", "email": "harbor-retail@bidverse.example", "role": "buyer"},
    {"name": "Demo Summit Foods", "email": "summit-foods@bidverse.example", "role": "buyer"},
    {"name": "Demo Atlas Freight", "email": "atlas-freight@bidverse.example", "role": "supplier"},
    {"name": "Demo Beacon Logistics", "email": "beacon-logistics@bidverse.example", "role": "supplier"},
    {"name": "Demo Cedar Transport", "email": "cedar-transport@bidverse.example", "role": "supplier"},
)

DEMO_AUCTIONS = (
    ("Any bid", ExtensionTrigger.BID_RECEIVED, 10, 5),
    ("Any rank change", ExtensionTrigger.SUPPLIER_RANK_CHANGED, 12, 4),
    ("L1 change", ExtensionTrigger.LOWEST_BIDDER_CHANGED, 14, 3),
)


def seed_demo_accounts(session: Session) -> list[User]:
    statement = insert(User).values(list(DEMO_ACCOUNTS)).on_conflict_do_nothing(index_elements=[User.email])
    session.execute(statement)

    emails = [account["email"] for account in DEMO_ACCOUNTS]
    users_by_email = {user.email: user for user in session.scalars(select(User).where(User.email.in_(emails)))}
    users = []
    for account in DEMO_ACCOUNTS:
        user = users_by_email[account["email"]]
        if user.role != account["role"]:
            raise ValueError(f"Demo account {user.email} already exists with role {user.role!r}")
        users.append(user)
    return users


def seed_demo_auctions(session: Session, now: datetime, *, quick: bool = False) -> tuple[list[User], list[RFQ]]:
    users = seed_demo_accounts(session)
    buyers = [user for user in users if user.role == "buyer"]
    batch = f"{now:%Y%m%d-%H%M%S}-{uuid4().hex}"
    rfqs = []

    for position, (label, trigger, initial_minutes, extension_minutes) in enumerate(DEMO_AUCTIONS, start=1):
        initial_close = now + timedelta(minutes=1 if quick else initial_minutes)
        rfq = RFQ(
            buyer=buyers[(position - 1) % len(buyers)],
            reference_id=f"DEMO-{batch}-{position}",
            name=f"Demo freight / {label}",
            currency="USD",
            service_date=now.date() + timedelta(days=7),
            bid_start_at=now - timedelta(minutes=1),
            original_close_at=initial_close,
            current_close_at=initial_close,
            forced_close_at=now + timedelta(minutes=3 if quick else 23),
            auction_configuration=AuctionConfiguration(
                extension_trigger=trigger,
                trigger_window_minutes=3 if quick else 25,
                extension_minutes=1 if quick else extension_minutes,
            ),
        )
        rfqs.append(rfq)

    session.add_all(rfqs)
    session.flush()
    return users, rfqs


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--quick", action="store_true", help="Use an initial close in 1 minute and forced close in 3")
    args = parser.parse_args()

    with Session(engine, expire_on_commit=False) as session, session.begin():
        users, rfqs = seed_demo_auctions(session, datetime.now(timezone.utc), quick=args.quick)

    print("Demo accounts")
    for user in users:
        print(f"  {user.role.title()} #{user.id}: {user.name} ({user.email})")

    print("\nActive demo auctions (UTC)")
    for rfq in rfqs:
        print(f"  {rfq.reference_id} | {rfq.name} | http://localhost:5173/auctions/{rfq.id}")
        print(f"    Initial close {rfq.original_close_at:%Y-%m-%d %H:%M:%S}")
        print(f"    Forced close  {rfq.forced_close_at:%Y-%m-%d %H:%M:%S}")


if __name__ == "__main__":
    main()
