import { createInterface } from "node:readline/promises";

/**
 * CLI の入出力。テストでは fake に差し替え、出力にトークンや sub 全体が無いことを確かめる。
 */
export interface CliIo {
  print(line: string): void;
  /** `yes` と入力されたときだけ true。 */
  confirm(prompt: string): Promise<boolean>;
}

export class ConsoleIo implements CliIo {
  print(line: string): void {
    process.stdout.write(`${line}\n`);
  }

  async confirm(prompt: string): Promise<boolean> {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      const answer = await rl.question(`${prompt} (yes/no): `);
      return answer.trim() === "yes";
    } finally {
      rl.close();
    }
  }
}
