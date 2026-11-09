import { createPublicClient, http } from "viem";
import { giwaSepolia } from "@/lib/chimi/chain";

export const publicClient = createPublicClient({
  chain: giwaSepolia,
  // Contract reads made in the same moment travel as one call through Multicall3, so a board of
  // many coins costs a handful of requests instead of several per coin.
  batch: { multicall: { wait: 16 } },
  // VITE_GIWA_RPC points the app at another node, such as a local fork.
  transport: http(import.meta.env.VITE_GIWA_RPC || undefined),
});
