FROM python:3.14-slim AS base

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# tesseract-ocr powers part-number extraction from photos.
RUN apt-get update && apt-get install -y --no-install-recommends \
        tesseract-ocr \
        libtesseract-dev \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml ./
RUN pip install --upgrade pip && pip install .

COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

RUN useradd --create-home --uid 1000 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8000/api/health || exit 1

ENTRYPOINT ["./entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
