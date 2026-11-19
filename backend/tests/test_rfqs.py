from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.main import app
from app.models import RFQ, ExtensionTrigger, User
from app.rfqs import get_server_time

NOW = datetime(2030, 6, 1, 12, tzinfo=timezone.utc)
START = NOW + timedelta(minutes=5)
ORIGINAL_CLOSE = NOW + timedelta(hours=1)
FORCED_CLOSE = NOW + timedelta(hours=2)


@pytest.fixture
def users(connection):
    label = uuid4().hex
    with Session(bind=connection, join_transaction_mode="create_savepoint") as session:
        buyer = User(name="Test buyer", email=f"buyer-{label}@example.test", role="buyer")
        supplier = User(name="Test supplier", email=f"supplier-{label}@example.test", role="supplier")
        session.add_all([buyer, supplier])
        session.flush()
        ids = {"buyer": buyer.id, "supplier": supplier.id}
        session.commit()
    return ids


@pytest.fixture(autouse=True)
def rfq_clock(monkeypatch):
    monkeypatch.setitem(app.dependency_overrides, get_server_time, lambda: NOW)


@pytest.fixture
def payload(users):
    return {
        "buyer_id": users["buyer"],
        "reference_id": f"test-{uuid4().hex}",
        "name": "Freight quote",
        "currency": "USD",
        "service_date": "2030-06-02",
        "bid_start_at": START.isoformat(),
        "original_close_at": ORIGINAL_CLOSE.isoformat(),
        "forced_close_at": FORCED_CLOSE.isoformat(),
        "auction_configuration": {
            "trigger_window_minutes": 10,
            "extension_minutes": 5,
            "extension_trigger": "bid_received",
        },
    }


@pytest.mark.parametrize(("endpoint", "role", "other_role"), [
    ("/buyers", "buyer", "supplier"),
    ("/suppliers", "supplier", "buyer"),
])
def test_list_user_options_filters_by_role_and_sorts_names(client, connection, endpoint, role, other_role):
    suffix = uuid4().hex
    with Session(bind=connection, join_transaction_mode="create_savepoint") as session:
        user_a = User(name=f"alpha-{suffix}", email=f"a-{suffix}@example.test", role=role)
        user_z = User(name=f"Zulu-{suffix}", email=f"z-{suffix}@example.test", role=role)
        other_user = User(name=f"other-{suffix}", email=f"s-{suffix}@example.test", role=other_role)
        session.add_all([user_z, other_user, user_a])
        session.flush()
        expected = [{"id": user.id, "name": user.name} for user in (user_a, user_z)]
        session.commit()

    response = client.get(endpoint)
    assert response.status_code == 200
    assert [buyer for buyer in response.json() if buyer["name"].endswith(suffix)] == expected


@pytest.mark.parametrize("trigger", list(ExtensionTrigger))
def test_create_list_and_fetch_rfq(client, payload, trigger):
    payload["auction_configuration"]["extension_trigger"] = trigger.value
    response = client.post("/rfqs", json=payload)
    assert response.status_code == 201, response.text
    created = response.json()
    assert created["status"] == "upcoming"
    assert created["current_close_at"] == created["original_close_at"]
    assert created["auction_configuration"] == payload["auction_configuration"]
    assert created["buyer_id"] == payload["buyer_id"]

    detail = client.get(f"/rfqs/{created['id']}")
    assert detail.status_code == 200
    assert detail.json() == created
    listing = client.get("/rfqs")
    assert listing.status_code == 200
    assert {**created, "lowest_bid": None} in listing.json()


def test_create_without_auction_configuration(client, payload):
    payload.pop("auction_configuration")
    response = client.post("/rfqs", json=payload)
    assert response.status_code == 201, response.text
    rfq = response.json()
    assert rfq["auction_configuration"] is None
    assert {**rfq, "lowest_bid": None} in client.get("/rfqs").json()
    auctions = client.get("/rfqs", params={"auction_only": True}).json()
    assert all(auction["id"] != rfq["id"] for auction in auctions)


def test_status_uses_live_server_clock(client, payload, monkeypatch):
    monkeypatch.delitem(app.dependency_overrides, get_server_time)
    now = datetime.now(timezone.utc)
    local_now = now.astimezone(timezone(timedelta(hours=5, minutes=30)))
    payload.update(
        bid_start_at=(local_now - timedelta(hours=1)).isoformat(),
        original_close_at=(local_now + timedelta(hours=1)).isoformat(),
        forced_close_at=(local_now + timedelta(hours=2)).isoformat(),
    )
    response = client.post("/rfqs", json=payload)
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "active"
    assert client.get(f"/rfqs/{response.json()['id']}").json()["status"] == "active"


def test_status_boundaries_use_current_close(client, connection, payload, monkeypatch):
    ordinary = client.post("/rfqs", json=payload).json()
    payload["reference_id"] += "-extended"
    extended = client.post("/rfqs", json=payload).json()
    connection.execute(
        update(RFQ).where(RFQ.id == extended["id"]).values(current_close_at=FORCED_CLOSE)
    )

    for now, expected_statuses in [
        (START - timedelta(microseconds=1), ("upcoming", "upcoming")),
        (START, ("active", "active")),
        (ORIGINAL_CLOSE, ("closed", "active")),
        (FORCED_CLOSE, ("closed", "force_closed")),
    ]:
        monkeypatch.setitem(app.dependency_overrides, get_server_time, lambda: now)
        listing = {rfq["id"]: rfq["status"] for rfq in client.get("/rfqs").json()}
        for rfq, expected in zip([ordinary, extended], expected_statuses, strict=True):
            assert listing[rfq["id"]] == expected
            assert client.get(f"/rfqs/{rfq['id']}").json()["status"] == expected


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("bid_start_at", ORIGINAL_CLOSE.isoformat(), "bid_start_at must be before original_close_at"),
        ("forced_close_at", ORIGINAL_CLOSE.isoformat(), "forced_close_at must be after original_close_at"),
        ("forced_close_at", START.isoformat(), "forced_close_at must be after original_close_at"),
        ("bid_start_at", "2030-06-01T12:05:00", "timezone"),
        ("bid_start_at", "0001-01-01T00:00:00+00:01", "UTC calendar range"),
        ("service_date", "2030-02-30", "valid date"),
        ("current_close_at", ORIGINAL_CLOSE.isoformat(), "Extra inputs"),
    ],
)
def test_invalid_dates_and_server_owned_deadline_return_422(client, payload, field, value, message):
    payload[field] = value
    response = client.post("/rfqs", json=payload)
    assert response.status_code == 422
    assert message in response.text


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("trigger_window_minutes", 0),
        ("extension_minutes", -1),
        ("trigger_window_minutes", 1.5),
        ("extension_minutes", True),
        ("extension_minutes", 2**31),
        ("extension_trigger", "any_change"),
    ],
)
def test_invalid_auction_settings_return_422(client, payload, field, value):
    payload["auction_configuration"][field] = value
    response = client.post("/rfqs", json=payload)
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "auction_configuration", field]


def test_invalid_buyer_and_missing_rfq(client, payload, users):
    payload["buyer_id"] = users["supplier"]
    response = client.post("/rfqs", json=payload)
    assert response.status_code == 422
    assert response.json()["detail"] == "buyer_id must identify an existing buyer"
    assert client.get("/rfqs/2147483647").status_code == 404


def test_duplicate_reference_returns_409(client, payload):
    assert client.post("/rfqs", json=payload).status_code == 201
    response = client.post("/rfqs", json=payload)
    assert response.status_code == 409
    listing = client.get("/rfqs").json()
    assert sum(rfq["reference_id"] == payload["reference_id"] for rfq in listing) == 1
