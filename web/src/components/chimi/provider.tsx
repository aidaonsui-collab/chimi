import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  createWalletClient,
  custom,
  parseEther,
  parseEventLogs,
  type Address,
  type EIP1193Provider,
  type WalletClient,
} from "viem";
import {
  POOL_FEE,
  erc20Abi,
  factoryAbi,
  giwaSepolia,
  isDeployed,
  routerAbi,
  wethAbi,
  type Deployment,
} from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import { loadCoins, short, type Coin } from "@/lib/chimi/market";
import { previewCoins } from "@/lib/chimi/mocks";

type ChimiContext = {
  deployment: Deployment | null;
  live: boolean;
  coins: Coin[];
  preview: boolean;
  note: string;
  account?: Address;
  pressOpen: boolean;
  setPressOpen: (open: boolean) => void;
  connect: () => Promise<{ who: Address; client: WalletClient } | undefined>;
  refresh: () => Promise<void>;
  createCoin: (name: string, symbol: string, firstBuy: string) => Promise<Address>;
  trade: (coin: Coin, side: "buy" | "sell", amount: string, minOut?: bigint) => Promise<string>;
  unwrap: () => Promise<string>;
  /** Personal-sign with the connected wallet (used to publish token pictures). */
  signMessage: (message: string) => Promise<`0x${string}`>;
};

const Ctx = createContext<ChimiContext | null>(null);

function ethereum(): EIP1193Provider | undefined {
  return (window as Window & { ethereum?: EIP1193Provider }).ethereum;
}

export function ChimiProvider({ children }: { children: ReactNode }) {
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [coins, setCoins] = useState<Coin[]>(previewCoins);
  const [preview, setPreview] = useState(true);
  const [note, setNote] = useState("");
  const [account, setAccount] = useState<Address | undefined>();
  const [pressOpen, setPressOpen] = useState(false);
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
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const connect = useCallback(async () => {
    const eth = ethereum();
    if (!eth) throw new Error("No wallet in this browser.");
    const next = createWalletClient({ chain: giwaSepolia, transport: custom(eth) });
    const accounts = await next.requestAddresses();
    const who = accounts[0];
    if (!who) return;
    try {
      await next.switchChain({ id: giwaSepolia.id });
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
    walletRef.current = next;
    accountRef.current = who;
    setAccount(who);
    return { who, client: next };
  }, []);

  async function ready() {
    if (accountRef.current && walletRef.current) {
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
      if (side === "buy") {
        const hash = await client.writeContract({
          account: who,
          chain: giwaSepolia,
          address: deployment.swapRouter,
          abi: routerAbi,
          functionName: "exactInputSingle",
          args: [
            {
              tokenIn: deployment.weth,
              tokenOut: coin.token,
              fee: POOL_FEE,
              recipient: who,
              amountIn: qty,
              amountOutMinimum: minOut,
              sqrtPriceLimitX96: 0n,
            },
          ],
          value: qty,
        });
        await publicClient.waitForTransactionReceipt({ hash });
        await refresh();
        return hash;
      }
      const approve = await client.writeContract({
        account: who,
        chain: giwaSepolia,
        address: coin.token,
        abi: erc20Abi,
        functionName: "approve",
        args: [deployment.swapRouter, qty],
      });
      await publicClient.waitForTransactionReceipt({ hash: approve });
      const hash = await client.writeContract({
        account: who,
        chain: giwaSepolia,
        address: deployment.swapRouter,
        abi: routerAbi,
        functionName: "exactInputSingle",
        args: [
          {
            tokenIn: coin.token,
            tokenOut: deployment.weth,
            fee: POOL_FEE,
            recipient: who,
            amountIn: qty,
            amountOutMinimum: minOut,
            sqrtPriceLimitX96: 0n,
          },
        ],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await refresh();
      return hash;
    },
    [deployment, refresh],
  );

  const unwrap = useCallback(async () => {
    if (!deployment) throw new Error("Factory not loaded.");
    const { who, client } = await ready();
    const bal = await publicClient.readContract({
      address: deployment.weth,
      abi: wethAbi,
      functionName: "balanceOf",
      args: [who],
    });
    if (bal === 0n) throw new Error("No wrapped ETH to unwrap.");
    const hash = await client.writeContract({
      account: who,
      chain: giwaSepolia,
      address: deployment.weth,
      abi: wethAbi,
      functionName: "withdraw",
      args: [bal],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }, [deployment]);

  const signMessage = useCallback(async (message: string) => {
    const { who, client } = await ready();
    return client.signMessage({ account: who, message });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo(
    () => ({
      deployment,
      live,
      coins,
      preview,
      note,
      account,
      pressOpen,
      setPressOpen,
      connect,
      refresh,
      createCoin,
      trade,
      unwrap,
      signMessage,
    }),
    [deployment, live, coins, preview, note, account, pressOpen, connect, refresh, createCoin, trade, unwrap, signMessage],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChimi() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useChimi outside provider");
  return ctx;
}
