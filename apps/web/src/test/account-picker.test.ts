import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Sign-in, after two rounds of getting it wrong.
 *
 * Round one enumerated `AccountManager.getAccountsByType("com.google")` and drew a list. That cannot
 * work: on Android 8+ Google stopped letting ordinary apps enumerate its accounts (the call returns
 * an empty array even when the phone has three), and `GET_ACCOUNTS` — the permission the old code
 * demanded — is not even visible under that name. Settings files it under **Contacts**, which is what
 * the user's screenshots showed: an "Accounts on this device" row that does not exist, and a
 * "Contacts: Not allowed" row next to it.
 *
 * The fix is the system account picker: the OS draws the list, shows every signed-in Google account,
 * requires no permission, and hands back the one that was tapped.
 */
describe('account sign-in', () => {
  const plugin = readFileSync(
    resolve(__dirname, '../../../android/android/app/src/main/java/app/themashup/music/auth/AccountPlugin.kt'),
    'utf8',
  );
  const manifest = readFileSync(
    resolve(__dirname, '../../../android/android/app/src/main/AndroidManifest.xml'),
    'utf8',
  );
  const settings = readFileSync(resolve(__dirname, '../components/settings/SettingsScreen.tsx'), 'utf8');

  it('uses the system picker', () => {
    expect(plugin).toContain('newChooseAccountIntent');
    expect(plugin).toContain('startActivityForResult');
  });

  it('no longer claims it can enumerate accounts itself', () => {
    // The old approach; it silently returns nothing on a modern Android.
    expect(plugin).not.toContain('getAccountsByTypeAndFeatures');
  });

  it('drops the permission that only produced a confusing Contacts row', () => {
    expect(manifest).not.toContain('GET_ACCOUNTS');
    expect(plugin).not.toContain('requestAccountsPermission');
  });

  it('reports a cancelled picker instead of dead-ending', () => {
    // A rejected promise here would surface as an error for "the user changed their mind".
    expect(plugin).toContain('RESULT_OK');
    expect(plugin).toContain('"cancelled"');
  });

  it('harvests the cookie without needing the web player to load', () => {
    /*
     * The old hook only acted on a music.youtube.com page, so the user was carried through YouTube's
     * whole web app boot before the dialog closed — the "it opens YT Music and does not come back"
     * complaint. The cookie is minted by Google's consent page, so the harvest has to happen there.
     */
    const onPageFinished = plugin.slice(plugin.indexOf('override fun onPageFinished'));
    const body = onPageFinished.slice(0, onPageFinished.indexOf('val dialog = Dialog'));
    // The guard must not exclude the accounts host any more.
    expect(body).not.toContain('!finished.startsWith("https://accounts.google.com")');
  });

  it('offers one sign-in button plus an explicit fallback, not a second list', () => {
    expect(settings).toContain('Sign in with Google');
    expect(settings).toContain('nativePickAccount');
    // The hand-drawn list is gone.
    expect(settings).not.toContain('accounts.map(');
  });
});
