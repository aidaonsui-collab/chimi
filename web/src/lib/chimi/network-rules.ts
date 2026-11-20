/** A 0x address (viem's `Address`, without importing it). */
type Address = `0x${string}`;

/*
 * The chains Chimi can run on. `public/deployments.json` says which one a build uses (its chainId, picked in
 * network.ts); this file says everything else about each chain the app needs: its name, node, explorer, and GIWA's
 * identity contracts there. Moving Chimi to another chain is a new deployments.json plus that chain's entry here
 * (docs/MAINNET.md). It imports nothing, so it can be tested on its own.
 */

export type Network = {
  id: number;
  /** As the app says it: "GIWA Sepolia", "GIWA". */
  name: string;
  /** Test money only: the app says so, and points to faucets. */
  testnet: boolean;
  /** The public node. VITE_GIWA_RPC (browser) and GIWA_RPC (server) point elsewhere, such as a local fork. */
  rpc: string;
  explorer: { name: string; url: string };
  multicall3: Address;
  /**
   * Dojang: GIWA's "verified person" attestations, read through DojangScroll. Attesters are the issuers whose Verified
   * Address counts; `issueUrl` is where a wallet gets one. Absent: nobody shows as verified, and points (which only
   * Dojang wallets earn) earn nothing.
   */
  dojang?: { scroll: Address; attesters: { id: `0x${string}`; name: string }[]; issueUrl: string };
  /** up.id: Upbit's names on GIWA. Absent: wallets show as 0x…. */
  upId?: { registry: Address };
};

const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

export const GIWA_SEPOLIA: Network = {
  id: 91342,
  name: "GIWA Sepolia",
  testnet: true,
  rpc: "https://sepolia-rpc.giwa.io",
  explorer: { name: "GIWA Sepolia", url: "https://sepolia-explorer.giwa.io" },
  multicall3: MULTICALL3,
  dojang: {
    scroll: "0xd5077b67dcb56caC8b270C7788FC3E6ee03F17B9",
    attesters: [
      { id: "0xd99b42e778498aa3c9c1f6a012359130252780511687a35982e8e52735453034", name: "Upbit Korea" },
      // On Sepolia the GIWA faucet issues test attestations too.
      { id: "0xaa92f8c143657dde575de430aecaea6ca91f2e6072339b16932d426895d8d678", name: "GIWA testnet faucet" },
    ],
    // Issue Dojang on the GIWA Sepolia Playground (0.001 ETH plus gas). It moved here from playground.giwa.io.
    issueUrl: "https://sepolia-playground.giwa.io/",
  },
  upId: { registry: "0x091D00004f21eb2Fc30964A8a4995692d9b49628" },
};

/*
 * GIWA mainnet: not live yet. On 2026-11-20 docs.giwa.io/get-started/connect-to-giwa said "GIWA 메인넷은 현재 개발 중이에요"
 * (under development) and listed only Sepolia. When it launches, add its entry to NETWORKS with values from that page
 * and GIWA's Dojang/up.id docs only: a look-alike "GIWA mainnet" with fake RPCs and a bridge that drained users has
 * been seen before. Leave out Dojang or up.id if GIWA hasn't put them on mainnet yet.
 *
 *   { id: <chain id>, name: "GIWA", testnet: false, rpc: "<official RPC>",
 *     explorer: { name: "GIWA", url: "<official explorer>" }, multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
 *     dojang: { scroll: "<DojangScroll>", attesters: [{ id: "<Upbit Korea attester id>", name: "Upbit Korea" }],
 *               issueUrl: "<where to get a Dojang>" },
 *     upId: { registry: "<up.id registry>" } }
 *
 * Check multicall3 has code there before relying on it.
 */

/** A local chain for rehearsing a deploy (contracts/script/DeployChimiMainnet.s.sol on anvil). No GIWA identity. */
export const LOCAL: Network = {
  id: 31337,
  name: "Local chain",
  testnet: true,
  rpc: "http://127.0.0.1:8545",
  explorer: { name: "No explorer", url: "" },
  multicall3: MULTICALL3,
};

export const NETWORKS: readonly Network[] = [GIWA_SEPOLIA, LOCAL];

/** The network a deployment file belongs to. Throws for a chain this file doesn't describe, so the app stops on load instead of guessing. */
export function networkOf(chainId: number, known: readonly Network[] = NETWORKS): Network {
  const found = known.find((n) => n.id === chainId);
  if (!found) throw new Error(`deployments.json is for chain ${chainId}, which web/src/lib/chimi/network.ts doesn't describe. Add it there first (docs/MAINNET.md).`);
  return found;
}

