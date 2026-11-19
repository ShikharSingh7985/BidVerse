"""Create the RFQ auction schema.

Revision ID: 93f92ff58a26
Revises: 
Create Date: 2026-11-19 15:29:26.675321
"""
from alembic import op
import sqlalchemy as sa


revision = '93f92ff58a26'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    extension_trigger_type = sa.Enum(
        "bid_received",
        "supplier_rank_changed",
        "lowest_bidder_changed",
        name="auction_extension_trigger",
        native_enum=False,
        create_constraint=True,
    )

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("email", sa.String(254), nullable=False),
        sa.Column("role", sa.String(8), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("role IN ('buyer', 'supplier')", name="ck_users_role"),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )
    op.create_table(
        "rfqs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("buyer_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("reference_id", sa.String(64), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("service_date", sa.Date(), nullable=False),
        sa.Column("bid_start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("original_close_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("current_close_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("forced_close_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("currency ~ '^[A-Z]{3}$'", name="ck_rfqs_currency_format"),
        sa.CheckConstraint("bid_start_at < original_close_at", name="ck_rfqs_start_before_close"),
        sa.CheckConstraint("original_close_at < forced_close_at", name="ck_rfqs_forced_after_original"),
        sa.CheckConstraint(
            "current_close_at BETWEEN original_close_at AND forced_close_at",
            name="ck_rfqs_current_close_bounds",
        ),
        sa.UniqueConstraint("reference_id", name="uq_rfqs_reference_id"),
    )
    op.create_index("ix_rfqs_buyer_id", "rfqs", ["buyer_id"])
    op.create_index("ix_rfqs_current_close_at", "rfqs", ["current_close_at"])

    op.create_table(
        "auction_configurations",
        sa.Column("rfq_id", sa.Integer(), sa.ForeignKey("rfqs.id", ondelete="RESTRICT"), primary_key=True),
        sa.Column("trigger_window_minutes", sa.Integer(), nullable=False),
        sa.Column("extension_minutes", sa.Integer(), nullable=False),
        sa.Column("extension_trigger", extension_trigger_type, nullable=False),
        sa.CheckConstraint("trigger_window_minutes > 0", name="ck_auction_config_trigger_window"),
        sa.CheckConstraint("extension_minutes > 0", name="ck_auction_config_extension_minutes"),
    )

    op.create_table(
        "bids",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("rfq_id", sa.Integer(), sa.ForeignKey("rfqs.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("supplier_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("carrier_name", sa.String(160), nullable=False),
        sa.Column("freight_charge", sa.Numeric(12, 2), nullable=False),
        sa.Column("origin_charge", sa.Numeric(12, 2), nullable=False),
        sa.Column("destination_charge", sa.Numeric(12, 2), nullable=False),
        sa.Column(
            "total_price",
            sa.Numeric(13, 2),
            sa.Computed("freight_charge + origin_charge + destination_charge", persisted=True),
            nullable=False,
        ),
        sa.Column("transit_time_days", sa.Integer(), nullable=False),
        sa.Column("valid_until", sa.DateTime(timezone=True), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "freight_charge BETWEEN 0 AND 9999999999.99 "
            "AND origin_charge BETWEEN 0 AND 9999999999.99 "
            "AND destination_charge BETWEEN 0 AND 9999999999.99",
            name="ck_bids_charge_range",
        ),
        sa.CheckConstraint("transit_time_days >= 0", name="ck_bids_transit_time"),
        sa.CheckConstraint("valid_until > submitted_at", name="ck_bids_quote_validity"),
        sa.UniqueConstraint("rfq_id", "id", name="uq_bids_rfq_id_id"),
    )
    op.create_index("ix_bids_rfq_price", "bids", ["rfq_id", "total_price", "submitted_at", "id"])
    op.create_index(
        "ix_bids_rfq_supplier_history",
        "bids",
        ["rfq_id", "supplier_id", sa.column("submitted_at").desc(), sa.column("id").desc()],
    )
    op.create_index("ix_bids_supplier_id", "bids", ["supplier_id"])

    op.create_table(
        "auction_activity_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("rfq_id", sa.Integer(), sa.ForeignKey("rfqs.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("bid_id", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(16), nullable=False),
        sa.Column("extension_trigger", extension_trigger_type),
        sa.Column("previous_close_at", sa.DateTime(timezone=True)),
        sa.Column("new_close_at", sa.DateTime(timezone=True)),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["rfq_id", "bid_id"],
            ["bids.rfq_id", "bids.id"],
            name="fk_auction_activity_bid_in_rfq",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("bid_id", "event_type", name="uq_auction_activity_bid_event"),
        sa.CheckConstraint(
            "(event_type = 'bid_submitted' AND extension_trigger IS NULL "
            "AND previous_close_at IS NULL AND new_close_at IS NULL) OR "
            "(event_type = 'time_extended' AND extension_trigger IS NOT NULL "
            "AND previous_close_at IS NOT NULL AND new_close_at IS NOT NULL "
            "AND previous_close_at < new_close_at)",
            name="ck_auction_activity_event_details",
        ),
    )
    op.create_index("ix_auction_activity_rfq_timeline", "auction_activity_logs", ["rfq_id", "occurred_at", "id"])


def downgrade() -> None:
    op.drop_table("auction_activity_logs")
    op.drop_table("bids")
    op.drop_table("auction_configurations")
    op.drop_table("rfqs")
    op.drop_table("users")
