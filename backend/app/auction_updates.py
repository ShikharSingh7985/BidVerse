import asyncio
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Annotated

from anyio import create_task_group
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, WebSocketException, status
from sqlalchemy import select

from app.models import RFQ
from app.rfqs import DatabaseSession, RFQId

router = APIRouter()


class AuctionUpdates:
    def __init__(self) -> None:
        self._rooms: dict[int, set[asyncio.Queue[dict]]] = {}

    @contextmanager
    def subscribe(self, rfq_id: int) -> Iterator[asyncio.Queue[dict]]:
        queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=32)
        room = self._rooms.setdefault(rfq_id, set())
        room.add(queue)
        try:
            yield queue
        finally:
            room.remove(queue)
            if not room:
                del self._rooms[rfq_id]

    async def publish(self, rfq_id: int, bid_id: int, deadline_extended: bool) -> None:
        events = ["bid_submitted"]
        if deadline_extended:
            events.append("time_extended")
        message = {
            "type": "auction_updated",
            "rfq_id": rfq_id,
            "bid_id": bid_id,
            "events": events,
        }
        for queue in self._rooms.get(rfq_id, ()):
            # Keep a slow client bounded. Each notification refreshes the current snapshot.
            if queue.full():
                queue.get_nowait()
            queue.put_nowait(message)


auction_updates = AuctionUpdates()


def _rfq_exists(rfq_id: RFQId, session: DatabaseSession) -> bool:
    with session.begin():
        return session.scalar(select(RFQ.id).where(RFQ.id == rfq_id)) is not None


async def _send_updates(websocket: WebSocket, rfq_id: int, queue: asyncio.Queue[dict]) -> None:
    while True:
        try:
            message = await asyncio.wait_for(queue.get(), timeout=20)
        except TimeoutError:
            message = {"type": "heartbeat", "rfq_id": rfq_id}
        await websocket.send_json(message)


async def _wait_for_disconnect(websocket: WebSocket) -> None:
    while (await websocket.receive())["type"] != "websocket.disconnect":
        pass


@router.websocket("/rfqs/{rfq_id}/ws")
async def rfq_update_stream(
    websocket: WebSocket, rfq_id: RFQId, exists: Annotated[bool, Depends(_rfq_exists)]
) -> None:
    if not exists:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="RFQ not found")

    with auction_updates.subscribe(rfq_id) as queue:
        await websocket.accept()
        async with create_task_group() as stream:
            async def send_updates() -> None:
                try:
                    await _send_updates(websocket, rfq_id, queue)
                except WebSocketDisconnect:
                    stream.cancel_scope.cancel()

            stream.start_soon(send_updates)
            await _wait_for_disconnect(websocket)
            stream.cancel_scope.cancel()
