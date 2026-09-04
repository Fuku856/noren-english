/**
 * ファイルの受け渡し。書き出しは a[download]、読み込みは input[type=file]。
 *
 * ここだけを DOM に触れる場所にしておくと、transfer.ts をそのままテストできる。
 */

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  // 即座に revoke すると Safari がダウンロードを取りこぼす
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function readJsonFile(file: File): Promise<unknown> {
  const text = await file.text();
  return JSON.parse(text) as unknown;
}
