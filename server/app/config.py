from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    secret_key: str = "dev-secret-change-in-production"
    database_url: str = "sqlite:///./screen_ping.db"
    cors_origins: str = "http://localhost:5173,http://localhost:5174"
    upload_dir: str = "uploads"
    max_image_bytes: int = 25 * 1024 * 1024
    max_video_bytes: int = 50 * 1024 * 1024
    max_audio_bytes: int = 10 * 1024 * 1024
    max_avatar_bytes: int = 2 * 1024 * 1024
    avatar_max_px: int = 384
    avatar_webp_quality: int = 80
    max_batch_receivers: int = 20
    send_rate_limit: int = 10
    access_token_expire_minutes: int = 480
    refresh_token_expire_days: int = 30
    media_ttl_hours: int = 1
    verification_code_expire_minutes: int = 15
    verification_rate_limit_per_hour: int = 5
    reset_password_attempt_limit: int = 10
    reset_password_attempt_window_minutes: int = 15
    max_pending_pings_per_receiver: int = 3
    pending_ping_ttl_seconds: int = 60
    max_caption_length: int = 500
    login_attempt_limit_per_ip: int = 30
    login_attempt_limit_per_user: int = 10
    login_attempt_window_minutes: int = 15
    upload_rate_limit_per_minute: int = 10
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_use_tls: bool = True
    email_dev_expose_codes: bool = False
    terms_version: str = "2026-07-08"
    google_client_id: str = ""
    desktop_link_expire_minutes: int = 5
    enable_api_docs: bool = False
    auth_cookie_secure: bool = False

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    class Config:
        env_file = ".env"


settings = Settings()
