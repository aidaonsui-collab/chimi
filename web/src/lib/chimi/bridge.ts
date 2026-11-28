import { useCallback, useEffect, useMemo, useState } from "react";
import { createPublicClient, defineChain, http, parseAbi, type Address, type Hash } from "viem";
import { getL2TransactionHashes } from "viem/op-stack";
import { DEPOSIT_L1_GAS, mergeBridges, type BridgeItem } from "@/lib/chimi/bridge-rules";
import { publicClient } from "@/lib/chimi/client";
import { NETWORK } from "@/lib/chimi/network";

/*
 * The Bridge page's chain work: Ethereum (where the deposit is made) and GIWA (where it is paid out). The deposit goes
 * through GIWA's own L1StandardBridge (network-rules.ts `l1`), so Chimi holds nothing and adds no fee. A deposit's
 * payout on GIWA is a transaction whose hash follows from the deposit's receipt (viem's getL2TransactionHashes), so
 * "arrived" means that transaction is in a GIWA block.
 */

export const L1 = NETWORK.l1;

export const l1Chain = L1
  ? defineChain({
      id: L1.id,
      name: L1.name,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [L1.rpc] } },
      blockExplorers: { default: L1.explorer },
      testnet: NETWORK.testnet,
    })
  : undefined;

/** Ethereum, read through the public node (or VITE_L1_RPC, such as a local fork). */
export const l1Client = l1Chain ? createPublicClient({ chain: l1Chain, transport: http(import.meta.env.VITE_L1_RPC || undefined) }) : undefined;

export const bridgeAbi = parseAbi([
  "function bridgeETHTo(address to, uint32 minGasLimit, bytes extraData) payable",
  "event ETHBridgeInitiated(address indexed from, address indexed to, uint256 amount, bytes extraData)",
]);

const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

/** The wallet's ETH on Ethereum and on GIWA, read again every 15 seconds while the page is in view. */
export function useBridgeBalances(account: Address | undefined) {
  const [balances, setBalances] = useState<{ of?: string; l1?: bigint; l2?: bigint }>({});
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!account || !l1Client) return;
    let off = false;
    const read = async () => {
      if (!visible()) return;
      const [l1, l2] = await Promise.all([l1Client.getBalance({ address: account }).catch(() => undefined), publicClient.getBalance({ address: account }).catch(() => undefined)]);
      if (!off) setBalances((was) => ({ of: account, l1: l1 ?? (was.of === account ? was.l1 : undefined), l2: l2 ?? (was.of === account ? was.l2 : undefined) }));
    };
    void read();
    const timer = setInterval(read, 15_000);
    return () => {
      off = true;
      clearInterval(timer);
    };
  }, [account, tick]);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const mine = balances.of === account ? balances : {};
  return { l1: mine.l1, l2: mine.l2, refresh };
}

/** What the deposit costs in gas on Ethereum, in wei: its gas at the going price, read again every 30 seconds. */
export function useDepositGas() {
  const [wei, setWei] = useState<bigint>();
  useEffect(() => {
    if (!l1Client) return;
    let off = false;
    const read = async () => {
      if (!visible()) return;
      try {
        const fees = await l1Client.estimateFeesPerGas();
        if (!off) setWei(DEPOSIT_L1_GAS * fees.maxFeePerGas);
      } catch {
        /* keep the last estimate */
      }
    };
    void read();
    const timer = setInterval(read, 30_000);
    return () => {
      off = true;
      clearInterval(timer);
    };
  }, []);
  return wei;
}

const KEY = "chimi.bridge.v1";
type Store = Record<string, BridgeItem[]>;

function readStore(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

function writeStore(store: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* remembered for this visit only */
  }
}

const listeners = new Set<() => void>();

/** Remembers a bridge (or what was learned about one) for its wallet, and tells the page. */
export function noteBridge(item: BridgeItem) {
  const store = readStore();
  const wallet = item.from.toLowerCase();
  store[wallet] = mergeBridges([item], store[wallet] ?? []);
  writeStore(store);
  for (const listener of listeners) listener();
}

/** How far back the chain is searched for this wallet's deposits made elsewhere: about a day of Ethereum blocks, one request. */
const SCAN_BLOCKS = 7_200n;

/**
 * The wallet's bridges, newest first: the ones sent from this browser, and any from the last day made elsewhere (GIWA's
 * own bridge app, for one). Each is followed until it has arrived on GIWA.
 */
export function useBridgeHistory(account: Address | undefined) {
  const wallet = account?.toLowerCase();
  const [local, setLocal] = useState<BridgeItem[]>([]);
  const [found, setFound] = useState<{ of?: string; items: BridgeItem[] }>({ items: [] });
  const [ready, setReady] = useState(false);

  // What this browser remembers, and every change to it.
  useEffect(() => {
    if (!wallet) return;
    const load = () => setLocal(readStore()[wallet] ?? []);
    load();
    listeners.add(load);
    return () => {
      listeners.delete(load);
    };
  }, [wallet]);

  // Deposits from this wallet in the last day, wherever they were made.
  useEffect(() => {
    if (!wallet || !L1 || !l1Client) return;
    let off = false;
    setReady(false);
    void (async () => {
      try {
        const head = await l1Client.getBlockNumber();
        const logs = await l1Client.getContractEvents({
          address: L1.standardBridge,
          abi: bridgeAbi,
          eventName: "ETHBridgeInitiated",
          args: { from: wallet as Address },
          fromBlock: head > SCAN_BLOCKS ? head - SCAN_BLOCKS : 0n,
          toBlock: head,
        });
        const mine = logs.filter((l) => l.args.to?.toLowerCase() === wallet).slice(-10);
        const times = await Promise.all(mine.map((l) => l1Client.getBlock({ blockNumber: l.blockNumber }).then((b) => Number(b.timestamp)).catch(() => Math.floor(Date.now() / 1000))));
        if (!off)
          setFound({
            of: wallet,
            items: mine.map((l, i) => ({ l1Hash: l.transactionHash, from: wallet, amount: (l.args.amount ?? 0n).toString(), time: times[i]!, l1Block: Number(l.blockNumber) })),
          });
      } catch {
        /* the node wouldn't search that far back: what this browser remembers still shows */
      } finally {
        if (!off) setReady(true);
      }
    })();
    return () => {
      off = true;
    };
  }, [wallet]);

  const items = useMemo(() => (wallet ? mergeBridges(local, found.of === wallet ? found.items : []) : []), [wallet, local, found]);

  // Follow each bridge that hasn't arrived: its Ethereum receipt, then its payout on GIWA.
  const pendingKey = items
    .filter((i) => !i.arrived && !i.failed)
    .map((i) => i.l1Hash)
    .join(",");
  useEffect(() => {
    if (!pendingKey || !l1Client) return;
    let off = false;
    const check = async () => {
      if (!visible()) return;
      for (const hash of pendingKey.split(",") as Hash[]) {
        const item = items.find((i) => i.l1Hash === hash);
        if (!item || off) continue;
        try {
          const receipt = await l1Client.getTransactionReceipt({ hash });
          if (receipt.status !== "success") {
            noteBridge({ ...item, failed: true, l1Block: Number(receipt.blockNumber) });
            continue;
          }
          const l2Hash = item.l2Hash ?? getL2TransactionHashes(receipt)[0];
          let arrived = false;
          if (l2Hash) {
            const paid = await publicClient.getTransactionReceipt({ hash: l2Hash }).catch(() => null);
            arrived = !!paid;
          }
          if (!off) noteBridge({ ...item, l1Block: Number(receipt.blockNumber), l2Hash, arrived });
        } catch {
          /* not in a block yet */
        }
      }
    };
    void check();
    const timer = setInterval(check, 6_000);
    return () => {
      off = true;
      clearInterval(timer);
    };
    // `items` changes as these checks write back; the key says when the set to follow has changed.
  }, [pendingKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return { items, ready: ready || !wallet };
}
