import { Globe, Mail, MessageCircle, Phone } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const WEBSITE = 'https://abhishekjaiswal.net/';
const PHONE_DISPLAY = '+91 87962 52123';
const PHONE_TEL = '+918796252123';
const EMAIL = 'abhishekjaiswal0203@gmail.com';

const CHANNELS: { label: string; value: string; href: string; icon: LucideIcon; external?: boolean }[] = [
  { label: 'Website', value: 'abhishekjaiswal.net', href: WEBSITE, icon: Globe, external: true },
  { label: 'Phone', value: PHONE_DISPLAY, href: `tel:${PHONE_TEL}`, icon: Phone },
  { label: 'WhatsApp', value: PHONE_DISPLAY, href: `https://wa.me/${PHONE_TEL.replace('+', '')}?text=${encodeURIComponent('Hey !')}`, icon: MessageCircle, external: true },
  { label: 'Email', value: EMAIL, href: `mailto:${EMAIL}`, icon: Mail },
];

export function Contact() {
  return (
    <section aria-labelledby="contact-title" id="contact" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6 sm:py-28">
      <div className="mx-auto max-w-2xl text-center">
        <p className="mb-3 font-mono text-xs tracking-[0.18em] text-accent-text uppercase">Contact</p>
        <h2 id="contact-title" className="text-3xl font-semibold tracking-[-0.03em] text-balance text-fg sm:text-4xl">
          Get in touch
        </h2>
        <p className="mt-4 text-pretty text-muted">Questions about ofctools, a bug, or a tool you need. Reach Abhishek Jaiswal directly.</p>
      </div>
      <ul className="mx-auto mt-10 grid max-w-2xl gap-3 sm:grid-cols-2">
        {CHANNELS.map(({ label, value, href, icon: Icon, external }) => (
          <li key={label}>
            <a
              href={href}
              {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              className="card flex h-full items-center gap-3 p-4 transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-[var(--shadow-soft)]"
            >
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-text">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="min-w-0 text-left">
                <span className="block text-xs font-medium tracking-wide text-subtle uppercase">{label}</span>
                <span className="mt-0.5 block truncate text-sm font-medium text-fg">{value}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
