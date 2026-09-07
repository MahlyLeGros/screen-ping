from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    accept_terms: bool = False


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=255)
    password: str
    remember_me: bool = True


class RefreshRequest(BaseModel):
    refresh_token: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str | None = None
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: str
    username: str
    email: str
    avatar_url: str | None = None
    created_at: datetime
    terms_accepted_at: datetime | None = None
    terms_accepted_version: str | None = None
    current_terms_version: str | None = None
    needs_terms_acceptance: bool = False
    is_desktop_online: bool = False
    desktop_version: str | None = None

    class Config:
        from_attributes = True


class FriendRequestCreate(BaseModel):
    username: str


class FriendResponse(BaseModel):
    id: str
    user_id: str
    username: str
    avatar_url: str | None = None
    status: str
    is_online: bool = False
    last_active_at: datetime | None = None
    direction: Literal["incoming", "outgoing", "accepted", "blocked"]


class UploadResponse(BaseModel):
    message_id: str
    receiver_id: str
    media_type: str
    media_url: str
    audio_url: str | None = None


class BatchUploadResponse(BaseModel):
    uploads: list[UploadResponse]


class SendMessageRequest(BaseModel):
    receiver_id: str
    message_id: str
    duration_ms: int = 3000


class HistoryLayerItem(BaseModel):
    url: str
    name: str = "layer"
    mime: str | None = None
    layout: dict
    opacity: float = 1
    zIndex: int = 0


class MessageHistoryItem(BaseModel):
    id: str
    receiver_username: str
    media_type: str
    media_url: str
    audio_url: str | None = None
    caption: str | None = None
    delivery_status: str
    created_at: datetime
    layers: list[HistoryLayerItem] | None = None

    class Config:
        from_attributes = True


class OkResponse(BaseModel):
    ok: bool = True
    message: str = ""


class VerificationRequestResponse(OkResponse):
    dev_code: str | None = None
    email: str | None = None
    username: str | None = None
    needs_verification: bool = False


class VerifyEmailRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")
    remember_me: bool = True


class ResendSignupCodeRequest(BaseModel):
    email: EmailStr


class AuthProvidersResponse(BaseModel):
    google_client_id: str | None = None


class GoogleAuthRequest(BaseModel):
    credential: str = Field(min_length=20)
    username: str | None = Field(default=None, max_length=50)
    accept_terms: bool = False
    remember_me: bool = True


class GoogleAuthResponse(BaseModel):
    access_token: str | None = None
    refresh_token: str | None = None
    token_type: str = "bearer"
    needs_username: bool = False
    suggested_username: str | None = None
    email: str | None = None


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")
    new_password: str = Field(min_length=6, max_length=128)
    remember_me: bool = True


class RequestVerificationRequest(BaseModel):
    purpose: Literal["change_password", "change_username"]


class ChangeUsernameRequest(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    verification_code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6, max_length=128)
    verification_code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class AcceptLegalRequest(BaseModel):
    accept_terms: bool = True


class DeleteAccountRequest(BaseModel):
    current_password: str


class DesktopLinkStartResponse(BaseModel):
    pairing_id: str
    poll_secret: str
    expires_in: int


class DesktopLinkPairingRequest(BaseModel):
    pairing_id: str = Field(min_length=8, max_length=64)


class DesktopLinkPollRequest(BaseModel):
    pairing_id: str = Field(min_length=8, max_length=64)
    poll_secret: str = Field(min_length=8, max_length=128)


class DesktopLinkPollResponse(BaseModel):
    status: Literal["pending", "ready", "expired", "denied"]
    access_token: str | None = None
    refresh_token: str | None = None
    token_type: str = "bearer"
