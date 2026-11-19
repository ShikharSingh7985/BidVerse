from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Barrier, Event
from uuid import uuid4

import pytest
from fastapi import WebSocketDisconnect
from fastapi.testclient import TestClient
from sqlalchemy import event, select, update
from sqlalchemy.orm import Session
from sqlalchemy.schema import CreateSchema, DropSchema

from app import bids
from app.db import Base, engine, get_session
from app.main import app
from app.models import RFQ, AuctionActivity, AuctionConfiguration, ExtensionTrigger, User
from app.rfqs import get_server_time

NOW = datetime(2030, 7, 1, 12, tzinfo=timezone.utc)
START = NOW - timedelta(minutes=15)
CLOSE = NOW + timedelta(minutes=4)
FORCED_CLOSE = NOW + timedelta(minutes=30)
VALID_UNTIL = NOW + timedelta(days=1)
TRIGGER_WINDOW = timedelta(minutes=10)
EXTENSION = timedelta(minutes=5)


def create_auction(session):
    key = uuid4().hex
    buyer = User(name="Test buyer", email=f"buyer-{key}@example.test", role="buyer")
    suppliers = [
        User(name=f"Test supplier {index}", email=f"supplier-{index}-{key}@example.test", role="supplier")
        for index in range(3)
    ]
    rfq = RFQ(
        buyer=buyer,
        reference_id=f"bid-test-{key}",
        name="Freight auction",
        currency="USD",
        service_date=VALID_UNTIL.date(),
        bid_start_at=START,
        original_close_at=CLOSE,
        current_close_at=CLOSE,
        forced_close_at=FORCED_CLOSE,
        auction_configuration=AuctionConfiguration(
            trigger_window_minutes=10,
            extension_minutes=5,
            extension_trigger=ExtensionTrigger.BID_RECEIVED,
        ),
    )
    session.add_all([rfq, *suppliers])
    session.flush()
    return rfq.id, buyer.id, [supplier.id for supplier in suppliers]


def quote(supplier_id, freight="100.10", *, valid_until=VALID_UNTIL):
    return {
        "supplier_id": supplier_id,
        "carrier_name": "Example Carrier",
        "freight_charge": freight,
        "origin_charge": "2.10",
        "destination_charge": "3.20",
        "transit_time_days": 2,
        "valid_until": valid_until.isoformat(),
    }


def post_bid(client, rfq_id, payload):
    response = client.post(f"/rfqs/{rfq_id}/bids", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def current_close(client, rfq_id):
    detail = client.get(f"/rfqs/{rfq_id}").json()
    return datetime.fromisoformat(detail["current_close_at"])


def extension_events(connection, rfq_id):
    return connection.execute(
        select(
            AuctionActivity.bid_id,
            AuctionActivity.extension_trigger,
            AuctionActivity.previous_close_at,
            AuctionActivity.new_close_at,
        )
        .where(AuctionActivity.rfq_id == rfq_id, AuctionActivity.event_type == "time_extended")
        .order_by(AuctionActivity.id)
    ).all()


@pytest.fixture
def auction(connection):
    with Session(bind=connection, join_transaction_mode="create_savepoint") as session:
        auction = create_auction(session)
        session.commit()
    return auction


@pytest.fixture
def bid_clock(monkeypatch):
    def set_time(value):
        monkeypatch.setattr(bids, "get_server_time", lambda: value)

    set_time(NOW)
    return set_time


def test_rankings_use_latest_valid_bids_and_preserve_history(client, auction, bid_clock, connection):
    rfq_id, _, (supplier_a, supplier_b, supplier_c) = auction
    rankings_url = f"/rfqs/{rfq_id}/rankings"
    history_url = f"/rfqs/{rfq_id}/bids"
    assert client.get(rankings_url).json() == []
    assert client.get(history_url).json() == []

    early_bid_at = CLOSE - TRIGGER_WINDOW - timedelta(minutes=1)
    bid_clock(early_bid_at)
    first_a = post_bid(client, rfq_id, quote(supplier_a, "45.00"))
    bid_b = post_bid(client, rfq_id, quote(supplier_b, "70.00"))
    bid_c = post_bid(client, rfq_id, quote(supplier_c, "80.00"))
    expires = NOW + timedelta(seconds=30)
    bid_clock(early_bid_at + timedelta(seconds=1))
    latest_a = post_bid(client, rfq_id, quote(supplier_a, "70.00", valid_until=expires))

    ranking = client.get(rankings_url).json()
    assert [(entry["rank"], entry["bid_id"], entry["total_price"]) for entry in ranking] == [
        ("L1", bid_b["id"], "75.30"),
        ("L2", latest_a["id"], "75.30"),
        ("L3", bid_c["id"], "85.30"),
    ]
    assert datetime.fromisoformat(latest_a["submitted_at"]) == early_bid_at + timedelta(seconds=1)
    bid_clock(expires)
    assert [entry["bid_id"] for entry in client.get(rankings_url).json()] == [
        first_a["id"], bid_b["id"], bid_c["id"]
    ]
    bid_clock(VALID_UNTIL)
    assert client.get(rankings_url).json() == []
    assert [bid["id"] for bid in client.get(history_url).json()] == [
        first_a["id"], bid_b["id"], latest_a["id"], bid_c["id"]
    ]
    logged = connection.execute(
        select(AuctionActivity.bid_id, AuctionActivity.event_type).where(AuctionActivity.rfq_id == rfq_id)
    ).all()
    assert set(logged) == {(bid["id"], "bid_submitted") for bid in [first_a, bid_b, bid_c, latest_a]}
    assert current_close(client, rfq_id) == CLOSE


def test_bid_acceptance_uses_start_and_current_close(client, auction, bid_clock, connection):
    rfq_id, _, (supplier_id, *_) = auction
    url = f"/rfqs/{rfq_id}/bids"
    payload = quote(supplier_id)
    bid_clock(START - timedelta(microseconds=1))
    assert client.post(url, json=payload).status_code == 409
    bid_clock(START)
    post_bid(client, rfq_id, payload)
    bid_clock(CLOSE)
    assert client.post(url, json=payload).status_code == 409
    connection.execute(update(RFQ).where(RFQ.id == rfq_id).values(current_close_at=FORCED_CLOSE))
    post_bid(client, rfq_id, payload)
    bid_clock(FORCED_CLOSE)
    assert client.post(url, json=payload).status_code == 409
    assert len(client.get(url).json()) == 2


def test_rfq_listing_gets_current_lowest_bids_with_one_query(client, auction, bid_clock, connection, monkeypatch):
    rfq_id, _, (supplier_a, supplier_b, _) = auction
    with Session(bind=connection, join_transaction_mode="create_savepoint") as session:
        other_id, *_ = create_auction(session)
        empty_id, *_ = create_auction(session)
        session.commit()

    bid_clock(NOW - timedelta(minutes=8))
    original = post_bid(client, rfq_id, quote(supplier_a, "20.00"))
    leader = post_bid(client, rfq_id, quote(supplier_b, "50.00"))
    other_bid = post_bid(client, other_id, quote(supplier_a, "10.00"))
    bid_clock(NOW - timedelta(minutes=7))
    expiry = NOW + timedelta(seconds=1)
    post_bid(client, rfq_id, quote(supplier_a, "60.00", valid_until=expiry))
    bid_clock(NOW)
    monkeypatch.setitem(app.dependency_overrides, get_server_time, lambda: NOW)

    queries = []

    def observe_query(db_connection, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            queries.append(statement)

    event.listen(connection, "before_cursor_execute", observe_query)
    try:
        response = client.get("/rfqs", params={"auction_only": True})
    finally:
        event.remove(connection, "before_cursor_execute", observe_query)

    assert response.status_code == 200, response.text
    assert len(queries) == 1
    listing = {row["id"]: row["lowest_bid"] for row in response.json()}
    assert listing[rfq_id] == leader["total_price"]
    assert listing[other_id] == other_bid["total_price"]
    assert listing[empty_id] is None
    assert client.get(f"/rfqs/{rfq_id}/rankings").json()[0]["total_price"] == listing[rfq_id]

    for at, expected in [(expiry, original["total_price"]), (VALID_UNTIL, None)]:
        monkeypatch.setitem(app.dependency_overrides, get_server_time, lambda: at)
        listing = {row["id"]: row["lowest_bid"] for row in client.get("/rfqs").json()}
        assert listing[rfq_id] == expected


def test_bid_uses_live_server_clock(client, auction, connection):
    rfq_id, _, (supplier_id, *_) = auction
    now = datetime.now(timezone.utc)
    connection.execute(
        update(RFQ).where(RFQ.id == rfq_id).values(
            bid_start_at=now - timedelta(minutes=5),
            original_close_at=now + timedelta(minutes=5),
            current_close_at=now + timedelta(minutes=5),
            forced_close_at=now + timedelta(minutes=10),
        )
    )
    bid = post_bid(client, rfq_id, quote(supplier_id, valid_until=now + timedelta(days=1)))
    assert now <= datetime.fromisoformat(bid["submitted_at"]) <= datetime.now(timezone.utc)
    assert client.get(f"/rfqs/{rfq_id}/rankings").json()[0]["bid_id"] == bid["id"]


def test_websocket_broadcasts_committed_updates_only_to_their_rfq(client, auction, bid_clock, connection):
    rfq_id, _, (supplier_id, *_) = auction
    with Session(bind=connection, join_transaction_mode="create_savepoint") as session:
        other_rfq, _, (other_supplier, *_) = create_auction(session)
        session.commit()

    with (
        client.websocket_connect(f"/rfqs/{rfq_id}/ws") as first,
        client.websocket_connect(f"/rfqs/{rfq_id}/ws") as second,
        client.websocket_connect(f"/rfqs/{other_rfq}/ws") as other,
    ):
        bid = post_bid(client, rfq_id, quote(supplier_id))
        expected = {
            "type": "auction_updated", "rfq_id": rfq_id,
            "bid_id": bid["id"], "events": ["bid_submitted", "time_extended"],
        }
        assert first.receive_json() == expected
        assert second.receive_json() == expected
        assert current_close(client, rfq_id) == CLOSE + EXTENSION
        assert [record["event_type"] for record in client.get(f"/rfqs/{rfq_id}/activity").json()] == [
            "bid_submitted", "time_extended",
        ]

        bid_clock(CLOSE - TRIGGER_WINDOW - timedelta(minutes=1))
        other_bid = post_bid(client, other_rfq, quote(other_supplier))
        assert other.receive_json() == {
            "type": "auction_updated", "rfq_id": other_rfq,
            "bid_id": other_bid["id"], "events": ["bid_submitted"],
        }


def test_websocket_skips_rejected_and_rolled_back_bids(client, auction, bid_clock):
    rfq_id, _, (supplier_id, *_) = auction

    def reject_extension(mapper, db_connection, activity):
        if activity.event_type == "time_extended":
            raise RuntimeError("test rollback before publish")

    with client.websocket_connect(f"/rfqs/{rfq_id}/ws") as updates:
        invalid = client.post(f"/rfqs/{rfq_id}/bids", json=quote(supplier_id, "-1.00"))
        assert invalid.status_code == 422
        event.listen(AuctionActivity, "before_insert", reject_extension)
        try:
            with pytest.raises(RuntimeError, match="test rollback before publish"):
                client.post(f"/rfqs/{rfq_id}/bids", json=quote(supplier_id))
        finally:
            event.remove(AuctionActivity, "before_insert", reject_extension)

        bid = post_bid(client, rfq_id, quote(supplier_id))
        assert updates.receive_json()["bid_id"] == bid["id"]


@pytest.mark.parametrize("identifier", ["0", "invalid", "2147483647"])
def test_websocket_rejects_invalid_or_missing_rfq(client, identifier):
    with pytest.raises(WebSocketDisconnect) as error, client.websocket_connect(f"/rfqs/{identifier}/ws"):
        pytest.fail("Unexpectedly accepted an invalid or missing RFQ")
    assert error.value.code == 1008


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("carrier_name", "   "),
        ("freight_charge", "-0.01"),
        ("freight_charge", "10000000000.00"),
        ("origin_charge", "2.001"),
        ("destination_charge", "NaN"),
        ("transit_time_days", -1),
        ("transit_time_days", 1.5),
        ("valid_until", "2030-07-02T12:00:00"),
        ("valid_until", "9999-12-31T23:59:59-00:01"),
        ("submitted_at", NOW.isoformat()),
        ("total_price", "1.00"),
    ],
)
def test_malformed_quote_returns_422(client, auction, field, value):
    rfq_id, _, (supplier_id, *_) = auction
    payload = quote(supplier_id)
    payload[field] = value
    response = client.post(f"/rfqs/{rfq_id}/bids", json=payload)
    assert response.status_code == 422, response.text
    assert response.json()["detail"][0]["loc"] == ["body", field]


def test_expired_quote_and_invalid_supplier_are_rejected(client, auction, bid_clock):
    rfq_id, buyer_id, (supplier_id, *_) = auction
    url = f"/rfqs/{rfq_id}/bids"
    assert client.post(url, json=quote(supplier_id, valid_until=NOW)).status_code == 422
    assert client.post(url, json=quote(buyer_id)).status_code == 422
    assert client.post(url, json=quote(2147483647)).status_code == 422
    assert client.get(url).json() == []


def test_missing_rfq_and_disabled_auction(client, auction, connection, bid_clock):
    rfq_id, _, (supplier_id, *_) = auction
    config_table = AuctionConfiguration.__table__
    connection.execute(config_table.delete().where(config_table.c.rfq_id == rfq_id))
    assert client.post(f"/rfqs/{rfq_id}/bids", json=quote(supplier_id)).status_code == 409
    assert client.post("/rfqs/2147483647/bids", json=quote(supplier_id)).status_code == 404
    assert client.get("/rfqs/2147483647/bids").status_code == 404
    assert client.get("/rfqs/2147483647/rankings").status_code == 404


def test_any_bid_extends_at_window_start_and_window_moves(client, auction, bid_clock, connection):
    rfq_id, _, (supplier_id, *_) = auction
    window_start = CLOSE - TRIGGER_WINDOW
    bid_clock(window_start - timedelta(microseconds=1))
    post_bid(client, rfq_id, quote(supplier_id))
    assert current_close(client, rfq_id) == CLOSE

    bid_clock(window_start)
    triggering_bid = post_bid(client, rfq_id, quote(supplier_id))
    post_bid(client, rfq_id, quote(supplier_id))
    assert current_close(client, rfq_id) == CLOSE + EXTENSION
    assert extension_events(connection, rfq_id) == [
        (triggering_bid["id"], ExtensionTrigger.BID_RECEIVED, CLOSE, CLOSE + EXTENSION)
    ]


@pytest.mark.parametrize(
    "trigger", [ExtensionTrigger.SUPPLIER_RANK_CHANGED, ExtensionTrigger.LOWEST_BIDDER_CHANGED]
)
def test_rank_triggers_compare_supplier_positions(client, auction, bid_clock, connection, trigger):
    rfq_id, _, (supplier_a, supplier_b, supplier_c) = auction
    connection.execute(
        update(AuctionConfiguration).where(AuctionConfiguration.rfq_id == rfq_id).values(extension_trigger=trigger)
    )
    post_bid(client, rfq_id, quote(supplier_a, "60.00"))
    post_bid(client, rfq_id, quote(supplier_b, "80.00"))
    post_bid(client, rfq_id, quote(supplier_c, "90.00"))
    post_bid(client, rfq_id, quote(supplier_a, "55.00"))
    assert current_close(client, rfq_id) == CLOSE

    changes_second = post_bid(client, rfq_id, quote(supplier_c, "75.00"))
    expected_events = []
    close_before_leader_change = CLOSE
    if trigger == ExtensionTrigger.SUPPLIER_RANK_CHANGED:
        close_before_leader_change += EXTENSION
        expected_events.append((changes_second["id"], trigger, CLOSE, close_before_leader_change))
    assert current_close(client, rfq_id) == close_before_leader_change

    changes_leader = post_bid(client, rfq_id, quote(supplier_b, "50.00"))
    final_close = close_before_leader_change + EXTENSION
    expected_events.append((changes_leader["id"], trigger, close_before_leader_change, final_close))
    assert current_close(client, rfq_id) == final_close
    assert extension_events(connection, rfq_id) == expected_events
    assert client.get(f"/rfqs/{rfq_id}/rankings").json()[0]["supplier_id"] == supplier_b


def test_quote_expiry_alone_does_not_trigger_l1_extension(client, auction, bid_clock, connection):
    rfq_id, _, (supplier_a, supplier_b, supplier_c) = auction
    connection.execute(
        update(AuctionConfiguration)
        .where(AuctionConfiguration.rfq_id == rfq_id)
        .values(extension_trigger=ExtensionTrigger.LOWEST_BIDDER_CHANGED)
    )
    expiry = NOW + timedelta(seconds=1)
    post_bid(client, rfq_id, quote(supplier_a, "50.00", valid_until=expiry))
    post_bid(client, rfq_id, quote(supplier_b, "60.00"))

    bid_clock(expiry)
    post_bid(client, rfq_id, quote(supplier_c, "70.00"))
    assert client.get(f"/rfqs/{rfq_id}/rankings").json()[0]["supplier_id"] == supplier_b
    assert current_close(client, rfq_id) == CLOSE
    assert extension_events(connection, rfq_id) == []


def test_repeated_extensions_stop_at_forced_close(client, auction, bid_clock, connection):
    rfq_id, _, (supplier_id, *_) = auction
    forced_close = CLOSE + 2 * EXTENSION + timedelta(minutes=2)
    connection.execute(update(RFQ).where(RFQ.id == rfq_id).values(forced_close_at=forced_close))
    expected_events = []
    close = CLOSE
    for next_close in (CLOSE + EXTENSION, CLOSE + 2 * EXTENSION, forced_close):
        bid_clock(close - timedelta(microseconds=1))
        bid = post_bid(client, rfq_id, quote(supplier_id))
        assert current_close(client, rfq_id) == next_close
        expected_events.append((bid["id"], ExtensionTrigger.BID_RECEIVED, close, next_close))
        close = next_close

    bid_clock(forced_close - timedelta(microseconds=1))
    post_bid(client, rfq_id, quote(supplier_id))
    assert current_close(client, rfq_id) == forced_close
    for rejected_at in (forced_close, forced_close + timedelta(microseconds=1)):
        bid_clock(rejected_at)
        response = client.post(f"/rfqs/{rfq_id}/bids", json=quote(supplier_id))
        assert response.status_code == 409
    assert len(client.get(f"/rfqs/{rfq_id}/bids").json()) == 4
    assert extension_events(connection, rfq_id) == expected_events


def test_failed_extension_log_rolls_back_bid_and_deadline(client, auction, bid_clock, connection):
    rfq_id, _, (supplier_id, *_) = auction

    def reject_extension_log(mapper, db_connection, activity):
        if activity.event_type == "time_extended":
            raise RuntimeError("Test extension log failure")

    event.listen(AuctionActivity, "before_insert", reject_extension_log)
    try:
        with pytest.raises(RuntimeError, match="Test extension log failure"):
            client.post(f"/rfqs/{rfq_id}/bids", json=quote(supplier_id))
    finally:
        event.remove(AuctionActivity, "before_insert", reject_extension_log)

    assert current_close(client, rfq_id) == CLOSE
    assert client.get(f"/rfqs/{rfq_id}/bids").json() == []
    assert connection.scalar(select(AuctionActivity.id).where(AuctionActivity.rfq_id == rfq_id)) is None


@pytest.fixture
def concurrent_auction(monkeypatch):
    # Separate connections need committed fixtures. Keep them in a unique test schema.
    schema = f"bid_test_{uuid4().hex}"
    with engine.begin() as connection:
        connection.execute(CreateSchema(schema))

    test_engine = engine.execution_options(schema_translate_map={None: schema})
    try:
        Base.metadata.create_all(test_engine)
        with Session(test_engine) as session, session.begin():
            rfq_id, _, (supplier_id, *_) = create_auction(session)

        def test_session():
            with Session(test_engine, expire_on_commit=False) as session:
                yield session

        monkeypatch.setitem(app.dependency_overrides, get_session, test_session)
        with TestClient(app) as client:
            yield client, test_engine, rfq_id, supplier_id
    finally:
        with engine.begin() as connection:
            connection.execute(DropSchema(schema, cascade=True))


def test_concurrent_submissions_keep_both_bids_and_chain_extensions(concurrent_auction, bid_clock):
    client, test_engine, rfq_id, supplier_id = concurrent_auction
    barrier = Barrier(2)

    def submit(freight):
        barrier.wait(timeout=5)
        return post_bid(client, rfq_id, quote(supplier_id, freight))

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(submit, "80.00")
        second = pool.submit(submit, "70.00")
        accepted_ids = {first.result(timeout=10)["id"], second.result(timeout=10)["id"]}

    history = client.get(f"/rfqs/{rfq_id}/bids").json()
    assert len(history) == 2
    assert {bid["id"] for bid in history} == accepted_ids
    ranks = client.get(f"/rfqs/{rfq_id}/rankings").json()
    assert [rank["bid_id"] for rank in ranks] == [max(accepted_ids)]
    assert current_close(client, rfq_id) == CLOSE + 2 * EXTENSION
    with test_engine.connect() as connection:
        first_id, second_id = sorted(accepted_ids)
        assert extension_events(connection, rfq_id) == [
            (first_id, ExtensionTrigger.BID_RECEIVED, CLOSE, CLOSE + EXTENSION),
            (second_id, ExtensionTrigger.BID_RECEIVED, CLOSE + EXTENSION, CLOSE + 2 * EXTENSION),
        ]
        submissions = select(AuctionActivity.bid_id).where(AuctionActivity.event_type == "bid_submitted")
        assert set(connection.scalars(submissions)) == accepted_ids


@pytest.mark.parametrize("deadline_extended", [False, True])
def test_bid_waiting_on_lock_rechecks_time_and_deadline(concurrent_auction, bid_clock, deadline_extended):
    client, test_engine, rfq_id, supplier_id = concurrent_auction
    lock_attempted = Event()

    def observe_lock(connection, cursor, statement, parameters, context, executemany):
        if "FOR UPDATE" in statement:
            lock_attempted.set()

    with ThreadPoolExecutor(max_workers=1) as pool:
        with test_engine.begin() as connection:
            connection.execute(select(RFQ.id).where(RFQ.id == rfq_id).with_for_update()).scalar_one()
            event.listen(test_engine, "before_cursor_execute", observe_lock)
            try:
                future = pool.submit(client.post, f"/rfqs/{rfq_id}/bids", json=quote(supplier_id))
                assert lock_attempted.wait(timeout=5)
                bid_clock(CLOSE)
                if deadline_extended:
                    connection.execute(
                        update(RFQ).where(RFQ.id == rfq_id).values(current_close_at=CLOSE + EXTENSION)
                    )
            finally:
                event.remove(test_engine, "before_cursor_execute", observe_lock)
        response = future.result(timeout=10)

    history = client.get(f"/rfqs/{rfq_id}/bids").json()
    if deadline_extended:
        assert response.status_code == 201, response.text
        assert history == [response.json()]
        assert current_close(client, rfq_id) == CLOSE + 2 * EXTENSION
    else:
        assert response.status_code == 409, response.text
        assert history == []
