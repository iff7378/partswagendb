import logging
from typing import Any

import httpx

from app.config import settings
from app.schemas.vehicle import VinDecodeResult

logger = logging.getLogger(__name__)

# The flat decodevinvalues endpoint returns ~140 variables keyed without spaces.
_FIELD_MAP = {
    "ModelYear": "year",
    "Make": "make",
    "Model": "model",
    "Trim": "trim",
    "BodyClass": "body_style",
    "DriveType": "drive_type",
    "TransmissionStyle": "transmission",
}


def _clean(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in {"not applicable", "null", "n/a"}:
        return None
    return text


def _build_engine(values: dict[str, str]) -> str | None:
    displacement = _clean(values.get("DisplacementL"))
    cylinders = _clean(values.get("EngineCylinders"))
    config = _clean(values.get("EngineConfiguration"))

    bits: list[str] = []
    if displacement:
        try:
            bits.append(f"{float(displacement):.1f}L")
        except ValueError:
            bits.append(f"{displacement}L")
    if config:
        bits.append(config)
    if cylinders:
        bits.append(f"{cylinders}-cyl")
    return " ".join(bits) or None


async def decode_vin(vin: str) -> VinDecodeResult | None:
    """Look a VIN up against the free NHTSA vPIC API. Returns None if unavailable."""
    if not settings.vin_decode_enabled:
        return None

    url = f"{settings.nhtsa_api_url}/vehicles/decodevinvalues/{vin}?format=json"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url)
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError):
        logger.warning("VIN decode failed for %s", vin, exc_info=True)
        return None

    results = payload.get("Results") or []
    if not results:
        return None

    values: dict[str, str] = results[0]
    decoded: dict[str, Any] = {
        target: _clean(values.get(source)) for source, target in _FIELD_MAP.items()
    }

    if decoded.get("year"):
        try:
            decoded["year"] = int(str(decoded["year"]))
        except ValueError:
            decoded["year"] = None

    decoded["engine"] = _build_engine(values)

    return VinDecodeResult(
        vin=vin,
        raw={k: v for k, v in values.items() if _clean(v)},
        **decoded,
    )
