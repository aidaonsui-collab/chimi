import { numberToHex, parseAbi, type Address, type PublicClient } from "viem";
import { NETWORK } from "@/lib/chimi/network";
import type { Profile } from "@/lib/chimi/points-rules";

/**
 * GIWA identity, read straight from the chain:
 * - Dojang: GIWA's attestation service (on EAS). A "Verified Address" attestation from an approved attester says a real
 *   person holds the wallet. DojangScroll answers whether a wallet has one from a given attester.
 * - up.id: Upbit's names on GIWA. A wallet with an active name shows as `name.up.id` instead of 0x….
 */
export const DOJANG_SCROLL: Address | undefined = NETWORK.dojang?.scroll;
export const UP_ID_REGISTRY: Address | undefined = NETWORK.upId?.registry;

/** Attesters whose Verified Address counts (lib/chimi/network.ts). None where the chain has no Dojang. */
export const DOJANG_ATTESTERS: { id: `0x${string}`; name: string }[] = NETWORK.dojang?.attesters ?? [];

/** Where a wallet gets a Dojang; GIWA's docs where the chain has none yet. */
export const DOJANG_URL = NETWORK.dojang?.issueUrl ?? "https://docs.giwa.io/";

const dojangAbi = parseAbi(["function isVerified(address account, bytes32 attesterId) view returns (bool)"]);
const upIdAbi = parseAbi([
  "function hasActiveName(address account) view returns (bool)",
  "function ownedTokenId(address account) view returns (uint256)",
  "function getLabel(bytes32 node) view returns (string)",
]);

/** Each wallet's Dojang and up.id name, in two multicalls. Wallets come back lowercase. */
export async function readProfiles(client: PublicClient, wallets: string[]): Promise<Record<string, Profile>> {
  const list = [...new Set(wallets.map((w) => w.toLowerCase() as Address))];
  if (list.length === 0) return {};
  // A chain without Dojang or up.id (lib/chimi/network.ts) asks nothing of them: nobody is verified or named there.
  const scroll = DOJANG_SCROLL;
  const registry = UP_ID_REGISTRY;
  const attesters = scroll ? DOJANG_ATTESTERS : [];
  const first = await client.multicall({
    allowFailure: true,
    contracts: list.flatMap((w) => [
      ...attesters.map((a) => ({ address: scroll!, abi: dojangAbi, functionName: "isVerified", args: [w, a.id] }) as const),
      ...(registry
        ? ([
            { address: registry, abi: upIdAbi, functionName: "hasActiveName", args: [w] },
            { address: registry, abi: upIdAbi, functionName: "ownedTokenId", args: [w] },
          ] as const)
        : []),
    ]),
  });
  const per = attesters.length + (registry ? 2 : 0);
  const named: { wallet: string; token: bigint }[] = [];
  const out: Record<string, Profile> = {};
  const at = Date.now();
  list.forEach((wallet, i) => {
    const row = first.slice(i * per, (i + 1) * per);
    const verified = row.slice(0, attesters.length).some((r) => r.status === "success" && r.result === true);
    const [active, token] = registry ? row.slice(attesters.length) : [];
    if (active?.status === "success" && active.result === true && token?.status === "success" && (token.result as bigint) > 0n) {
      named.push({ wallet, token: token.result as bigint });
    }
    out[wallet] = { name: null, verified, at };
  });
  if (named.length > 0 && registry) {
    const labels = await client.multicall({
      allowFailure: true,
      contracts: named.map((n) => ({ address: registry, abi: upIdAbi, functionName: "getLabel", args: [numberToHex(n.token, { size: 32 })] }) as const),
    });
    named.forEach((n, i) => {
      const label = labels[i];
      if (label?.status === "success" && /^[a-z0-9-]{1,40}$/.test(label.result)) out[n.wallet]!.name = `${label.result}.up.id`;
    });
  }
  return out;
}
