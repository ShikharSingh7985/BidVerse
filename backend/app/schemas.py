from datetime import date, datetime, timezone
from decimal import Decimal
from enum import StrEnum
from typing import Annotated, Literal, Self

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    PlainSerializer,
    StringConstraints,
    model_validator,
)

from app.models import ExtensionTrigger

MAX_POSTGRES_INTEGER = 2**31 - 1
PositiveInteger = Annotated[int, Field(strict=True, gt=0, le=MAX_POSTGRES_INTEGER)]
NonnegativeInteger = Annotated[int, Field(strict=True, ge=0, le=MAX_POSTGRES_INTEGER)]
QuoteCharge = Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=2, allow_inf_nan=False)]


def _to_supported_utc(timestamp: datetime) -> datetime:
    try:
        return timestamp.astimezone(timezone.utc)
    except OverflowError as exc:
        raise ValueError("Choose a date within the supported UTC calendar range") from exc


RequestTimestamp = Annotated[AwareDatetime, AfterValidator(_to_supported_utc)]
ResponseTimestamp = Annotated[
    AwareDatetime,
    PlainSerializer(lambda timestamp: timestamp.astimezone(timezone.utc), return_type=datetime, when_used="json"),
]
ResponseMoney = Annotated[
    Decimal,
    PlainSerializer(lambda amount: f"{amount or Decimal(0):.2f}", return_type=str, when_used="json"),
]


class RFQStatus(StrEnum):
    UPCOMING = "upcoming"
    ACTIVE = "active"
    CLOSED = "closed"
    FORCE_CLOSED = "force_closed"


class AuctionConfigurationSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    trigger_window_minutes: PositiveInteger
    extension_minutes: PositiveInteger
    extension_trigger: ExtensionTrigger


class UserOption(BaseModel):
    id: int
    name: str


class RFQCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    buyer_id: PositiveInteger
    reference_id: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64, pattern=r"^[^\x00]+$")
    ]
    name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160, pattern=r"^[^\x00]+$")
    ]
    currency: Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")]
    service_date: date
    bid_start_at: RequestTimestamp
    original_close_at: RequestTimestamp
    forced_close_at: RequestTimestamp
    auction_configuration: AuctionConfigurationSchema | None = None

    @model_validator(mode="after")
    def check_close_times(self) -> Self:
        if self.bid_start_at >= self.original_close_at:
            raise ValueError("bid_start_at must be before original_close_at")
        if self.original_close_at >= self.forced_close_at:
            raise ValueError("forced_close_at must be after original_close_at")
        return self


class RFQRead(BaseModel):
    id: int
    buyer_id: int
    reference_id: str
    name: str
    currency: str
    service_date: date
    bid_start_at: ResponseTimestamp
    original_close_at: ResponseTimestamp
    current_close_at: ResponseTimestamp
    forced_close_at: ResponseTimestamp
    created_at: ResponseTimestamp
    auction_configuration: AuctionConfigurationSchema | None
    status: RFQStatus


class RFQListRead(RFQRead):
    lowest_bid: ResponseMoney | None = Field(
        description="Lowest total among each supplier's latest unexpired bid."
    )


class BidCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    supplier_id: PositiveInteger
    carrier_name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160, pattern=r"^[^\x00]+$")
    ]
    freight_charge: QuoteCharge
    origin_charge: QuoteCharge
    destination_charge: QuoteCharge
    transit_time_days: NonnegativeInteger
    valid_until: RequestTimestamp


class BidRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    rfq_id: int
    supplier_id: int
    carrier_name: str
    freight_charge: ResponseMoney
    origin_charge: ResponseMoney
    destination_charge: ResponseMoney
    total_price: ResponseMoney
    transit_time_days: int
    valid_until: ResponseTimestamp
    submitted_at: ResponseTimestamp


class BidRanking(BaseModel):
    rank: str
    bid_id: int
    supplier_id: int
    carrier_name: str
    total_price: ResponseMoney
    submitted_at: ResponseTimestamp


class AuctionActivityBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    rfq_id: int
    bid_id: int
    occurred_at: ResponseTimestamp


class BidSubmittedActivity(AuctionActivityBase):
    event_type: Literal["bid_submitted"]
    extension_trigger: None
    previous_close_at: None
    new_close_at: None


class TimeExtendedActivity(AuctionActivityBase):
    event_type: Literal["time_extended"]
    extension_trigger: ExtensionTrigger
    previous_close_at: ResponseTimestamp
    new_close_at: ResponseTimestamp


AuctionActivityRead = Annotated[
    BidSubmittedActivity | TimeExtendedActivity, Field(discriminator="event_type")
]
