import { numberToHex, parseAbi, type Address, type PublicClient } from "viem";
import type { Profile } from "@/lib/chimi/points-rules";

/**
 * GIWA identity, read straight from the chain:
 * - Dojang: GIWA's attestation service (on EAS). A "Verified Address" attestation from an approved attester says a real
 *   person holds the wallet. DojangScroll answers whether a wallet has one from a given attester.
 * - up.id: Upbit's names on GIWA. A wallet with an active name shows as `name.up.id` instead of 0x….
 */
export const DOJANG_SCROLL: Address = "0xd5077b67dcb56caC8b270C7788FC3E6ee03F17B9";
export const UP_ID_REGISTRY: Address = "0x091D00004f21eb2Fc30964A8a4995692d9b49628";

/** Attesters whose Verified Address counts. On Sepolia the GIWA faucet issues test attestations too. */
export const DOJANG_ATTESTERS: { id: `0x${string}`; name: string }[] = [
  { id: "0xd99b42e778498aa3c9c1f6a012359130252780511687a35982e8e52735453034", name: "Upbit Korea" },
  { id: "0xaa92f8c143657dde575de430aecaea6ca91f2e6072339b16932d426895d8d678", name: "GIWA testnet faucet" },
];

/** Where a wallet gets a Dojang on Sepolia. */
export const DOJANG_URL = "https://playground.giwa.io/";

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
  const first = await client.multicall({
    allowFailure: true,
    contracts: list.flatMap((w) => [
      ...DOJANG_ATTESTERS.map((a) => ({ address: DOJANG_SCROLL, abi: dojangAbi, functionName: "isVerified", args: [w, a.id] }) as const),
      { address: UP_ID_REGISTRY, abi: upIdAbi, functionName: "hasActiveName", args: [w] } as const,
      { address: UP_ID_REGISTRY, abi: upIdAbi, functionName: "ownedTokenId", args: [w] } as const,
    ]),
  });
  const per = DOJANG_ATTESTERS.length + 2;
  const named: { wallet: string; token: bigint }[] = [];
  const out: Record<string, Profile> = {};
  const at = Date.now();
  list.forEach((wallet, i) => {
    const row = first.slice(i * per, (i + 1) * per);
    const verified = row.slice(0, DOJANG_ATTESTERS.length).some((r) => r.status === "success" && r.result === true);
    const [active, token] = row.slice(DOJANG_ATTESTERS.length);
    if (active?.status === "success" && active.result === true && token?.status === "success" && (token.result as bigint) > 0n) {
      named.push({ wallet, token: token.result as bigint });
    }
    out[wallet] = { name: null, verified, at };
  });
  if (named.length > 0) {
    const labels = await client.multicall({
      allowFailure: true,
      contracts: named.map((n) => ({ address: UP_ID_REGISTRY, abi: upIdAbi, functionName: "getLabel", args: [numberToHex(n.token, { size: 32 })] }) as const),
    });
    named.forEach((n, i) => {
      const label = labels[i];
      if (label?.status === "success" && /^[a-z0-9-]{1,40}$/.test(label.result)) out[n.wallet]!.name = `${label.result}.up.id`;
    });
  }
  return out;
}
