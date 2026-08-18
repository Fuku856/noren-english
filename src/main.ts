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
import { loadMilestonesSafe } from "./data/milestones";
import { loadOrCreateSalt, loadSettings, promotePending, saveSettings } from "./data/settings";
import { initStorage, isPersistent } from "./data/storage";
import { loadTickets, refillIfNeeded, saveTickets } from "./data/tickets";
import { loadSentences } from "./domain/sentences";
import { watchInstallPrompt } from "./pwa/installPrompt";
import { createNoren } from "./ui/components/noren";
import { createRenderer } from "./ui/render";
import { closedScreen } from "./ui/screens/closed";
import { installScreen } from "./ui/screens/install";
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
  const settings = promotePending(loadSettings(), todayKey);
  saveSettings(settings);

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
    },
  });

  // 暖簾は画面モジュールの外。開店中の画面が結果画面に差し替わっても
  // 暖簾自身は残るので、「上がる」動きが見える
  const norenSlide = document.querySelector<HTMLElement>("[data-noren-slide]");
  const norenBody = document.querySelector<HTMLElement>("[data-noren-body]");
  const noren =
    norenSlide && norenBody ? createNoren(norenSlide, norenBody) : null;

  store.setEffectRunner(
    createEffectRunner({ dispatch: store.dispatch, now, noren }),
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
    },
  });

  render(store.getState());

  if (!firstRun) {
    // 開店時刻が決まるまでは boot のまま。決まった瞬間に閉店中へ切り替わる
    store.dispatch({ type: "RESOLVE_OPEN_TIME" });
    store.dispatch({ type: "TICK", nowMs: now() });
  }

  // 例文は画面より後で構わない。開店の瞬間までに間に合えばよい
  void loadSentences()
    .then((db) => store.dispatch({ type: "HYDRATED", patch: { db } }))
    .catch(() => {
      // 取得できなければ開店できない。次回の起動に賭ける
    });

  startTicker((nowMs) => {
    store.dispatch({ type: "TICK", nowMs });
    // スリープや タブ切り替えで生じたズレをここで自己修正する
    if (store.getState().session) noren?.resync(nowMs);
  });

  if (import.meta.env.DEV) installDevPanel(store);
}

boot();
