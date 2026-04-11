# Web API (FastAPI)

HTTP API layer serving the React frontend. Delegates business logic to `core/`.

**Never import from `discord_bot/`** - adapters should not communicate directly.

## Routes

| Route Module | Endpoints | Purpose |
|--------------|-----------|---------|
| `auth.py` | `/auth/*` | Discord OAuth, session management |
| `users.py` | `/api/users/*` | User profile endpoints |
| `cohorts.py` | `/api/cohorts/*` | Cohort management |
| `courses.py` | `/api/courses/*` | Course endpoints |
| `modules.py` | `/api/modules/*` | Module list endpoints |
| `module.py` | `/api/module/*` | Single module endpoints |
| `content.py` | `/api/content/*` | Educational content |
| `facilitator.py` | `/api/facilitator/*` | Facilitator-specific endpoints |
| `speech.py` | `/api/speech/*` | Text-to-speech endpoints |

## JWT Authentication

**Utilities in `web_api/auth.py`:**

```python
from web_api.auth import create_jwt, verify_jwt, get_current_user

# Create a token
token = create_jwt(user_id=123, discord_id="456")

# Verify a token
payload = verify_jwt(token)  # Returns None if invalid

# FastAPI dependency for protected routes
@router.get("/protected")
async def protected_route(user = Depends(get_current_user)):
    return {"user_id": user.id}
```

## Creating a New Route

1. Create `web_api/routes/my_route.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from web_api.auth import get_current_user
from core import my_business_function

router = APIRouter(prefix="/api/my-feature", tags=["my-feature"])

@router.get("/")
async def list_items(user = Depends(get_current_user)):
    return await my_business_function(user.id)

@router.post("/")
async def create_item(data: MyModel, user = Depends(get_current_user)):
    return await create_something(user.id, data)
```

2. Import and include in root `main.py`:

```python
from web_api.routes import my_route
app.include_router(my_route.router)
```

## Common Patterns

**Public endpoint (no auth):**
```python
@router.get("/public")
async def public_endpoint():
    return {"status": "ok"}
```

**Optional auth:**
```python
from web_api.auth import get_optional_user

@router.get("/maybe-auth")
async def maybe_auth_endpoint(user = Depends(get_optional_user)):
    if user:
        return {"logged_in": True, "user_id": user.id}
    return {"logged_in": False}
```

**Error responses:**
```python
from fastapi import HTTPException

@router.get("/item/{id}")
async def get_item(id: int):
    item = await fetch_item(id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item
```

## Testing

```bash
pytest web_api/tests/
```

## Standalone Mode (Legacy)

The API can run standalone via `cd web_api && python main.py`, but the unified mode (`python main.py` from root) is preferred.
