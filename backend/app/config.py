from pydantic import field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    APP_NAME: str = "CTEM Platform"
    DEBUG: bool = False

    # Database
    DB_HOST: str = "postgres"
    DB_PORT: int = 5432
    DB_USER: str = "ctem"
    DB_PASSWORD: str = ""
    DB_NAME: str = "ctem"

    @property
    def DATABASE_URL(self) -> str:
        return f"postgresql+asyncpg://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"

    # Redis / Celery
    REDIS_URL: str = "redis://redis:6379/0"
    CELERY_BROKER_URL: str = "redis://redis:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://redis:6379/2"

    # JWT
    JWT_SECRET: str = ""
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 480

    # Space API
    SPACE_API_BASE_URL: str = "https://space-api.example.com"
    SPACE_API_USERNAME: str = ""
    SPACE_API_PASSWORD: str = ""
    SPACE_API_KEY: str = ""
    SPACE_AUTH_TYPE: str = "rayspace"
    SPACE_ASSET_PATH: str = "api/asset/select/query"
    SPACE_VULNERABILITY_PATH: str = "api/v1/vulnerabilities"
    SPACE_VERIFY_TLS: bool = False
    SPACE_MOCK_MODE: bool = False

    # Runtime files
    STORAGE_DIR: str = "/tmp/ctem-storage"
    REPORT_DIR: str = "/tmp/ctem-storage/reports"

    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, value):
        if isinstance(value, str):
            value = value.strip()
            if not value:
                return []
            if value.startswith("["):
                return value
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()


def validate_required_settings() -> None:
    missing = []
    if not settings.DB_PASSWORD:
        missing.append("DB_PASSWORD")
    if not settings.JWT_SECRET:
        missing.append("JWT_SECRET")
    if missing:
        raise RuntimeError(f"Missing required environment variables: {', '.join(missing)}")
    if len(settings.JWT_SECRET) < 32:
        raise RuntimeError("JWT_SECRET must be at least 32 characters")
