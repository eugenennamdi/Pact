import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  DeploymentJournal,
  DeploymentTransactionRecord,
} from "./transaction.js";

/** Sensitive recovery journal. Callers must place it outside the repository. */
export class FileDeploymentJournal implements DeploymentJournal {
  private readonly entries = new Map<string, DeploymentTransactionRecord>();

  private constructor(private readonly path: string) {}

  static async open(path: string): Promise<FileDeploymentJournal> {
    const journal = new FileDeploymentJournal(path);
    try {
      const value = JSON.parse(await readFile(path, "utf8")) as Record<
        string,
        Omit<DeploymentTransactionRecord, "receiptBlock"> & {
          receiptBlock?: string;
        }
      >;
      for (const [key, record] of Object.entries(value)) {
        const { receiptBlock, ...requiredFields } = record;
        journal.entries.set(key, {
          ...requiredFields,
          ...(receiptBlock === undefined
            ? {}
            : { receiptBlock: BigInt(receiptBlock) }),
        });
      }
    } catch (error) {
      if (!(error instanceof Error) || !/ENOENT/.test(error.message))
        throw error;
    }
    return journal;
  }

  async load(step: string): Promise<DeploymentTransactionRecord | undefined> {
    return this.entries.get(step);
  }

  async save(record: DeploymentTransactionRecord): Promise<void> {
    this.entries.set(record.step, record);
    await mkdir(dirname(this.path), { recursive: true });
    const output = Object.fromEntries(
      [...this.entries].map(([key, value]) => [
        key,
        {
          ...value,
          ...(value.receiptBlock === undefined
            ? {}
            : { receiptBlock: value.receiptBlock.toString() }),
        },
      ]),
    );
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, `${JSON.stringify(output, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, this.path);
  }
}
