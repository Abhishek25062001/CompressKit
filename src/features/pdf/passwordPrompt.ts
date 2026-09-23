import { usePdfStore } from '../../store/pdfStore';

let pending: ((password: string | null) => void) | null = null;

/**
 * Asks for a PDF's password in a dialog. Resolves with what was typed, or null when the person
 * skips the file. The password is used once, to open the file, and never stored.
 */
export function askPassword(fileName: string, wrong: boolean): Promise<string | null> {
  pending?.(null);
  return new Promise((resolve) => {
    pending = resolve;
    usePdfStore.getState().setPasswordPrompt({ fileName, wrong });
  });
}

export function answerPassword(password: string | null): void {
  const resolve = pending;
  pending = null;
  usePdfStore.getState().setPasswordPrompt(null);
  resolve?.(password);
}
