/**
 * 起動。
 *
 * 順番が体験を決める。例文の取得より先に画面を出し、
 * 開店時刻が決まった時点で閉店中に切り替わる。
 */

import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/screens.css";

import { dateKeyOf } from "@shared/dateKey";
import { initClock, now, startTicker } from "./app/clock";
import { createEffectRunner } from "./app/effects";
import { createStore, initialState } from "./app/store";
import { loadRecords } from "./data/records";
import {
  clearMaintenance,
  fetchMaintenance,
  loadMaintenance,
  saveMaintenance,
} from "./data/maintenance";
import { loadMilestonesSafe } from "./data/milestones";
import { loadOrCreateSalt, loadSettings, promotePending, saveSettings } from "./data/settings";
import { initStorage, isPersistent } from "./data/storage";
import { loadTickets, refillIfNeeded, saveTickets } from "./data/tickets";
import { loadSentences } from "./domain/sentences";
import { watchInstallPrompt } from "./pwa/installPrompt";
import { canUseSpeakMode } from "./speech/capabilities";
import { speakEnglish } from "./speech/tts";
import { createTimerBar } from "./ui/components/timerBar";
import { createRenderer } from "./ui/render";
import { closedScreen } from "./ui/screens/closed";
import { installScreen } from "./ui/screens/install";
import { maintenanceScreen } from "./ui/screens/maintenance";
import { onboardingScreen } from "./ui/screens/onboarding";
import { openScreen } from "./ui/screens/open";
import { resultScreen } from "./ui/screens/result";
import { settingsScreen } from "./ui/screens/settings";
import { installDevPanel } from "./dev/panel";

function boot(): void {
  watchInstallPrompt();
  initClock();
  initStorage();

  const startedAt = now();
  const todayKey = dateKeyOf(startedAt);

  const salt = loadOrCreateSalt();
  const stored = promotePending(loadSettings(), todayKey);
  saveSettings(stored);

  // 聞き取れない端末では並べ替えで動かす。**保存された希望は書き換えない**
  // （別の端末で読み込み直したときに音読へ戻れる）
  const settings =
    stored.mode === "speak" && !canUseSpeakMode()
      ? { ...stored, mode: "arrange" as const }
      : stored;

  const tickets = refillIfNeeded(loadTickets(), todayKey);
  saveTickets(tickets);

  const store = createStore(initialState(startedAt, todayKey));
  const root = document.getElementById("app");
  if (!root) throw new Error("#app が見つかりません");

  const render = createRenderer(root, {
    dispatch: store.dispatch,
    screens: {
      onboarding: onboardingScreen,
      install: installScreen,
      closed: closedScreen,
      open: openScreen,
      result: resultScreen,
      settings: settingsScreen,
      maintenance: maintenanceScreen,
    },
  });

  // 残り時間のバーは画面モジュールの外。開店中の画面が結果画面に差し替わっても
  // バー自身は残るので、時間が尽きたことが動きで伝わる
  const timerHost = document.querySelector<HTMLElement>("[data-timer]");
  const timerFill = document.querySelector<HTMLElement>("[data-timer-fill]");
  const timer =
    timerHost && timerFill ? createTimerBar(timerHost, timerFill) : null;

  store.setEffectRunner(
    createEffectRunner({ dispatch: store.dispatch, now, timer, speak: speakEnglish }),
  );
  store.subscribe(render);

  // 初回設定が済んでいなければ、開店時刻より先に時間帯を選んでもらう
  const firstRun = !settings.installedPrompted;

  store.dispatch({
    type: "HYDRATED",
    patch: {
      salt,
      settings,
      tickets,
      records: loadRecords(),
      milestones: loadMilestonesSafe(),
      ephemeral: !isPersistent(),
      screen: firstRun ? "onboarding" : "boot",
      // 返事が来るまで開けない。この旗は下の then で必ず下ろす
      awaitingMaintenance: true,
    },
  });

  /*
   * 前回までに分かっていたメンテナンス状態。**ネットワークより先に閉じる。**
   *
   * これが無いと、判定が返るまでの数百ms〜3秒のあいだアプリが操作でき、
   * リロードするたびにその窓が開き直る。
   */
  const storedMaintenance = loadMaintenance();
  if (storedMaintenance) {
    store.dispatch({ type: "MAINTENANCE_SET", info: storedMaintenance });
  }

  render(store.getState());

  /*
   * 開店時刻は判定を待たずに決める。**画面をすぐ出すため。**
   *
   * ここを待つと、圏外の起動で判定が3秒粘るあいだ真っ白のままになる。
   * 開けてしまう心配は無い。開店の判断は awaitingMaintenance が止めているし、
   * OPEN_TIME_RESOLVED は boot のときしか画面を書き換えないので、
   * 保存された旗で閉じた画面を踏み潰すこともない。
   */
  if (!firstRun) {
    store.dispatch({ type: "RESOLVE_OPEN_TIME" });
    store.dispatch({ type: "TICK", nowMs: now() });
  }

  /*
   * メンテナンス中かどうか。
   *
   * Service Worker が index.html をプリキャッシュするので、サーバ側で閉じても
   * インストール済みの利用者にはアプリがそのまま出る。ここで閉じるのがその経路。
   *
   * 取れなかった（unknown）ときは**旗に触らない**。保存が無ければ通常営業のまま
   * （圏外で「メンテナンス中」を出さない）、保存があればそれを尊重して閉じたままにする。
   */
  void fetchMaintenance().then((probe) => {
    if (probe.state === "on") {
      saveMaintenance(probe.info);
      store.dispatch({ type: "MAINTENANCE_SET", info: probe.info });
    } else if (probe.state === "off") {
      clearMaintenance();
      store.dispatch({
        type: "MAINTENANCE_CLEARED",
        screen: firstRun ? "onboarding" : "closed",
      });
    }

    // 判定が付いた。止めていた開店をこの場でやり直す
    // （次のティックを待つと、定刻ちょうどの起動で最大1秒遅れる）
    store.dispatch({ type: "HYDRATED", patch: { awaitingMaintenance: false } });
    store.dispatch({ type: "TICK", nowMs: now() });
  });

  // 例文は画面より後で構わない。開店の瞬間までに間に合えばよい
  void loadSentences()
    .then((db) => store.dispatch({ type: "HYDRATED", patch: { db } }))
    .catch(() => {
      // 取得できなければ開店できない。次回の起動に賭ける
    });

  startTicker((nowMs) => {
    store.dispatch({ type: "TICK", nowMs });
    // スリープや タブ切り替えで生じたズレをここで自己修正する
    if (store.getState().session) timer?.resync(nowMs);
  });

  if (import.meta.env.DEV) installDevPanel(store);
}

boot();
