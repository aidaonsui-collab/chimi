import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  createWalletClient,
  custom,
  encodeFunctionData,
  formatEther,
  getAddress,
  parseEther,
  parseEventLogs,
  type Address,
  type EIP1193Provider,
  type WalletClient,
} from "viem";
import {
  POOL_FEE,
  ROUTER_KEEPS,
  dexOf,
  erc20Abi,
  factoryAbi,
  giwaSepolia,
  isDeployed,
  lockerAbi,
  routerAbi,
  wethAbi,
  type Deployment,
  tipsAbi,
} from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import type { LockedPosition } from "@/lib/chimi/fees";
import { ethText } from "@/lib/chimi/format";
import { loadCoins, short, type Coin } from "@/lib/chimi/market";
import { previewCoins } from "@/lib/chimi/mocks";

type ChimiContext = {
  deployment: Deployment | null;
  live: boolean;
  coins: Coin[];
  /** True until the factory has answered once. Pages show placeholders instead of an empty board. */
  loading: boolean;
  preview: boolean;
  note: string;
  account?: Address;
  connect: () => Promise<{ who: Address; client: WalletClient } | undefined>;
  /** Forgets the wallet on this site until Connect is pressed again. */
  disconnect: () => void;
  /** Asks the wallet to move to GIWA Sepolia if it is on another network. */
  ensureChain: () => Promise<void>;
  refresh: () => Promise<void>;
  createCoin: (name: string, symbol: string, firstBuy: string) => Promise<Address>;
  /** A sale pays out in ETH: the swap and the unwrap are one transaction, after an approval. */
  trade: (coin: Coin, side: "buy" | "sell", amount: string, minOut?: bigint) => Promise<string>;
  /**
   * Buys with a set amount of ETH in one confirmation, for the buttons on feed cards. The minimum comes from a dry
   * run of this exact swap, so it already allows for the price the buy itself moves, less `slippageBps` (2%).
   */
  quickBuy: (coin: Coin, eth: string, slippageBps?: number) => Promise<string>;
  /** Turns wrapped ETH back into ETH: the whole balance, or just `amount`. */
  unwrap: (amount?: bigint) => Promise<string>;
  /**
   * Sweeps the pool fees of these launch positions, one transaction per locker. Anyone can send it; each
   * creator's share goes to the wallet stamped on the lock, as wrapped ETH. Answers with what this wallet received.
   */
  claimFees: (positions: LockedPosition[]) => Promise<{ hash: string; received: bigint }>;
  /** Personal-sign with the connected wallet (used to publish token pictures). */
  signMessage: (message: string) => Promise<`0x${string}`>;
  /**
   * Tips the creator of `token` `wei` of ETH with a message (90% to them, 10% to the platform). `onSigned` hears the
   * transaction as soon as the wallet sends it; the promise settles once it's confirmed.
   */
  tip: (token: Address, wei: bigint, message: string, onSigned?: (hash: `0x${string}`) => void) => Promise<`0x${string}`>;
};

const Ctx = createContext<ChimiContext | null>(null);

function ethereum(): EIP1193Provider | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { ethereum?: EIP1193Provider }).ethereum;
}

/** Set when the user disconnects, so the next visit doesn't quietly pick the wallet back up. */
const SIGNED_OUT = "chimi.wallet.off";

async function moveToGiwa(client: WalletClient, eth: EIP1193Provider) {
  try {
    await client.switchChain({ id: giwaSepolia.id });
  } catch {
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: "0x164ce",
          chainName: "GIWA Sepolia",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://sepolia-rpc.giwa.io"],
          blockExplorerUrls: ["https://sepolia-explorer.giwa.io"],
        },
      ],
    });
  }
}

export function ChimiProvider({ children }: { children: ReactNode }) {
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [coins, setCoins] = useState<Coin[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(false);
  const [note, setNote] = useState("");
  const [account, setAccount] = useState<Address | undefined>();
  const walletRef = useRef<WalletClient | undefined>(undefined);
  const accountRef = useRef<Address | undefined>(undefined);
  const loadGen = useRef(0);

  const live = deployment ? isDeployed(deployment) : false;

  const refresh = useCallback(async () => {
    const dep = deployment;
    if (!dep) return;
    if (!isDeployed(dep)) {
      setCoins(previewCoins);
      setPreview(true);
      setNote("Preview coins. The factory is not on this chain yet.");
      return;
    }
    const id = ++loadGen.current;
    const next = await loadCoins(dep);
    if (id !== loadGen.current) return;
    if (next.length === 0) {
      setCoins(previewCoins);
      setPreview(true);
      setNote("Preview coins. Nothing has been launched on the factory yet.");
      return;
    }
    setCoins(next);
    setPreview(false);
    setNote("");
  }, [deployment]);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      try {
        const dep = (await fetch("/deployments.json").then((r) => r.json())) as Deployment;
        if (cancel) return;
        setDeployment(dep);
        if (!isDeployed(dep)) {
          setCoins(previewCoins);
          setPreview(true);
          setNote("Preview coins. The factory is not on this chain yet.");
          return;
        }
        const id = ++loadGen.current;
        const next = await loadCoins(dep);
        if (cancel || id !== loadGen.current) return;
        if (next.length === 0) {
          setCoins(previewCoins);
          setPreview(true);
          setNote("Preview coins. Nothing has been launched on the factory yet.");
          return;
        }
        setCoins(next);
        setPreview(false);
        setNote("");
      } catch (err) {
        if (!cancel) setNote(short(err));
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  // A wallet that already trusts this site is picked up again on load, without a prompt.
  useEffect(() => {
    const eth = ethereum();
    if (!eth) return;
    let cancel = false;
    const adopt = (accounts: readonly string[]) => {
      const first = accounts[0];
      if (!first) {
        walletRef.current = undefined;
        accountRef.current = undefined;
        setAccount(undefined);
        return;
      }
      const who = getAddress(first);
      walletRef.current = createWalletClient({ chain: giwaSepolia, transport: custom(eth) });
      accountRef.current = who;
      setAccount(who);
    };
    let off = false;
    try {
      off = localStorage.getItem(SIGNED_OUT) === "1";
    } catch {
      /* private mode */
    }
    if (!off) {
      void (eth.request({ method: "eth_accounts" }) as Promise<string[]>)
        .then((accounts) => {
          if (!cancel && accounts.length > 0) adopt(accounts);
        })
        .catch(() => undefined);
    }
    // Follow the wallet when the user switches account in it, or locks it.
    const onAccounts = (accounts: string[]) => {
      if (accountRef.current) adopt(accounts);
    };
    const events = eth as EIP1193Provider & {
      on?: (event: string, fn: (accounts: string[]) => void) => void;
      removeListener?: (event: string, fn: (accounts: string[]) => void) => void;
    };
    events.on?.("accountsChanged", onAccounts);
    return () => {
      cancel = true;
      events.removeListener?.("accountsChanged", onAccounts);
    };
  }, []);

  const connect = useCallback(async () => {
    const eth = ethereum();
    if (!eth) throw new Error("No wallet in this browser.");
    const next = createWalletClient({ chain: giwaSepolia, transport: custom(eth) });
    const accounts = await next.requestAddresses();
    const who = accounts[0];
    if (!who) return;
    await moveToGiwa(next, eth);
    try {
      localStorage.removeItem(SIGNED_OUT);
    } catch {
      /* private mode */
    }
    walletRef.current = next;
    accountRef.current = who;
    setAccount(who);
    return { who, client: next };
  }, []);

  const disconnect = useCallback(() => {
    walletRef.current = undefined;
    accountRef.current = undefined;
    setAccount(undefined);
    try {
      localStorage.setItem(SIGNED_OUT, "1");
    } catch {
      /* private mode */
    }
  }, []);

  const ensureChain = useCallback(async () => {
    const eth = ethereum();
    const client = walletRef.current;
    if (!eth || !client) return;
    const id = await client.getChainId().catch(() => undefined);
    if (id !== giwaSepolia.id) await moveToGiwa(client, eth);
  }, []);

  /** The connected wallet, connecting first if needed. Transactions also make sure it is on GIWA. */
  async function ready(forTransaction = true) {
    if (accountRef.current && walletRef.current) {
      if (forTransaction) await ensureChain();
      return { who: accountRef.current, client: walletRef.current };
    }
    const got = await connect();
    if (!got) throw new Error("Connect a wallet first.");
    return got;
  }

  const createCoin = useCallback(
    async (name: string, symbol: string, firstBuy: string) => {
      if (!deployment || !isDeployed(deployment)) throw new Error("Deploy the factory before launching a coin.");
      const { who, client } = await ready();
      const fee = await publicClient.readContract({
        address: deployment.factory,
        abi: factoryAbi,
        functionName: "creationFeeDue",
        args: [who],
      });
      const value = fee + parseEther(firstBuy.trim() || "0");
      const hash = await client.writeContract({
        account: who,
        chain: giwaSepolia,
        address: deployment.factory,
        abi: factoryAbi,
        functionName: "createTokenMemeInstantQuoteWithEth",
        args: [name.trim(), symbol.trim()],
        value,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const created = parseEventLogs({
        abi: factoryAbi,
        logs: receipt.logs,
        eventName: "InstantQuoteTokenCreated",
      });
      const token = created[0]?.args.token;
      if (!token) throw new Error("The launch confirmed, but the new token was not in the receipt.");
      const id = ++loadGen.current;
      const next = await loadCoins(deployment);
      if (id === loadGen.current) {
      if (next.length === 0) {
        setCoins(previewCoins);
        setPreview(true);
      } else {
        setCoins(next);
        setPreview(false);
        setNote("");
      }
      }
      return token;
    },
    [deployment],
  );

  const trade = useCallback(
    async (coin: Coin, side: "buy" | "sell", amount: string, minOut: bigint = 0n) => {
      if (coin.preview) throw new Error("Preview coin. Launch a real one to trade.");
      if (!deployment) throw new Error("Factory not loaded.");
      const { who, client } = await ready();
      const qty = parseEther(amount.trim());
      // Each coin trades on the DEX that made its pool, at that pool's fee.
      const router = dexOf(deployment, coin).swapRouter;
      const fee = coin.fee ?? POOL_FEE;
      if (side === "buy") {
        const hash = await client.writeContract({
          account: who,
          chain: giwaSepolia,
          address: router,
          abi: routerAbi,
          functionName: "exactInputSingle",
          args: [
            {
              tokenIn: deployment.weth,
              tokenOut: coin.token,
              fee,
              recipient: who,
              amountIn: qty,
              amountOutMinimum: minOut,
              sqrtPriceLimitX96: 0n,
            },
          ],
          value: qty,
        });
        const bought = await publicClient.waitForTransactionReceipt({ hash });
        // A swap that lands but reverts spends only gas. The usual cause is a fill below the minimum received.
        if (bought.status !== "success") throw new Error("The buy failed on-chain, so nothing was bought. If the price moved past your minimum, try a smaller amount or more slippage.");
        await refresh();
        return hash;
      }
      // The router may still be allowed to move enough from an earlier sale that didn't go through.
      const allowed = await publicClient.readContract({
        address: coin.token,
        abi: erc20Abi,
        functionName: "allowance",
        args: [who, router],
      });
      if (allowed < qty) {
        const approve = await client.writeContract({
          account: who,
          chain: giwaSepolia,
          address: coin.token,
          abi: erc20Abi,
          functionName: "approve",
          args: [router, qty],
        });
        await publicClient.waitForTransactionReceipt({ hash: approve });
      }
      // One transaction: the pool pays its wrapped ETH to the router, which unwraps it and sends ETH on.
      // Either both happen or neither, and the sale lapses if it hasn't landed in 20 minutes.
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
      const hash = await client.writeContract({
        account: who,
        chain: giwaSepolia,
        address: router,
        abi: routerAbi,
        functionName: "multicall",
        args: [
          deadline,
          [
            encodeFunctionData({
              abi: routerAbi,
              functionName: "exactInputSingle",
              args: [
                {
                  tokenIn: coin.token,
                  tokenOut: deployment.weth,
                  fee,
                  recipient: ROUTER_KEEPS,
                  amountIn: qty,
                  amountOutMinimum: minOut,
                  sqrtPriceLimitX96: 0n,
                },
              ],
            }),
            encodeFunctionData({ abi: routerAbi, functionName: "unwrapWETH9", args: [minOut, who] }),
          ],
        ],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The sale failed on-chain, so nothing was sold. If the price moved past your minimum, try a smaller amount or more slippage.");
      await refresh();
      return hash;
    },
    [deployment, refresh],
  );

  const quickBuy = useCallback(
    async (coin: Coin, eth: string, slippageBps = 200) => {
      if (coin.preview) throw new Error("Preview coin. Launch a real one to trade.");
      if (!deployment) throw new Error("Factory not loaded.");
      const { who } = await ready();
      const qty = parseEther(eth);
      // A buy can't spend more than the wallet holds: say so plainly, with what it does hold, before pricing anything.
      const held = await publicClient.getBalance({ address: who }).catch(() => undefined);
      if (held !== undefined && held < qty) throw new Error(`Not enough ETH for a ${eth} ETH buy. You have ${ethText(Number(formatEther(held)))} ETH.`);
      const router = dexOf(deployment, coin).swapRouter;
      const fee = coin.fee ?? POOL_FEE;
      let expected: bigint;
      try {
        const run = await publicClient.simulateContract({
          account: who,
          address: router,
          abi: routerAbi,
          functionName: "exactInputSingle",
          args: [{ tokenIn: deployment.weth, tokenOut: coin.token, fee, recipient: who, amountIn: qty, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }],
          value: qty,
        });
        expected = run.result;
      } catch (err) {
        // viem sums a node's refusal up generically ("Transaction creation failed.") and keeps the node's own words
        // ("EVM error: OutOfFunds" on GIWA) in `details`, so both are read.
        const details = err && typeof err === "object" && "details" in err ? String((err as { details: unknown }).details) : "";
        throw new Error(/insufficient|exceeds|balance|funds/i.test(`${short(err)} ${details}`) ? `Not enough ETH for a ${eth} ETH buy.` : "Couldn’t price that buy. Try again in a moment.");
      }
      return trade(coin, "buy", eth, (expected * BigInt(10_000 - slippageBps)) / 10_000n);
    },
    [deployment, trade],
  );

  const unwrap = useCallback(
    async (amount?: bigint) => {
      if (!deployment) throw new Error("Factory not loaded.");
      const { who, client } = await ready();
      const bal = await publicClient.readContract({
        address: deployment.weth,
        abi: wethAbi,
        functionName: "balanceOf",
        args: [who],
      });
      const wad = amount !== undefined && amount < bal ? amount : bal;
      if (wad === 0n) throw new Error("No wrapped ETH to unwrap.");
      const hash = await client.writeContract({
        account: who,
        chain: giwaSepolia,
        address: deployment.weth,
        abi: wethAbi,
        functionName: "withdraw",
        args: [wad],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      return hash;
    },
    [deployment],
  );

  const claimFees = useCallback(
    async (positions: LockedPosition[]) => {
      if (!deployment) throw new Error("Factory not loaded.");
      if (positions.length === 0) throw new Error("Nothing to claim.");
      const { who, client } = await ready();
      const wrapped = () => publicClient.readContract({ address: deployment.weth, abi: wethAbi, functionName: "balanceOf", args: [who] });
      const before = await wrapped();
      // Position ids repeat across DEXes, so each locker gets its own sweep.
      const byLocker = new Map<Address, bigint[]>();
      for (const p of positions) byLocker.set(p.locker, [...(byLocker.get(p.locker) ?? []), p.positionId]);
      let hash: `0x${string}` | undefined;
      for (const [locker, ids] of byLocker) {
        hash =
          ids.length === 1
            ? await client.writeContract({ account: who, chain: giwaSepolia, address: locker, abi: lockerAbi, functionName: "collectFees", args: [ids[0]!] })
            : await client.writeContract({ account: who, chain: giwaSepolia, address: locker, abi: lockerAbi, functionName: "collectFeesBatch", args: [ids] });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("The claim didn’t go through.");
      }
      const after = await wrapped();
      return { hash: hash!, received: after > before ? after - before : 0n };
    },
    [deployment],
  );

  const tip = useCallback(
    async (token: Address, wei: bigint, message: string, onSigned?: (hash: `0x${string}`) => void) => {
      const tips = deployment?.tips?.address;
      if (!tips) throw new Error("Tips aren’t switched on yet.");
      const { who, client } = await ready();
      const hash = await client.writeContract({ account: who, chain: giwaSepolia, address: tips, abi: tipsAbi, functionName: "tip", args: [token, message], value: wei });
      onSigned?.(hash);
      // GIWA makes a block a second; asking that often makes the tip feel instant.
      const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 1_000 });
      if (receipt.status !== "success") throw new Error("The tip didn’t go through.");
      return hash;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deployment],
  );

  const signMessage = useCallback(async (message: string) => {
    const { who, client } = await ready(false);
    return client.signMessage({ account: who, message });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo(
    () => ({
      deployment,
      live,
      coins,
      loading,
      preview,
      note,
      account,
      connect,
      disconnect,
      ensureChain,
      refresh,
      createCoin,
      trade,
      quickBuy,
      unwrap,
      claimFees,
      signMessage,
      tip,
    }),
    [deployment, live, coins, loading, preview, note, account, connect, disconnect, ensureChain, refresh, createCoin, trade, quickBuy, unwrap, claimFees, signMessage, tip],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChimi() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useChimi outside provider");
  return ctx;
}
