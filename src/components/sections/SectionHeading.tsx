interface SectionHeadingProps {
  eyebrow: string;
  title: string;
  description?: string;
  id: string;
}

export function SectionHeading({ eyebrow, title, description, id }: SectionHeadingProps) {
  return (
    <div className="mx-auto mb-10 max-w-2xl text-center sm:mb-14">
      <p className="mb-3 font-mono text-xs tracking-[0.18em] text-accent-text uppercase">{eyebrow}</p>
      <h2 id={id} className="text-3xl font-semibold tracking-[-0.03em] text-balance text-fg sm:text-4xl">
        {title}
      </h2>
      {description && <p className="mt-4 text-pretty text-muted">{description}</p>}
    </div>
  );
}
