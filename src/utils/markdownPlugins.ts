import remarkGfm from 'remark-gfm';

const hasRegexLookbehindSupport = (() => {
  try {
    new RegExp('(?<=a)b');
    return true;
  } catch {
    return false;
  }
})();

// remark-gfm's email autolink uses a positive lookbehind, which Safari < 16.4
// and other older engines throw on at regex construction. Fall back to `null`
// so callers render markdown without GFM rather than crashing the whole tree.
export const safeRemarkGfm: typeof remarkGfm | null = hasRegexLookbehindSupport
  ? remarkGfm
  : null;
