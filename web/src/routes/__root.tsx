import { createRootRoute, HeadContent, Link, Outlet, Scripts } from "@tanstack/react-router";
import { ChimiProvider } from "@/components/chimi/provider";
import { Shell } from "@/components/chimi/shell";
import { Empty } from "@/components/chimi/ui";
import { Analytics } from "@vercel/analytics/react";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Chimi" },
      { name: "description", content: "Launch a coin into a locked pool on GIWA Sepolia. No bonding curve." },
      { name: "theme-color", content: "#090a0e" },
      { name: "color-scheme", content: "dark" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Chimi" },
      { property: "og:title", content: "The pool is the market." },
      { property: "og:description", content: "Launch a coin into a locked pool on GIWA Sepolia. No bonding curve." },
      { property: "og:url", content: "https://chimi-sage.vercel.app/" },
      { property: "og:image", content: "https://chimi-sage.vercel.app/og.jpg" },
      { property: "og:image:type", content: "image/jpeg" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "Chimi seal" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "The pool is the market." },
      { name: "twitter:description", content: "Launch a coin into a locked pool on GIWA Sepolia. No bonding curve." },
      { name: "twitter:image", content: "https://chimi-sage.vercel.app/og.jpg" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://cdn.jsdelivr.net", crossOrigin: "anonymous" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      // Pretendard covers Latin and Hangul in one family and only downloads the glyph ranges a page uses.
      { rel: "stylesheet", href: "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" },
      // The serif is for the Korean accents and the house seals.
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@900&family=Song+Myung&display=swap" },
    ],
  }),
  notFoundComponent: () => (
    <main className="page pt-10 pb-16">
      <div className="card">
        <Empty
          mark="없음"
          title="There’s nothing at this address"
          action={
            <Link to="/" className="btn btn-primary">
              Back to the board
            </Link>
          }
        >
          The page may have moved, or the link was mistyped.
        </Empty>
      </div>
    </main>
  ),
  component: () => (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <ChimiProvider>
          <Shell>
            <Outlet />
          </Shell>
        </ChimiProvider>
        <Analytics />
        <Scripts />
      </body>
    </html>
  ),
});
