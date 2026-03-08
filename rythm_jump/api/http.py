"""HTTP-only helpers such as the health check router."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
def health() -> dict[str, bool]:
    """Return the current service health state."""
    return {"ok": True}
