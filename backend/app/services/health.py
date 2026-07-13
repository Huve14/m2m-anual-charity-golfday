from app.core.config import Settings


def get_health_status(settings: Settings) -> dict[str, str | bool]:
    return {
        "status": "ok",
        "app": settings.app_name,
        "environment": settings.environment,
        "supabase_configured": bool(settings.supabase_url and settings.supabase_anon_key),
    }

