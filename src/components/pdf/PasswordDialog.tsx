import { Lock } from 'lucide-react';
import { useId, useState } from 'react';
import { answerPassword } from '../../features/pdf/passwordPrompt';
import { usePdfStore } from '../../store/pdfStore';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';

function Prompt({ fileName, wrong }: { fileName: string; wrong: boolean }) {
  const [password, setPassword] = useState('');
  const id = useId();
  const submit = () => password && answerPassword(password);
  return (
    <Modal
      open
      onClose={() => answerPassword(null)}
      title="This PDF is locked"
      description={fileName}
      footer={
        <>
          <Button onClick={() => answerPassword(null)}>Skip this file</Button>
          <Button variant="primary" onClick={submit} disabled={!password}>
            Unlock
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="flex gap-2 text-sm text-muted">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Enter the password to open it. It is used once, in this browser, and never stored or sent anywhere.
        </p>
        <label htmlFor={id} className="block text-xs font-medium tracking-wide text-muted uppercase">
          Password
        </label>
        <input
          id={id}
          type="password"
          autoComplete="off"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          aria-invalid={wrong}
          aria-describedby={wrong ? `${id}-error` : undefined}
          className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-fg hover:border-border-strong focus-visible:border-accent aria-[invalid=true]:border-danger"
        />
        {wrong && (
          <p id={`${id}-error`} role="alert" className="text-xs text-danger">
            That password did not work. Try again.
          </p>
        )}
      </div>
    </Modal>
  );
}

/** Shown while a locked PDF waits for its password. */
export function PasswordDialog() {
  const prompt = usePdfStore((s) => s.passwordPrompt);
  if (!prompt) return null;
  // Keyed so a wrong attempt clears the field.
  return <Prompt key={`${prompt.fileName}:${prompt.wrong}`} fileName={prompt.fileName} wrong={prompt.wrong} />;
}
