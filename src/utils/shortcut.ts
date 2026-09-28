const isApple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

/** The keys that open the tools launcher, as this computer's keyboard labels them. */
export const TOOLS_SHORTCUT = isApple ? '⌘K' : 'Ctrl K';
