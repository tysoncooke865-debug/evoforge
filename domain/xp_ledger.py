"""Read and append the `xp_events` ledger (migrations/002).

`domain/xp.py` stays pure -- it knows the curve and nothing else. This module is
the seam where the curve meets the database, and it is deliberately forgiving:

  * `ledger_xp()` returns None whenever the ledger cannot be read, and None means
    "fall back to derived", not "zero XP". Reading a missing table as 0 would drop
    every user to their base level the moment this shipped ahead of the migration.
  * `record_xp_event()` never raises and never blocks a save. A workout the user
    performed must be stored even if its XP grant fails; the backfill in
    `migrations/002` STEP 3 is re-runnable and will pick up the orphan.

Idempotence is enforced by Postgres, not here: the partial unique index on
(user_id, source_table, source_id) makes a repeated grant for the same source row
a no-op. That is why every grant carries the source row's `id`.
"""
import math

from data.sb_ops import sb_insert, sb_rpc
from domain.xp import XP_PER_CARDIO_MINUTE, XP_PER_SET


def ledger_available():
    """True when `xp_events` can be read. False before migrations/002 is applied."""
    return ledger_xp() is not None


def ledger_xp():
    """Sum of this user's xp_events, or None if the ledger cannot be read.

    Summed in Postgres by `public.xp_total()` (migrations/003), so the row count is
    irrelevant. The old client-side version read through `sb_select`, capped at 2500
    rows, and silently UNDERCOUNTED any user past that -- dropping their level. See
    CLAUDE.md problem #13.

    ############################################################################
    #  RETURNS None ON ANY FAILURE, NEVER 0.                                   #
    #  `resolve_xp` reads None as "fall back to the derived recount" and 0 as  #
    #  "the ledger is genuinely empty" (negative drift). That distinction is   #
    #  load-bearing and pinned by tools/verify_xp.py section 7. A failure read  #
    #  as 0 would drop every user to their base level -- exactly the bug this   #
    #  file was written to avoid.                                              #
    ############################################################################

    None covers: migrations/003 not applied yet, a permission error, a transport
    failure, or a non-numeric result.
    """
    data, err = sb_rpc("xp_total")
    if err or data is None:
        return None
    try:
        return int(data)
    except (TypeError, ValueError):
        return None


def record_xp_event(kind, amount, source_table=None, source_id=None, created_at=None):
    """Append one grant. Returns True on success; never raises.

    `user_id` is deliberately absent from the payload: Postgres fills it from
    `DEFAULT auth.uid()`, and `with check (user_id = auth.uid())` is what stops a
    user minting XP into someone else's account.
    """
    try:
        amount = int(amount)
    except (TypeError, ValueError):
        return False
    if amount == 0:                      # `check (amount <> 0)` would reject it
        return False
    if source_table is not None and source_id is None:
        # A grant that names a source row but cannot identify it is not idempotent:
        # the unique index is partial on `source_id is not null`. Refuse it.
        return False

    row = {"kind": str(kind), "amount": amount}
    if source_table is not None:
        row["source_table"] = str(source_table)
        row["source_id"] = str(source_id)
    if created_at is not None:
        row["created_at"] = str(created_at)

    ok, _err = sb_insert("xp_events", row)
    return bool(ok)


def record_set_event(workout_log_id, created_at=None):
    """One working set, granted once, keyed to its workout_log row."""
    return record_xp_event("set", XP_PER_SET, "workout_log", workout_log_id, created_at)


def cardio_event_amount(minutes):
    """XP for a cardio session. Pure, so `tools/verify_xp.py` can pin it.

    Mirrors migrations/002 STEP 3 exactly: `floor(minutes * 2)::int`, and zero when
    that rounds to nothing. Diverge from that literal and the backfill and the live
    path disagree -- which is precisely the drift STEP 4 exists to catch, months
    later, against real user data.
    """
    try:
        amount = math.floor(float(minutes) * XP_PER_CARDIO_MINUTE)
    except (TypeError, ValueError):
        return 0
    return max(0, int(amount))


def record_cardio_event(cardio_log_id, minutes, created_at=None):
    """Cardio minutes, granted once, keyed to its cardio_log row."""
    amount = cardio_event_amount(minutes)
    if amount <= 0:
        return False
    return record_xp_event("cardio", amount, "cardio_log", cardio_log_id, created_at)
