from fastapi import APIRouter
from pydantic import BaseModel

from app.core.config import get_settings
from app.services.health import get_health_status

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: str
    app: str
    environment: str
    supabase_configured: bool


@router.get("/health", response_model=HealthResponse)
def health_check() -> HealthResponse:
    settings = get_settings()
    health = get_health_status(settings)
    return HealthResponse(**health)

