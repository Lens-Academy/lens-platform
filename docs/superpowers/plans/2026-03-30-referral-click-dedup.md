# Referral Click Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deduplicate referral clicks using the existing `ref` cookie, record the visitor's cookie consent state at click time, and retroactively update that state when the visitor makes their cookie banner choice.

**Architecture:**
- Add a `consent_state` column (`'accepted'`/`'declined'`/`'pending'`) to `referral_clicks`
- `log_click` returns the new `click_id`; the redirect URL includes it as a query param
- Frontend stores `click_id` in sessionStorage alongside `ref`
- When the cookie banner fires (accept or decline), frontend calls `PATCH /api/referral-clicks/{click_id}/consent` to update the click's consent_state
- Dedup: skip logging when the visitor's `ref` cookie already matches the clicked slug

**Tech Stack:** Python, FastAPI, SQLAlchemy Core, Alembic, pytest, TypeScript/React

---

### Task 1: Add `consent_state` column and update `log_click` to return click_id

**Files:**
- Modify: `core/tables.py:619-631` (referral_clicks table definition)
- Modify: `core/referrals.py:248-250` (log_click function)
- Modify: `core/tests/test_referrals.py` (add tests)

- [ ] **Step 1: Write the failing tests**

In `core/tests/test_referrals.py`, add `referral_clicks` to the existing import from `core.tables`:

```python
from core.tables import (
    cohorts,
    groups,
    groups_users,
    referral_clicks,
    referral_links,
    signups,
    users,
)
```

Then add two test classes after the existing `TestLogClick` class:

```python
class TestLogClickConsentState:
    @pytest.mark.asyncio
    async def test_log_click_records_consent_accepted(self, db_conn, test_user):
        link = await create_default_link(db_conn, test_user, "Consent Test")
        await log_click(db_conn, link["link_id"], consent_state="accepted")
        row = await db_conn.execute(
            select(referral_clicks.c.consent_state).where(
                referral_clicks.c.link_id == link["link_id"]
            )
        )
        assert row.scalar() == "accepted"

    @pytest.mark.asyncio
    async def test_log_click_records_consent_declined(self, db_conn, test_user):
        link = await create_default_link(db_conn, test_user, "Consent Test")
        await log_click(db_conn, link["link_id"], consent_state="declined")
        row = await db_conn.execute(
            select(referral_clicks.c.consent_state).where(
                referral_clicks.c.link_id == link["link_id"]
            )
        )
        assert row.scalar() == "declined"

    @pytest.mark.asyncio
    async def test_log_click_records_consent_pending(self, db_conn, test_user):
        link = await create_default_link(db_conn, test_user, "Consent Test")
        await log_click(db_conn, link["link_id"], consent_state="pending")
        row = await db_conn.execute(
            select(referral_clicks.c.consent_state).where(
                referral_clicks.c.link_id == link["link_id"]
            )
        )
        assert row.scalar() == "pending"

    @pytest.mark.asyncio
    async def test_log_click_defaults_to_pending(self, db_conn, test_user):
        link = await create_default_link(db_conn, test_user, "Consent Test")
        await log_click(db_conn, link["link_id"])
        row = await db_conn.execute(
            select(referral_clicks.c.consent_state).where(
                referral_clicks.c.link_id == link["link_id"]
            )
        )
        assert row.scalar() == "pending"


class TestLogClickReturnsClickId:
    @pytest.mark.asyncio
    async def test_log_click_returns_click_id(self, db_conn, test_user):
        link = await create_default_link(db_conn, test_user, "Return Test")
        click_id = await log_click(db_conn, link["link_id"])
        assert isinstance(click_id, int)

    @pytest.mark.asyncio
    async def test_log_click_returns_unique_ids(self, db_conn, test_user):
        link = await create_default_link(db_conn, test_user, "Return Test")
        id1 = await log_click(db_conn, link["link_id"])
        id2 = await log_click(db_conn, link["link_id"])
        assert id1 != id2
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest core/tests/test_referrals.py::TestLogClickConsentState core/tests/test_referrals.py::TestLogClickReturnsClickId -v`
Expected: FAIL — `log_click()` doesn't accept `consent_state` or return a value yet.

- [ ] **Step 3: Add the column to the table definition**

In `core/tables.py`, replace the existing `referral_clicks` table definition:

```python
referral_clicks = Table(
    "referral_clicks",
    metadata,
    Column("click_id", Integer, primary_key=True, autoincrement=True),
    Column(
        "link_id",
        Integer,
        ForeignKey("referral_links.link_id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("clicked_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column(
        "consent_state",
        Text,
        CheckConstraint(
            "consent_state IN ('accepted', 'declined', 'pending')",
            name="consent_state_values",
        ),
        nullable=False,
        server_default=text("'pending'"),
    ),
    Index("idx_referral_clicks_link_id", "link_id"),
)
```

- [ ] **Step 4: Update `log_click()` to accept `consent_state` and return `click_id`**

In `core/referrals.py`, replace the existing `log_click` function:

```python
async def log_click(
    conn: AsyncConnection, link_id: int, *, consent_state: str = "pending"
) -> int:
    """Record a click on a referral link.

    consent_state: 'accepted' (cookies on, dedup active), 'declined' (user
    rejected cookies), or 'pending' (new visitor, no choice yet).

    Returns the click_id of the new row.
    """
    result = await conn.execute(
        insert(referral_clicks)
        .values(link_id=link_id, consent_state=consent_state)
        .returning(referral_clicks.c.click_id)
    )
    return result.scalar()
```

- [ ] **Step 5: Generate the Alembic migration**

Run: `.venv/bin/alembic revision --autogenerate -m "add consent_state to referral_clicks"`

Review the generated migration. It should add the column and check constraint.

- [ ] **Step 6: Run the migration**

Run: `.venv/bin/alembic upgrade head`

- [ ] **Step 7: Run tests to verify they pass**

Run: `.venv/bin/pytest core/tests/test_referrals.py::TestLogClickConsentState core/tests/test_referrals.py::TestLogClickReturnsClickId core/tests/test_referrals.py::TestLogClick -v`
Expected: All pass. Existing `TestLogClick` still works because `consent_state` defaults to `"pending"`.

- [ ] **Step 8: Commit**

```
feat: add consent_state to referral_clicks, return click_id from log_click

Records the visitor's marketing cookie consent state at click time.
log_click now returns the click_id so the frontend can update the
consent_state retroactively when the visitor makes their cookie choice.
```

---

### Task 2: Add cookie-based dedup and click_id in redirect URL

**Files:**
- Modify: `web_api/routes/ref.py`
- Modify: `web_api/tests/test_ref_click.py`

- [ ] **Step 1: Write the failing tests**

In `web_api/tests/test_ref_click.py`, add new tests to the existing `TestRefClick` class:

```python
    @patch("web_api.routes.ref.get_transaction", return_value=_fake_transaction())
    @patch("web_api.routes.ref.log_click", new_callable=AsyncMock)
    @patch("web_api.routes.ref.get_link_by_slug", new_callable=AsyncMock)
    def test_dedup_skips_click_when_cookie_matches_slug(
        self, mock_get_link, mock_log_click, mock_txn
    ):
        """If ref cookie already matches the clicked slug, don't log a click."""
        mock_get_link.return_value = MOCK_LINK
        response = client.get(
            "/ref/kate-smith",
            cookies={"marketing-consent": "accepted", "ref": "kate-smith"},
        )
        assert response.status_code == 302
        assert "click_id" not in response.headers["location"]
        mock_log_click.assert_not_called()

    @patch("web_api.routes.ref.get_transaction", return_value=_fake_transaction())
    @patch("web_api.routes.ref.log_click", new_callable=AsyncMock)
    @patch("web_api.routes.ref.get_link_by_slug", new_callable=AsyncMock)
    def test_logs_click_when_cookie_has_different_slug(
        self, mock_get_link, mock_log_click, mock_txn
    ):
        """If ref cookie exists but for a different slug, log with accepted."""
        mock_get_link.return_value = MOCK_LINK
        mock_log_click.return_value = 99
        response = client.get(
            "/ref/kate-smith",
            cookies={"marketing-consent": "accepted", "ref": "someone-else"},
        )
        assert response.status_code == 302
        mock_log_click.assert_called_once_with(None, 42, consent_state="accepted")
        assert "click_id=99" in response.headers["location"]

    @patch("web_api.routes.ref.get_transaction", return_value=_fake_transaction())
    @patch("web_api.routes.ref.log_click", new_callable=AsyncMock)
    @patch("web_api.routes.ref.get_link_by_slug", new_callable=AsyncMock)
    def test_logs_click_with_consent_pending_when_no_choice(
        self, mock_get_link, mock_log_click, mock_txn
    ):
        """New visitor with no cookie banner choice yet: consent_state='pending'."""
        mock_get_link.return_value = MOCK_LINK
        mock_log_click.return_value = 77
        response = client.get("/ref/kate-smith")
        assert response.status_code == 302
        mock_log_click.assert_called_once_with(None, 42, consent_state="pending")
        assert "click_id=77" in response.headers["location"]

    @patch("web_api.routes.ref.get_transaction", return_value=_fake_transaction())
    @patch("web_api.routes.ref.log_click", new_callable=AsyncMock)
    @patch("web_api.routes.ref.get_link_by_slug", new_callable=AsyncMock)
    def test_logs_click_with_consent_declined(
        self, mock_get_link, mock_log_click, mock_txn
    ):
        """User who explicitly declined cookies: consent_state='declined'."""
        mock_get_link.return_value = MOCK_LINK
        mock_log_click.return_value = 88
        response = client.get(
            "/ref/kate-smith",
            cookies={"marketing-consent": "declined"},
        )
        assert response.status_code == 302
        mock_log_click.assert_called_once_with(None, 42, consent_state="declined")
        assert "click_id=88" in response.headers["location"]

    @patch("web_api.routes.ref.get_transaction", return_value=_fake_transaction())
    @patch("web_api.routes.ref.log_click", new_callable=AsyncMock)
    @patch("web_api.routes.ref.get_link_by_slug", new_callable=AsyncMock)
    def test_no_click_id_for_invalid_slug(
        self, mock_get_link, mock_log_click, mock_txn
    ):
        """Invalid slugs redirect without click_id."""
        mock_get_link.return_value = None
        response = client.get("/ref/nonexistent")
        assert response.status_code == 302
        assert "click_id" not in response.headers["location"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest web_api/tests/test_ref_click.py -v`
Expected: New tests FAIL.

- [ ] **Step 3: Implement the dedup logic and click_id redirect**

Replace the contents of `web_api/routes/ref.py`:

```python
"""Public referral link click handler."""

from urllib.parse import quote, urlencode

from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse

from core.database import get_transaction
from core.referrals import get_link_by_slug, log_click

router = APIRouter(tags=["referral"])

MARKETING_CONSENT_COOKIE = "marketing-consent"


def _consent_state(request: Request) -> str:
    """Derive the visitor's marketing consent state from cookies."""
    value = request.cookies.get(MARKETING_CONSENT_COOKIE)
    if value == "accepted":
        return "accepted"
    if value == "declined":
        return "declined"
    return "pending"


@router.get("/ref/{slug}")
async def referral_click(slug: str, request: Request):
    """
    Handle a referral link click.

    Logs the click (unless deduplicated by cookie), optionally sets a ref
    cookie (if marketing consent granted), and redirects to /?ref=<slug>.

    The redirect includes click_id so the frontend can retroactively update
    consent_state when the visitor makes their cookie banner choice.

    Invalid slugs still redirect to / (prevents slug enumeration).
    """
    link = None
    click_id = None
    consent = _consent_state(request)
    existing_ref_cookie = request.cookies.get("ref")

    async with get_transaction() as conn:
        link = await get_link_by_slug(conn, slug)
        if link:
            # Dedup: skip if the visitor already has a ref cookie for this exact slug
            if consent == "accepted" and existing_ref_cookie == slug:
                pass  # Same browser, same link — don't inflate click count
            else:
                click_id = await log_click(
                    conn, link["link_id"], consent_state=consent
                )

    # Build redirect URL with ref and optional click_id
    params = {"ref": slug}
    if click_id is not None:
        params["click_id"] = str(click_id)
    response = RedirectResponse(url=f"/?{urlencode(params)}", status_code=302)

    # Set ref cookie if visitor has granted marketing consent
    if link and consent == "accepted":
        is_secure = request.url.scheme == "https"
        response.set_cookie(
            key="ref",
            value=slug,
            max_age=90 * 24 * 60 * 60,  # 90 days
            httponly=True,
            secure=is_secure,
            samesite="lax",
            path="/",
        )

    return response
```

- [ ] **Step 4: Update the existing test assertions**

The existing `test_valid_slug_redirects_and_logs_click` now needs to account for `consent_state` and `click_id`. Update it:

```python
    @patch("web_api.routes.ref.get_transaction", return_value=_fake_transaction())
    @patch("web_api.routes.ref.log_click", new_callable=AsyncMock)
    @patch("web_api.routes.ref.get_link_by_slug", new_callable=AsyncMock)
    def test_valid_slug_redirects_and_logs_click(
        self, mock_get_link, mock_log_click, mock_txn
    ):
        mock_get_link.return_value = MOCK_LINK
        mock_log_click.return_value = 1
        response = client.get("/ref/kate-smith")
        assert response.status_code == 302
        assert "ref=kate-smith" in response.headers["location"]
        assert "click_id=1" in response.headers["location"]
        mock_log_click.assert_called_once_with(None, 42, consent_state="pending")
```

- [ ] **Step 5: Run all ref click tests**

Run: `.venv/bin/pytest web_api/tests/test_ref_click.py -v`
Expected: All pass.

- [ ] **Step 6: Commit**

```
feat: add cookie-based referral click deduplication with click_id in redirect

Skip logging when ref cookie matches slug. Include click_id in the
redirect URL so the frontend can retroactively update consent_state.
```

---

### Task 3: Add consent update endpoint

**Files:**
- Add: `core/referrals.py` (new function `update_click_consent`)
- Add: `web_api/routes/ref.py` (new PATCH endpoint)
- Add: `core/tests/test_referrals.py` (tests for new function)
- Add: `web_api/tests/test_ref_click.py` (tests for new endpoint)

- [ ] **Step 1: Write the failing test for the core function**

In `core/tests/test_referrals.py`, add `update_click_consent` to the import from `core.referrals` and add a test class:

```python
class TestUpdateClickConsent:
    @pytest.mark.asyncio
    async def test_updates_pending_to_accepted(self, db_conn, test_user):
        link = await create_default_link(db_conn, test_user, "Update Test")
        click_id = await log_click(db_conn, link["link_id"], consent_state="pending")
        updated = await update_click_consent(db_conn, click_id, "accepted")
        assert updated is True
        row = await db_conn.execute(
            select(referral_clicks.c.consent_state).where(
                referral_clicks.c.click_id == click_id
            )
        )
        assert row.scalar() == "accepted"

    @pytest.mark.asyncio
    async def test_updates_pending_to_declined(self, db_conn, test_user):
        link = await create_default_link(db_conn, test_user, "Update Test")
        click_id = await log_click(db_conn, link["link_id"], consent_state="pending")
        updated = await update_click_consent(db_conn, click_id, "declined")
        assert updated is True
        row = await db_conn.execute(
            select(referral_clicks.c.consent_state).where(
                referral_clicks.c.click_id == click_id
            )
        )
        assert row.scalar() == "declined"

    @pytest.mark.asyncio
    async def test_does_not_update_already_resolved(self, db_conn, test_user):
        link = await create_default_link(db_conn, test_user, "Update Test")
        click_id = await log_click(db_conn, link["link_id"], consent_state="accepted")
        updated = await update_click_consent(db_conn, click_id, "declined")
        assert updated is False
        row = await db_conn.execute(
            select(referral_clicks.c.consent_state).where(
                referral_clicks.c.click_id == click_id
            )
        )
        assert row.scalar() == "accepted"  # unchanged

    @pytest.mark.asyncio
    async def test_nonexistent_click_id(self, db_conn):
        updated = await update_click_consent(db_conn, 999999, "accepted")
        assert updated is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest core/tests/test_referrals.py::TestUpdateClickConsent -v`
Expected: FAIL — `update_click_consent` doesn't exist yet.

- [ ] **Step 3: Implement `update_click_consent` in core**

In `core/referrals.py`, add after the existing `log_click` function:

```python
async def update_click_consent(
    conn: AsyncConnection, click_id: int, consent_state: str
) -> bool:
    """Update consent_state on a click, but only if it's still 'pending'.

    Returns True if the row was updated, False if it was already resolved
    or the click_id doesn't exist.
    """
    result = await conn.execute(
        update(referral_clicks)
        .where(
            and_(
                referral_clicks.c.click_id == click_id,
                referral_clicks.c.consent_state == "pending",
            )
        )
        .values(consent_state=consent_state)
    )
    return result.rowcount > 0
```

- [ ] **Step 4: Run core tests to verify they pass**

Run: `.venv/bin/pytest core/tests/test_referrals.py::TestUpdateClickConsent -v`
Expected: All pass.

- [ ] **Step 5: Write the failing test for the API endpoint**

In `web_api/tests/test_ref_click.py`, add a new test class:

```python
class TestClickConsentUpdate:
    @patch("web_api.routes.ref.get_transaction", return_value=_fake_transaction())
    @patch("web_api.routes.ref.update_click_consent", new_callable=AsyncMock)
    def test_update_consent_accepted(self, mock_update, mock_txn):
        mock_update.return_value = True
        response = client.patch(
            "/ref/clicks/123/consent",
            json={"consent_state": "accepted"},
        )
        assert response.status_code == 200
        assert response.json() == {"updated": True}
        mock_update.assert_called_once_with(None, 123, "accepted")

    @patch("web_api.routes.ref.get_transaction", return_value=_fake_transaction())
    @patch("web_api.routes.ref.update_click_consent", new_callable=AsyncMock)
    def test_update_consent_declined(self, mock_update, mock_txn):
        mock_update.return_value = True
        response = client.patch(
            "/ref/clicks/123/consent",
            json={"consent_state": "declined"},
        )
        assert response.status_code == 200
        mock_update.assert_called_once_with(None, 123, "declined")

    @patch("web_api.routes.ref.get_transaction", return_value=_fake_transaction())
    @patch("web_api.routes.ref.update_click_consent", new_callable=AsyncMock)
    def test_update_consent_already_resolved(self, mock_update, mock_txn):
        mock_update.return_value = False
        response = client.patch(
            "/ref/clicks/123/consent",
            json={"consent_state": "accepted"},
        )
        assert response.status_code == 200
        assert response.json() == {"updated": False}

    def test_update_consent_invalid_state(self):
        response = client.patch(
            "/ref/clicks/123/consent",
            json={"consent_state": "invalid"},
        )
        assert response.status_code == 422
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `.venv/bin/pytest web_api/tests/test_ref_click.py::TestClickConsentUpdate -v`
Expected: FAIL — endpoint doesn't exist yet.

- [ ] **Step 7: Add the endpoint to `web_api/routes/ref.py`**

Add the import for `update_click_consent` and the Pydantic model and endpoint at the bottom of the file:

```python
from core.referrals import get_link_by_slug, log_click, update_click_consent
```

```python
from enum import Enum
from pydantic import BaseModel


class ConsentChoice(str, Enum):
    accepted = "accepted"
    declined = "declined"


class ConsentUpdateRequest(BaseModel):
    consent_state: ConsentChoice


@router.patch("/ref/clicks/{click_id}/consent")
async def update_consent(click_id: int, body: ConsentUpdateRequest):
    """Update consent_state on a referral click (pending → accepted/declined).

    Called by the frontend when the visitor makes their cookie banner choice.
    Only updates clicks that are still 'pending'. Idempotent.
    """
    async with get_transaction() as conn:
        updated = await update_click_consent(conn, click_id, body.consent_state.value)
    return {"updated": updated}
```

- [ ] **Step 8: Run all ref click tests**

Run: `.venv/bin/pytest web_api/tests/test_ref_click.py -v`
Expected: All pass.

- [ ] **Step 9: Commit**

```
feat: add endpoint to retroactively update referral click consent state

PATCH /ref/clicks/{click_id}/consent updates pending clicks to
accepted or declined when the visitor makes their cookie banner choice.
```

---

### Task 4: Frontend — store click_id and send consent update

**Files:**
- Modify: `web_frontend/src/hooks/useAuth.ts:190-200` (store click_id from URL)
- Modify: `web_frontend/src/analytics.ts:281-301` (send consent update in optInMarketing/optOutMarketing)

- [ ] **Step 1: Store click_id in sessionStorage alongside ref**

In `web_frontend/src/hooks/useAuth.ts`, update the useEffect that reads `ref` from the URL (around line 190). Replace:

```typescript
    const urlRef = params.get("ref");
    if (urlRef) {
      sessionStorage.setItem("ref", urlRef);
      // Clean the URL — ref is now in sessionStorage, no need to show it
      params.delete("ref");
      const clean = params.toString();
      const newUrl = window.location.pathname + (clean ? `?${clean}` : "");
      window.history.replaceState({}, "", newUrl);
    }
```

With:

```typescript
    const urlRef = params.get("ref");
    if (urlRef) {
      sessionStorage.setItem("ref", urlRef);
      const clickId = params.get("click_id");
      if (clickId) {
        sessionStorage.setItem("ref_click_id", clickId);
      }
      // Clean the URL — ref and click_id are now in sessionStorage
      params.delete("ref");
      params.delete("click_id");
      const clean = params.toString();
      const newUrl = window.location.pathname + (clean ? `?${clean}` : "");
      window.history.replaceState({}, "", newUrl);
    }
```

- [ ] **Step 2: Add `updateClickConsent` helper to analytics.ts**

In `web_frontend/src/analytics.ts`, add a new function after the `syncMarketingConsentToServer` function:

```typescript
/**
 * Update the consent_state on a referral click (fire-and-forget).
 * Called when the visitor makes their cookie banner choice, if they
 * arrived via a referral link in this session.
 */
function updateClickConsent(choice: "accepted" | "declined"): void {
  const clickId = sessionStorage.getItem("ref_click_id");
  if (!clickId) return;
  // Clear immediately so we don't send twice
  sessionStorage.removeItem("ref_click_id");
  fetch(`${API_URL}/ref/clicks/${clickId}/consent`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ consent_state: choice }),
  }).catch(() => {
    // Fire-and-forget — click consent is best-effort
  });
}
```

- [ ] **Step 3: Call `updateClickConsent` from optInMarketing and optOutMarketing**

In `optInMarketing()`, add the call at the end of the function (after the existing ref cookie promotion logic):

```typescript
export function optInMarketing(): void {
  localStorage.setItem(MARKETING_CONSENT_KEY, "accepted");
  syncMarketingConsentToServer("accepted");
  // Set a cookie the server can read for the /ref route
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `marketing-consent=accepted; path=/; max-age=${90 * 24 * 60 * 60}; SameSite=Lax${secure}`;
  // If there's a pending referral in sessionStorage, promote it to a cookie
  // so attribution survives across sessions (e.g., user leaves and comes back later)
  const pendingRef = sessionStorage.getItem("ref");
  if (pendingRef) {
    document.cookie = `ref=${encodeURIComponent(pendingRef)}; path=/; max-age=${90 * 24 * 60 * 60}; SameSite=Lax${secure}`;
  }
  // Retroactively update the referral click's consent state
  updateClickConsent("accepted");
}
```

In `optOutMarketing()`, add the call at the end:

```typescript
export function optOutMarketing(): void {
  localStorage.setItem(MARKETING_CONSENT_KEY, "declined");
  syncMarketingConsentToServer("declined");
  document.cookie = "marketing-consent=declined; path=/; max-age=0";
  // Note: the ref cookie is HttpOnly (server-set) so it cannot be cleared from JS.
  // It will be ignored on next OAuth callback since marketing consent is declined.
  // Retroactively update the referral click's consent state
  updateClickConsent("declined");
}
```

- [ ] **Step 4: Run frontend lint**

Run: `cd web_frontend && npm run lint`
Expected: No errors.

- [ ] **Step 5: Run frontend build**

Run: `cd web_frontend && npm run build`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```
feat: frontend sends consent choice to update referral click state

Store click_id from the referral redirect URL in sessionStorage.
When the cookie banner fires, PATCH the click's consent_state from
'pending' to 'accepted' or 'declined'.
```

---

### Task 5: Run full test suite and verify

**Files:** None (verification only)

- [ ] **Step 1: Run all referral tests**

Run: `.venv/bin/pytest core/tests/test_referrals.py web_api/tests/test_ref_click.py web_api/tests/test_referrals_api.py -v`
Expected: All pass.

- [ ] **Step 2: Run full test suite**

Run: `.venv/bin/pytest`
Expected: All pass.

- [ ] **Step 3: Run all linting**

Run: `ruff check . && ruff format --check . && cd web_frontend && npm run lint && npm run build`
Expected: No errors.

- [ ] **Step 4: Commit any fixes if needed**

Only if linting or tests revealed issues.
