/**
 * line.js — the one piece of LINE profile data the enrolment message needs.
 *
 * The Messaging API's webhook event carries a userId but not a display
 * name; getting the name means a second call to LINE's profile endpoint
 * with the channel's own access token (distinct from the channel secret
 * used to verify webhook signatures).
 */

const LINE_API = 'https://api.line.me';

/**
 * Best-effort: a profile lookup failing (LINE having a bad moment, a user
 * who has since blocked the OA) should not stop the enrolment notification
 * from going out — it should just go out with a blank second line rather
 * than never arriving at all.
 */
export async function getLineDisplayName(userId, channelAccessToken) {
  try {
    const r = await fetch(`${LINE_API}/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${channelAccessToken}` },
    });
    if (!r.ok) return null;
    const { displayName } = await r.json();
    return typeof displayName === 'string' ? displayName : null;
  } catch {
    return null;
  }
}
