from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.orm import Session

from app.models import ExtensionTrigger
from app.rfqs import get_rfq_status
from app.schemas import RFQStatus
from scripts.seed_demo import seed_demo_auctions


@pytest.mark.parametrize("quick", [False, True])
def test_seed_reuses_accounts_and_creates_fresh_active_auctions(connection, quick):
    now = datetime.now(timezone.utc)
    with Session(connection) as session:
        users, auctions = seed_demo_auctions(session, now, quick=quick)
        next_run = now + timedelta(days=1)
        same_users, new_auctions = seed_demo_auctions(session, next_run, quick=quick)

        assert [user.id for user in users] == [user.id for user in same_users]
        assert [user.role for user in users] == ["buyer", "buyer", "supplier", "supplier", "supplier"]
        assert len({rfq.reference_id for rfq in auctions + new_auctions}) == 6
        assert {rfq.auction_configuration.extension_trigger for rfq in auctions} == set(ExtensionTrigger)

        for rfq in auctions:
            assert get_rfq_status(rfq, now) == RFQStatus.ACTIVE
            assert get_rfq_status(rfq, next_run) == RFQStatus.CLOSED
            assert rfq.current_close_at == rfq.original_close_at
            assert rfq.forced_close_at == now + timedelta(minutes=3 if quick else 23)

        assert all(get_rfq_status(rfq, next_run) == RFQStatus.ACTIVE for rfq in new_auctions)
