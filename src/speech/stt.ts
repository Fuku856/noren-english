/**
 * 聞き取り。Web Speech API の SpeechRecognition を薄く包む。
 *
 * 型が標準 lib に無い環境があるので、使うぶんだけ自前で書く。
 * 包む目的は2つ:
 *   - 端末差（webkit 接頭辞・エラー名）をここに閉じ込める
 *   - 失敗の理由を利用者に見せられる言葉に翻訳する（黙って何も起きないのが最悪）
 */

interface RecognitionAlternative {
  transcript: string;
}

interface RecognitionResult {
  readonly length: number;
  isFinal: boolean;
  [index: number]: RecognitionAlternative;
}

interface RecognitionResultList {
  readonly length: number;
  [index: number]: RecognitionResult;
}

interface RecognitionEvent extends Event {
  resultIndex: number;
  results: RecognitionResultList;
}

interface RecognitionErrorEvent extends Event {
  error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => SpeechRecognitionLike;

/** 利用者に見せる失敗の種類。 */
export type SttFailure = "denied" | "no-speech" | "unavailable" | "failed";

/**
 * その失敗は、もう一度話せば直るか。
 *
 *   no-speech / failed … 一時的。同じ画面でもう一度どうぞ
 *   denied / unavailable … 構造的。この端末では今日ずっと聞き取れない
 *
 * 構造的な失敗のときに音読の画面へ留めると、開いた5分がそのまま消える。
 * 呼び出し側はここが true を返したら並べ替えへ落とすこと。
 */
export function isStructuralFailure(reason: SttFailure): boolean {
  return reason === "denied" || reason === "unavailable";
}

export interface SttHandlers {
  /** 聞き取れた文。 */
  onResult(text: string): void;
  onFailure(reason: SttFailure): void;
  /** 成否によらず、聞き取りが終わったとき。ボタンの見た目を戻すのに使う。 */
  onEnd(): void;
}

export interface Recognizer {
  start(): void;
  stop(): void;
  dispose(): void;
}

function ctor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function translate(error: string): SttFailure {
  if (error === "not-allowed" || error === "service-not-allowed") return "denied";
  if (error === "no-speech" || error === "aborted") return "no-speech";
  if (error === "audio-capture") return "unavailable";
  return "failed";
}

/** 使えない端末では null。呼び出し側は並べ替えに落とすこと。 */
export function createRecognizer(handlers: SttHandlers): Recognizer | null {
  const Ctor = ctor();
  if (!Ctor) return null;

  let rec: SpeechRecognitionLike | null = null;
  let running = false;
  let delivered = false;

  const build = (): SpeechRecognitionLike => {
    const r = new Ctor();
    r.lang = "en-US";
    // 1文を読み上げるだけなので、確定した結果だけでよい
    r.interimResults = false;
    r.continuous = false;
    r.maxAlternatives = 1;

    r.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) {
        const alt = e.results[i]?.[0];
        if (alt) text += ` ${alt.transcript}`;
      }
      const trimmed = text.trim();
      if (!trimmed) return;
      delivered = true;
      handlers.onResult(trimmed);
    };

    r.onerror = (e) => {
      if (delivered) return;
      delivered = true;
      handlers.onFailure(translate(e.error));
    };

    r.onend = () => {
      running = false;
      // 何も聞こえないまま終わることがある。無反応にしないで理由を返す
      if (!delivered) handlers.onFailure("no-speech");
      handlers.onEnd();
    };

    return r;
  };

  return {
    start() {
      if (running) return;
      delivered = false;
      try {
        rec = build();
        rec.start();
        running = true;
      } catch {
        running = false;
        delivered = true;
        handlers.onFailure("failed");
        handlers.onEnd();
      }
    },
    stop() {
      try {
        rec?.stop();
      } catch {
        // no-op
      }
    },
    dispose() {
      try {
        rec?.abort();
      } catch {
        // no-op
      }
      if (rec) {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
      }
      rec = null;
      running = false;
    },
  };
}
