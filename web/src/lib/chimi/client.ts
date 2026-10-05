import { createPublicClient, http } from "viem";
import { giwaSepolia } from "@/lib/chimi/chain";

export const publicClient = createPublicClient({
  chain: giwaSepolia,
  transport: http(),
});
