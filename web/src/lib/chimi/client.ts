import { createPublicClient, http } from "viem";
import { giwaSepolia } from "@/lib/chimi/chain";

export const publicClient = createPublicClient({
  chain: giwaSepolia,
  // VITE_GIWA_RPC points the app at another node, such as a local fork.
  transport: http(import.meta.env.VITE_GIWA_RPC || undefined),
});
