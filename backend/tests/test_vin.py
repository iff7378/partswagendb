import pytest

from app.schemas.vehicle import normalise_vin
from app.services.vin import _build_engine


def test_blank_vin_becomes_none() -> None:
    assert normalise_vin(None) is None
    assert normalise_vin("   ") is None


def test_vin_is_upcased_and_trimmed() -> None:
    assert normalise_vin(" 3vwfe21c04m000001 ") == "3VWFE21C04M000001"


@pytest.mark.parametrize(
    "bad",
    [
        "TOOSHORT",
        "3VWFE21C04M0000012",  # 18 characters
        "3VWFE21C04M00000I",  # I is not a legal VIN character
        "3VWFE21C04M00000O",
        "3VWFE21C04M00000Q",
        "3VWFE21C04M00-001",
    ],
)
def test_invalid_vins_are_rejected(bad: str) -> None:
    with pytest.raises(ValueError):
        normalise_vin(bad)


def test_engine_description_is_assembled() -> None:
    engine = _build_engine(
        {
            "DisplacementL": "1.781000",
            "EngineCylinders": "4",
            "EngineConfiguration": "In-Line",
        }
    )
    assert engine == "1.8L In-Line 4-cyl"


def test_engine_description_tolerates_missing_fields() -> None:
    assert _build_engine({}) is None
    assert _build_engine({"EngineCylinders": "6"}) == "6-cyl"
