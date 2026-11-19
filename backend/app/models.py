from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import (
    CheckConstraint,
    Computed,
    DateTime,
    Enum,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class ExtensionTrigger(StrEnum):
    BID_RECEIVED = "bid_received"
    SUPPLIER_RANK_CHANGED = "supplier_rank_changed"
    LOWEST_BIDDER_CHANGED = "lowest_bidder_changed"


extension_trigger_type = Enum(
    ExtensionTrigger,
    values_callable=lambda members: [member.value for member in members],
    name="auction_extension_trigger",
    native_enum=False,
    create_constraint=True,
    validate_strings=True,
)


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("email", name="uq_users_email"),
        CheckConstraint("role IN ('buyer', 'supplier')", name="ck_users_role"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(254))
    role: Mapped[str] = mapped_column(String(8))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    rfqs: Mapped[list[RFQ]] = relationship(back_populates="buyer", passive_deletes="all")
    bids: Mapped[list[Bid]] = relationship(back_populates="supplier", passive_deletes="all")


class RFQ(Base):
    __tablename__ = "rfqs"
    __table_args__ = (
        UniqueConstraint("reference_id", name="uq_rfqs_reference_id"),
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="ck_rfqs_currency_format"),
        CheckConstraint("bid_start_at < original_close_at", name="ck_rfqs_start_before_close"),
        CheckConstraint("original_close_at < forced_close_at", name="ck_rfqs_forced_after_original"),
        CheckConstraint(
            "current_close_at BETWEEN original_close_at AND forced_close_at",
            name="ck_rfqs_current_close_bounds",
        ),
        Index("ix_rfqs_buyer_id", "buyer_id"),
        Index("ix_rfqs_current_close_at", "current_close_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    buyer_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    reference_id: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(160))
    currency: Mapped[str] = mapped_column(String(3))
    service_date: Mapped[date]
    bid_start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    original_close_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    current_close_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    forced_close_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    buyer: Mapped[User] = relationship(back_populates="rfqs")
    auction_configuration: Mapped[AuctionConfiguration | None] = relationship(
        back_populates="rfq", passive_deletes="all"
    )
    bids: Mapped[list[Bid]] = relationship(back_populates="rfq", passive_deletes="all")
    activities: Mapped[list[AuctionActivity]] = relationship(
        back_populates="rfq", passive_deletes="all"
    )


class AuctionConfiguration(Base):
    __tablename__ = "auction_configurations"
    __table_args__ = (
        CheckConstraint("trigger_window_minutes > 0", name="ck_auction_config_trigger_window"),
        CheckConstraint("extension_minutes > 0", name="ck_auction_config_extension_minutes"),
    )

    rfq_id: Mapped[int] = mapped_column(ForeignKey("rfqs.id", ondelete="RESTRICT"), primary_key=True)
    trigger_window_minutes: Mapped[int]
    extension_minutes: Mapped[int]
    extension_trigger: Mapped[ExtensionTrigger] = mapped_column(extension_trigger_type)

    rfq: Mapped[RFQ] = relationship(back_populates="auction_configuration")


class Bid(Base):
    __tablename__ = "bids"

    id: Mapped[int] = mapped_column(primary_key=True)
    rfq_id: Mapped[int] = mapped_column(ForeignKey("rfqs.id", ondelete="RESTRICT"))
    supplier_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    carrier_name: Mapped[str] = mapped_column(String(160))
    freight_charge: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    origin_charge: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    destination_charge: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    total_price: Mapped[Decimal] = mapped_column(
        Numeric(13, 2), Computed("freight_charge + origin_charge + destination_charge", persisted=True)
    )
    transit_time_days: Mapped[int]
    valid_until: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("rfq_id", "id", name="uq_bids_rfq_id_id"),
        CheckConstraint(
            "freight_charge BETWEEN 0 AND 9999999999.99 "
            "AND origin_charge BETWEEN 0 AND 9999999999.99 "
            "AND destination_charge BETWEEN 0 AND 9999999999.99",
            name="ck_bids_charge_range",
        ),
        CheckConstraint("transit_time_days >= 0", name="ck_bids_transit_time"),
        CheckConstraint("valid_until > submitted_at", name="ck_bids_quote_validity"),
        Index("ix_bids_rfq_price", rfq_id, total_price, submitted_at, id),
        Index("ix_bids_rfq_supplier_history", rfq_id, supplier_id, submitted_at.desc(), id.desc()),
        Index("ix_bids_supplier_id", supplier_id),
    )

    rfq: Mapped[RFQ] = relationship(back_populates="bids")
    supplier: Mapped[User] = relationship(back_populates="bids")
    activities: Mapped[list[AuctionActivity]] = relationship(
        back_populates="bid", foreign_keys=lambda: [AuctionActivity.bid_id], passive_deletes="all"
    )


class AuctionActivity(Base):
    __tablename__ = "auction_activity_logs"
    __table_args__ = (
        ForeignKeyConstraint(
            ["rfq_id", "bid_id"],
            ["bids.rfq_id", "bids.id"],
            name="fk_auction_activity_bid_in_rfq",
            ondelete="RESTRICT",
        ),
        UniqueConstraint("bid_id", "event_type", name="uq_auction_activity_bid_event"),
        CheckConstraint(
            "(event_type = 'bid_submitted' AND extension_trigger IS NULL "
            "AND previous_close_at IS NULL AND new_close_at IS NULL) OR "
            "(event_type = 'time_extended' AND extension_trigger IS NOT NULL "
            "AND previous_close_at IS NOT NULL AND new_close_at IS NOT NULL "
            "AND previous_close_at < new_close_at)",
            name="ck_auction_activity_event_details",
        ),
        Index("ix_auction_activity_rfq_timeline", "rfq_id", "occurred_at", "id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    rfq_id: Mapped[int] = mapped_column(ForeignKey("rfqs.id", ondelete="RESTRICT"))
    bid_id: Mapped[int] = mapped_column()
    event_type: Mapped[str] = mapped_column(String(16))
    extension_trigger: Mapped[ExtensionTrigger | None] = mapped_column(extension_trigger_type)
    previous_close_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    new_close_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    rfq: Mapped[RFQ] = relationship(back_populates="activities")
    bid: Mapped[Bid] = relationship(back_populates="activities", foreign_keys=[bid_id])
