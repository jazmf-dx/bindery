// In-app updates via tauri-plugin-updater (desktop-platform Distribution §4).
// stockroom の src/lib/update.ts から写し、トースト・設定画面とのやりとりを外して
// ダイアログだけにした（Bindery にはまだトーストも設定画面も無い）。
//
// The installers are not Apple / Windows code-signed, so a freshly downloaded
// .dmg / .exe triggers Gatekeeper / SmartScreen every time. Files written by the
// app itself carry no quarantine attribute, so an update applied from inside the
// app launches without that warning. Only the first install still shows it.
import { isTauri } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { api } from "./api";
import { warn } from "./log";

/** The name every update dialog starts from, so it's clear which app is asking. */
export const APP_NAME = "Bindery";

/**
 * アプリ内の更新を使うか。0.2.0 から使う（Bindery の署名鍵を作った。decisions/project-context.md「updater の鍵」）。
 * 0.1.0 は鍵が無く false で出したので、0.1.0 から 0.2.0 へは手で入れ直す。
 * false にするときは tauri.conf.json の `createUpdaterArtifacts` も false にする。
 */
export const UPDATES = true;

const isMac = navigator.userAgent.includes("Mac");

/**
 * The proxy the OS would use for the feed (PAC included). The updater's HTTP
 * client can't evaluate PAC scripts, so behind a company proxy it would try to
 * connect directly and fail. Undefined = direct.
 */
async function systemProxy(): Promise<string | undefined> {
  try {
    return (await api.systemProxy()) ?? undefined;
  } catch {
    return undefined;
  }
}

let busy = false;

/**
 * Check GitHub Releases for a newer version. `manual` reports "up to date" and
 * errors; the automatic startup check stays silent unless an update exists.
 */
export async function checkForUpdate(manual: boolean) {
  if (busy || !isTauri()) return;
  if (!UPDATES) {
    if (manual) {
      await message("この版はアプリの中での更新に対応していません。新しい版は GitHub の Releases から入れてください。", {
        title: APP_NAME,
        kind: "info",
      });
    }
    return;
  }
  busy = true;
  try {
    const update = await check({ timeout: 15_000, proxy: await systemProxy() });
    if (update) await offer(update);
    else if (manual) await message("最新版です", { title: APP_NAME, kind: "info" });
  } catch (e) {
    if (manual) await message(`アップデートを確認できませんでした。\n\n${String(e)}`, { title: APP_NAME, kind: "error" });
    else warn("update check failed", e);
  } finally {
    busy = false;
  }
}

const INSTALL = "更新して再起動";
const LATER = "あとで";
const NOTES = "更新内容を見る";

/** Asks whether to install. What changed is one click away on GitHub. */
async function offer(update: Update) {
  const choice = await message(
    `v${update.version} が使えます（今のバージョンは v${update.currentVersion}）。\n` +
      `更新すると ${APP_NAME} が再起動します。`,
    {
      title: `${APP_NAME} の新しいバージョンがあります`,
      kind: "info",
      // Each OS's order: macOS puts the default on the right with "later"
      // next to it, Windows puts the default first and "later" last.
      buttons: isMac ? { yes: INSTALL, no: LATER, cancel: NOTES } : { yes: INSTALL, no: NOTES, cancel: LATER },
    },
  );
  if (choice === INSTALL) await install(update);
  else if (choice === NOTES) api.openReleasePage(update.version).catch((e) => warn("release page", e));
}

async function install(update: Update) {
  try {
    await update.downloadAndInstall();
  } catch (e) {
    await message(`アップデートに失敗しました。もう一度試すか、GitHub から新しい版を入れてください。\n\n${String(e)}`, {
      title: `${APP_NAME} のアップデート`,
      kind: "error",
    });
    return;
  }
  // Windows: the installer has already asked the app to exit by now; relaunch is
  // a no-op there. macOS: the .app was swapped in place, restart to pick it up.
  await relaunch();
}

/** Check a few seconds after launch in release builds. Returns a cleanup. */
export function scheduleUpdateCheck(): () => void {
  if (import.meta.env.DEV || !isTauri() || !UPDATES) return () => {};
  const t = setTimeout(() => checkForUpdate(false), 4000);
  return () => clearTimeout(t);
}
