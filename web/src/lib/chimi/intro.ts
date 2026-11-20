/*
 * The home page's opening (components/chimi/home-intro.tsx) plays once per visit: the first time the home page is
 * opened in a tab. Whether it plays is settled by a few lines in <head>, before anything is drawn, so a returning
 * visitor never sees a flash of it and a browser without JavaScript never sees it at all.
 *
 * <html data-intro="play"> shows it; "skip" (seen this visit, or the device asks for less motion) and "done" hide it.
 */

/** Set in sessionStorage once the opening has played in this tab. */
export const INTRO_SEEN = "chimi.intro.seen";

/** Runs in <head> before the page paints. Kept tiny and dependency-free. */
export const INTRO_GATE = `(function(){var d=document.documentElement,s="skip";try{if(location.pathname==="/"&&!sessionStorage.getItem(${JSON.stringify(INTRO_SEEN)})&&!matchMedia("(prefers-reduced-motion: reduce)").matches)s="play"}catch(e){}d.setAttribute("data-intro",s)})();`;
