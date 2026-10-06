import type { BridgeMessage, FilePurpose } from '../web/bridgeMessages';
import { joinPath, mimeFromName, safeFileName } from './fileNames';

/** A result that has been written where the person can find it. */
export interface SavedFile {
  name: string;
  /** Where it went, in words for a notice: "Downloads" or "Files". */
  place: string;
  path: string;
  mime: string;
}

export interface ShareableFile {
  path: string;
  mime: string;
}

/** The file-system calls the receiver needs. The app passes the real ones; tests pass fakes. */
export interface ReceiverFs {
  mkdir(path: string): Promise<void>;
  writeFile(path: string, content: string, encoding: 'utf8'): Promise<void>;
  appendFile(path: string, content: string, encoding: 'base64'): Promise<void>;
  unlink(path: string): Promise<void>;
}

export interface ReceiverDeps {
  /** A private folder for files while they arrive. */
  exportDir: string;
  fs: ReceiverFs;
  /** Tells the page a step is done, or that it failed. */
  ack(key: string, error?: string): void;
  /** Moves a finished download to where the person will find it. */
  save(tempPath: string, name: string, mime: string): Promise<SavedFile>;
  /** Opens the share sheet for the files (and text) of one share. */
  share(files: ShareableFile[], text: string): Promise<void>;
  onSaved(file: SavedFile): void;
  onFailed(name: string, message: string): void;
}

interface Transfer {
  id: string;
  name: string;
  mime: string;
  purpose: FilePurpose;
  group: string;
  dir: string;
  path: string;
  nextSeq: number;
  /** Steps run one after another, in the order their messages arrived. */
  work: Promise<void>;
  failed: string | null;
  reported: boolean;
}

/** Transfer and share ids are made by the page and end up in a folder name, so only plain ones are accepted. */
const SAFE_ID = /^[A-Za-z0-9-]{1,48}$/;

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return typeof error === 'string' && error ? error : 'Something went wrong.';
}

/**
 * Receives files from the web page piece by piece and writes them to the device.
 *
 * The page sends `file-begin`, then `file-chunk` for each piece, then `file-end`, and waits for
 * an acknowledgement after each one. A download is then saved for the person; files that belong
 * to a share wait for the `share` message, which opens the share sheet with all of them.
 */
export class ExportReceiver {
  private readonly transfers = new Map<string, Transfer>();
  private readonly shareGroups = new Map<string, Transfer[]>();
  /** Folders of shares that have already been handed to the share sheet. */
  private spentShareDirs: string[] = [];

  constructor(private readonly deps: ReceiverDeps) {}

  /** Handles a file or share message. Returns false for any other message. */
  handle(message: BridgeMessage): boolean {
    switch (message.t) {
      case 'file-begin':
        this.begin(message);
        return true;
      case 'file-chunk':
        this.chunk(message);
        return true;
      case 'file-end':
        this.end(message);
        return true;
      case 'file-abort':
        this.abort(message);
        return true;
      case 'share':
        this.share(message);
        return true;
      default:
        return false;
    }
  }

  private begin(message: Extract<BridgeMessage, { t: 'file-begin' }>): void {
    const { id, purpose, group } = message;
    if (
      !SAFE_ID.test(id) ||
      (group && !SAFE_ID.test(group)) ||
      this.transfers.has(id)
    ) {
      this.deps.ack(`${id}:begin`, 'The file could not be received.');
      return;
    }
    const name = safeFileName(message.name);
    const dir = joinPath(this.deps.exportDir, id);
    const transfer: Transfer = {
      id,
      name,
      mime: mimeFromName(name, message.mime),
      purpose,
      group,
      dir,
      path: joinPath(dir, name),
      nextSeq: 0,
      work: Promise.resolve(),
      failed: null,
      reported: false,
    };
    this.transfers.set(id, transfer);
    this.step(transfer, `${id}:begin`, async () => {
      if (purpose === 'share') await this.discardSpentShares();
      await this.deps.fs.mkdir(dir);
      await this.deps.fs.writeFile(transfer.path, '', 'utf8');
    });
  }

  private chunk(message: Extract<BridgeMessage, { t: 'file-chunk' }>): void {
    const transfer = this.transfers.get(message.id);
    if (!transfer) {
      this.deps.ack(
        `${message.id}:${message.seq}`,
        'The file could not be received.',
      );
      return;
    }
    this.step(transfer, `${message.id}:${message.seq}`, async () => {
      if (message.seq !== transfer.nextSeq)
        throw new Error('The file arrived out of order.');
      await this.deps.fs.appendFile(transfer.path, message.data, 'base64');
      transfer.nextSeq += 1;
    });
  }

  private end(message: Extract<BridgeMessage, { t: 'file-end' }>): void {
    const transfer = this.transfers.get(message.id);
    if (!transfer) {
      this.deps.ack(`${message.id}:end`, 'The file could not be received.');
      return;
    }
    this.step(transfer, `${message.id}:end`, async () => {
      if (message.chunks !== transfer.nextSeq)
        throw new Error('Part of the file is missing.');
      this.transfers.delete(transfer.id);
      if (transfer.purpose === 'share') {
        const files = this.shareGroups.get(transfer.group) ?? [];
        files.push(transfer);
        this.shareGroups.set(transfer.group, files);
        return;
      }
      const saved = await this.deps.save(
        transfer.path,
        transfer.name,
        transfer.mime,
      );
      await this.removeDir(transfer.dir);
      this.deps.onSaved(saved);
    });
  }

  private abort(message: Extract<BridgeMessage, { t: 'file-abort' }>): void {
    const transfer = this.transfers.get(message.id);
    if (!transfer) return;
    transfer.work = transfer.work.then(async () => {
      if (!transfer.failed)
        await this.fail(
          transfer,
          message.message || 'The file could not be saved.',
        );
    });
  }

  private share(message: Extract<BridgeMessage, { t: 'share' }>): void {
    const key = `${message.group}:share`;
    // The page only asks once every file is acknowledged, but wait for any that is still being written anyway.
    const unfinished = [...this.transfers.values()]
      .filter(t => t.group === message.group)
      .map(t => t.work);
    let files: Transfer[] = [];
    const run = async () => {
      await Promise.all(unfinished);
      files = this.shareGroups.get(message.group) ?? [];
      this.shareGroups.delete(message.group);
      if (files.length !== message.count)
        throw new Error('Some files did not arrive.');
      if (files.length === 0 && !message.text) return;
      await this.deps.share(
        files.map(f => ({ path: f.path, mime: f.mime })),
        message.text,
      );
    };
    run()
      .then(
        () => this.deps.ack(key),
        (error: unknown) => this.deps.ack(key, errorMessage(error)),
      )
      .finally(() => {
        // The app that receives the files may still be reading them, so they are removed when the next share starts.
        this.spentShareDirs.push(...files.map(f => f.dir));
      });
  }

  /** Queues one step of a transfer, acknowledges it, and gives up on the transfer if it fails. */
  private step(
    transfer: Transfer,
    ackKey: string,
    run: () => Promise<void>,
  ): void {
    transfer.work = transfer.work.then(async () => {
      if (transfer.failed) {
        this.deps.ack(ackKey, transfer.failed);
        return;
      }
      try {
        await run();
        this.deps.ack(ackKey);
      } catch (error) {
        const message = errorMessage(error);
        await this.fail(transfer, message);
        this.deps.ack(ackKey, message);
      }
    });
  }

  private async fail(transfer: Transfer, message: string): Promise<void> {
    transfer.failed = message;
    this.transfers.delete(transfer.id);
    await this.removeDir(transfer.dir);
    // A failed share is reported by the page itself, which shows its own notice.
    if (transfer.purpose === 'download' && !transfer.reported) {
      transfer.reported = true;
      this.deps.onFailed(transfer.name, message);
    }
  }

  private async discardSpentShares(): Promise<void> {
    const dirs = this.spentShareDirs;
    this.spentShareDirs = [];
    for (const dir of dirs) await this.removeDir(dir);
  }

  private async removeDir(dir: string): Promise<void> {
    try {
      await this.deps.fs.unlink(dir);
    } catch {
      // Already gone, or never created.
    }
  }
}
