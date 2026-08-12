# Test Plan: Dashboard DM unread badge fix (PR #1)

Change under test (dashboard.html only, commit 6eda6cf):
- `Stats.fetchDmUnreadCount` (dashboard.html:1139) now counts `private_messages` where `recipient_id = currentUser.id` and `read_at is null` (was querying nonexistent `direct_messages`/`dm_reads` tables → always errored → badge stuck at 0).
- `setNavBadge` (dashboard.html:1082) now also toggles `el.style.display` inline (`inline-block`/`none`) so it can't be overridden by global-notifications.js's inline styles.
- Dashboard refreshes badges every 10s poll + on `visibilitychange`.

Environment: static app served at http://localhost:8000, live Supabase backend. Two accounts: User A (receiver, observed in dashboard) and User B (sender).

## Test 1: Badge shows correct nonzero unread DM count
1. In browser profile/tab 1, log in as User A; in tab/window 2 (separate profile or incognito), log in as User B.
2. Note User A's dashboard "Direct Messages" badge starting state (expect hidden/0 if no unread DMs).
3. As User B, open dm.html, select User A's conversation, send 2 distinct messages ("badge test 1", "badge test 2"). User A must NOT have dm.html open to that convo (stay on dashboard or reload dashboard after).
4. Switch to User A's dashboard tab (visibilitychange triggers refresh; or wait ≤10s).
   - PASS: `#globalDmUnreadBadge` next to "Direct Messages" is visible and shows exactly **2** (or starting_unread + 2).
   - FAIL: badge shows 0, stays hidden, or shows wrong count.
5. Cross-check: open dm.html as User A briefly WITHOUT clicking the conversation — sidebar unread count for User B's convo should also show 2, matching the dashboard badge.

## Test 2: Badge clears after reading the DM
1. As User A, open dm.html and click User B's conversation (this updates `read_at` on the unread rows, dm.html:2613).
2. Navigate back to dashboard.html (fresh load or tab switch; poll ≤10s).
   - PASS: badge hidden (display:none) — not a visible "0", not the stale "2".
   - FAIL: badge still shows 2 or a visible "0" chip remains.

## Test 3 (Regression): Group "Messages" badge unaffected
1. Observe the group-chat sidebar badge (`#sidebarUnreadBadge`) on User A's dashboard before/after the DM steps.
   - PASS: its value only reflects unread group_messages and does not change when DMs are sent/read.

Recording: annotate each test with test_start/assertion.
