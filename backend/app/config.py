from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "PartsWagen"
    environment: str = "development"
    log_level: str = "INFO"

    postgres_user: str = "partswagen"
    postgres_password: str = "partswagen"
    postgres_db: str = "partswagen"
    postgres_host: str = "postgres"
    postgres_port: int = 5432
    database_url_override: str | None = None

    secret_key: str = "insecure-development-key-do-not-use-in-production"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 30
    algorithm: str = "HS256"

    # Kept as a plain string: pydantic-settings tries to JSON-decode list-typed
    # fields straight from the environment, which a comma-separated value fails.
    cors_origins: str = "http://localhost:5173"

    first_admin_email: str | None = None
    first_admin_password: str | None = None

    s3_endpoint_url: str = "http://minio:9000"
    s3_public_endpoint_url: str = "http://localhost:9000"
    s3_access_key: str = "partswagen"
    s3_secret_key: str = "partswagen"
    s3_bucket: str = "partswagen-photos"
    s3_region: str = "us-east-1"
    presigned_url_ttl_seconds: int = 3600

    ocr_enabled: bool = True
    vin_decode_enabled: bool = True
    nhtsa_api_url: str = "https://vpic.nhtsa.dot.gov/api"

    max_upload_bytes: int = 25 * 1024 * 1024
    thumbnail_max_px: int = 512
    # Long edge originals are stored at; uploads above this are downscaled.
    original_max_px: int = 2048

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def database_url(self) -> str:
        if self.database_url_override:
            return self.database_url_override
        return (
            f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
