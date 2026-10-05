import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { ChimiProvider } from "@/components/chimi/provider";
import { Shell } from "@/components/chimi/shell";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Chimi" },
      { name: "description", content: "Launch a coin into a locked pool on GIWA Sepolia. No bonding curve." },
      { name: "theme-color", content: "#17120e" },
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
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Archivo+Black&family=Outfit:wght@400;500;600&family=Song+Myung&display=swap",
      },
    ],
  }),
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
        <Scripts />
      </body>
    </html>
  ),
});
