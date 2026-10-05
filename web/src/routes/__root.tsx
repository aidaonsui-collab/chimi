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
      { name: "description", content: "Launch a coin into a locked pool on GIWA Sepolia." },
      { name: "theme-color", content: "#17120e" },
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
