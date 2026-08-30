import io
import logging
import uuid
from functools import lru_cache

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError
from PIL import Image, ImageOps, UnidentifiedImageError

from app.config import settings

logger = logging.getLogger(__name__)

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic"}


def _build_client(endpoint_url: str):  # type: ignore[no-untyped-def]
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
        config=Config(signature_version="s3v4"),
    )


@lru_cache
def get_s3_client():  # type: ignore[no-untyped-def]
    """Client for server-side calls, over the internal container network."""
    return _build_client(settings.s3_endpoint_url)


@lru_cache
def get_presign_client():  # type: ignore[no-untyped-def]
    """Client for links handed to browsers.

    Signed separately against the public endpoint because SigV4 covers the Host
    header: rewriting the host after signing invalidates the signature.
    """
    return _build_client(settings.s3_public_endpoint_url)


def ensure_bucket() -> None:
    client = get_s3_client()
    try:
        client.head_bucket(Bucket=settings.s3_bucket)
    except ClientError:
        logger.info("Creating bucket %s", settings.s3_bucket)
        client.create_bucket(Bucket=settings.s3_bucket)


def build_object_key(prefix: str, filename: str) -> str:
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else "jpg"
    return f"{prefix}/{uuid.uuid4().hex}.{suffix}"


def upload_bytes(key: str, data: bytes, content_type: str) -> None:
    get_s3_client().put_object(
        Bucket=settings.s3_bucket, Key=key, Body=data, ContentType=content_type
    )


def download_bytes(key: str) -> bytes:
    response = get_s3_client().get_object(Bucket=settings.s3_bucket, Key=key)
    body: bytes = response["Body"].read()
    return body


def delete_object(key: str) -> None:
    try:
        get_s3_client().delete_object(Bucket=settings.s3_bucket, Key=key)
    except ClientError:
        logger.warning("Failed to delete object %s", key, exc_info=True)


def presigned_url(key: str | None) -> str | None:
    if not key:
        return None
    url: str = get_presign_client().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.s3_bucket, "Key": key},
        ExpiresIn=settings.presigned_url_ttl_seconds,
    )
    return url


def normalise_original(data: bytes) -> tuple[bytes, int, int] | None:
    """Re-encode an upload to the largest size worth keeping.

    Returns (jpeg_bytes, width, height) at the stored size, or None if the image
    cannot be read, in which case the caller should store the bytes untouched.

    A phone shoots 12MP, but nothing here needs it: OCR runs at 1600px and the
    UI shows a thumbnail or a detail view. Capping the long edge at 2048px costs
    nothing visible and cuts storage roughly fourfold. Orientation is baked into
    the pixels at the same time, so the EXIF tag is no longer load-bearing.
    """
    try:
        with Image.open(io.BytesIO(data)) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGB")
            # Only ever shrink: upscaling a small photo just wastes space.
            if max(image.size) > settings.original_max_px:
                image.thumbnail(
                    (settings.original_max_px, settings.original_max_px),
                    Image.Resampling.LANCZOS,
                )
            buffer = io.BytesIO()
            image.save(buffer, format="JPEG", quality=88, optimize=True)
            return buffer.getvalue(), image.width, image.height
    except (UnidentifiedImageError, OSError):
        logger.warning("Could not re-encode upload, storing it as-is", exc_info=True)
        return None


def make_thumbnail(data: bytes) -> tuple[bytes, int, int] | None:
    """Return (jpeg_bytes, original_width, original_height), or None if unreadable."""
    try:
        with Image.open(io.BytesIO(data)) as opened:
            # Phones record orientation in EXIF rather than rotating the pixels,
            # so without this portrait shots come out sideways.
            image = ImageOps.exif_transpose(opened).convert("RGB")
            width, height = image.size
            image.thumbnail((settings.thumbnail_max_px, settings.thumbnail_max_px))
            buffer = io.BytesIO()
            image.save(buffer, format="JPEG", quality=82, optimize=True)
            return buffer.getvalue(), width, height
    except (UnidentifiedImageError, OSError):
        logger.warning("Could not generate thumbnail", exc_info=True)
        return None
