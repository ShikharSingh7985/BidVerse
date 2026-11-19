from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from app import bids
from app.main import app
from app.models import ExtensionTrigger, User
from app.rfqs import get_server_time

NOW = datetime(2030, 7, 1, 12, tzinfo=timezone.utc)
CLOSE = NOW + timedelta(minutes=5)
NEW_CLOSE = CLOSE + timedelta(minutes=5)
LOCAL_OFFSET = timezone(timedelta(hours=5, minutes=30))


@pytest.fixture
def actors(connection):
    with Session(bind=connection, join_transaction_mode="create_savepoint") as session:
        users = [
            User(name=f"Activity {role}", email=f"{uuid4().hex}@example.test", role=role)
            for role in ("buyer", "supplier", "supplier")
        ]
        session.add_all(users)
        session.flush()
        ids = tuple(user.id for user in users)
        session.commit()
    return ids


def create_auction(client, buyer_id, trigger):
    response = client.post(
        "/rfqs",
        json={
            "buyer_id": buyer_id,
            "name": "Activity log test auction",
            "reference_id": f"activity-test-{uuid4().hex}",
            "currency": "USD",
            "service_date": "2030-07-02",
            "bid_start_at": (NOW - timedelta(minutes=20)).astimezone(LOCAL_OFFSET).isoformat(),
            "original_close_at": CLOSE.astimezone(LOCAL_OFFSET).isoformat(),
            "forced_close_at": (CLOSE + timedelta(minutes=20)).astimezone(LOCAL_OFFSET).isoformat(),
            "auction_configuration": {
                "trigger_window_minutes": 10,
                "extension_minutes": 5,
                "extension_trigger": trigger.value,
            },
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def submit_bid(client, rfq_id, supplier_id, freight):
    response = client.post(
        f"/rfqs/{rfq_id}/bids",
        json={
            "supplier_id": supplier_id,
            "carrier_name": "Activity carrier",
            "freight_charge": freight,
            "origin_charge": "-0",
            "destination_charge": "2.1",
            "transit_time_days": 2,
            "valid_until": (NOW + timedelta(days=1)).astimezone(LOCAL_OFFSET).isoformat(),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.parametrize("trigger", list(ExtensionTrigger))
def test_activity_includes_bid_and_extension_events(client, actors, monkeypatch, trigger):
    buyer_id, first_supplier, second_supplier = actors
    monkeypatch.setitem(app.dependency_overrides, get_server_time, lambda: NOW)
    rfq = create_auction(client, buyer_id, trigger)
    resource = f"/rfqs/{rfq['id']}"
    assert client.get(resource).json() == rfq
    assert rfq["original_close_at"] == "2030-07-01T12:05:00Z"
    empty = client.get(f"{resource}/activity")
    assert empty.status_code == 200
    assert empty.json() == []

    first_at = NOW - timedelta(minutes=6)
    monkeypatch.setattr(bids, "get_server_time", lambda: first_at)
    first_bid = submit_bid(client, rfq["id"], first_supplier, "100")

    monkeypatch.setattr(bids, "get_server_time", lambda: NOW)
    second_bid = submit_bid(client, rfq["id"], second_supplier, "80")
    assert second_bid["freight_charge"] == "80.00"
    assert second_bid["origin_charge"] == "0.00"
    assert second_bid["destination_charge"] == "2.10"
    assert second_bid["valid_until"] == "2030-07-02T12:00:00Z"
    assert client.get(f"{resource}/bids").json() == [second_bid, first_bid]
    ranking = client.get(f"{resource}/rankings").json()
    assert ranking[0]["bid_id"] == second_bid["id"]
    assert ranking[0]["total_price"] == second_bid["total_price"] == "82.10"

    response = client.get(f"{resource}/activity")
    assert response.status_code == 200, response.text
    first_event, second_event, extension = response.json()
    assert first_event["id"] < second_event["id"] < extension["id"]
    assert first_event == {
        "id": first_event["id"],
        "rfq_id": rfq["id"],
        "bid_id": first_bid["id"],
        "event_type": "bid_submitted",
        "occurred_at": first_bid["submitted_at"],
        "extension_trigger": None,
        "previous_close_at": None,
        "new_close_at": None,
    }
    assert second_event == {
        **first_event,
        "id": second_event["id"],
        "bid_id": second_bid["id"],
        "occurred_at": second_bid["submitted_at"],
    }
    detail = client.get(resource).json()
    assert datetime.fromisoformat(detail["current_close_at"]) == NEW_CLOSE
    assert extension == {
        **second_event,
        "id": extension["id"],
        "event_type": "time_extended",
        "extension_trigger": trigger.value,
        "previous_close_at": rfq["current_close_at"],
        "new_close_at": detail["current_close_at"],
    }
    assert next(row for row in client.get("/rfqs").json() if row["id"] == rfq["id"]) == {
        **detail,
        "lowest_bid": ranking[0]["total_price"],
    }


def test_activity_orders_by_timestamp_and_excludes_other_rfqs(client, actors, monkeypatch):
    buyer_id, supplier_id, _ = actors
    rfq = create_auction(client, buyer_id, ExtensionTrigger.BID_RECEIVED)
    other_rfq = create_auction(client, buyer_id, ExtensionTrigger.BID_RECEIVED)

    monkeypatch.setattr(bids, "get_server_time", lambda: NOW - timedelta(minutes=6))
    later_bid = submit_bid(client, rfq["id"], supplier_id, "100")
    submit_bid(client, other_rfq["id"], supplier_id, "100")
    monkeypatch.setattr(bids, "get_server_time", lambda: NOW - timedelta(minutes=7))
    earlier_bid = submit_bid(client, rfq["id"], supplier_id, "95")

    events = client.get(f"/rfqs/{rfq['id']}/activity").json()
    assert [event["bid_id"] for event in events] == [earlier_bid["id"], later_bid["id"]]
    assert events[0]["id"] > events[1]["id"]


@pytest.mark.parametrize("rfq_id", ["invalid", "0", "-1", "2147483648"])
def test_rfq_routes_share_path_validation(client, rfq_id):
    for suffix in ("", "/bids", "/rankings", "/activity"):
        response = client.get(f"/rfqs/{rfq_id}{suffix}")
        assert response.status_code == 422
        assert response.json()["detail"][0]["loc"] == ["path", "rfq_id"]


def test_rfq_routes_share_not_found_response(client):
    for suffix in ("", "/bids", "/rankings", "/activity"):
        response = client.get(f"/rfqs/2147483647{suffix}")
        assert response.status_code == 404
        assert response.json() == {"detail": "RFQ not found"}


def test_activity_openapi_documents_both_event_shapes(client):
    paths = client.get("/openapi.json").json()["paths"]
    responses = paths["/rfqs/{rfq_id}/activity"]["get"]["responses"]
    schema = responses["200"]["content"]["application/json"]["schema"]
    discriminator = schema["items"]["discriminator"]
    assert schema["type"] == "array"
    assert discriminator["propertyName"] == "event_type"
    assert set(discriminator["mapping"]) == {"bid_submitted", "time_extended"}
