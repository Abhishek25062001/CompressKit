import type { AnchorHTMLAttributes, MouseEvent, Ref } from 'react';
import { href, useRouteStore } from '../../store/routeStore';

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  /** App path, e.g. "/compress" or "/#privacy". */
  to: string;
  ref?: Ref<HTMLAnchorElement>;
}

/**
 * A real link (it can be opened in a new tab, copied or crawled) that switches pages without
 * reloading, so files already added to a tool stay where they are.
 */
export function Link({ to, onClick, ref, ...rest }: LinkProps) {
  const navigate = useRouteStore((s) => s.navigate);
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a ref={ref} href={href(to)} onClick={handle} {...rest} />;
}
