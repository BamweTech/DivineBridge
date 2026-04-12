/**
 * Mirrors qa_wall_filters.py — hide QA / production-test wall posts on the client.
 */

const PRODUCTION_TEST_TITLE = 'Production Test Testimony';
const PRODUCTION_TEST_MARKER = 'test testimony for production readiness.';
const PRODUCTION_TEST_USER_ID = 'test-user-123';

export function isHiddenProductionTestWallItem(item: Record<string, unknown> | null | undefined): boolean {
  if (!item || typeof item !== 'object') return false;
  const title = String(item.title ?? '').trim();
  const titleLower = title.toLowerCase();
  const content = String(item.content ?? '').toLowerCase();
  const uid = String(item.user_id ?? '').trim();
  if (title === PRODUCTION_TEST_TITLE) return true;
  if (titleLower.includes('production test testimony')) return true;
  if (content.includes(PRODUCTION_TEST_MARKER)) return true;
  if (uid === PRODUCTION_TEST_USER_ID) return true;
  return false;
}
