import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { createWalletClient, custom, formatEther, maxUint256, parseEther, type Address, type EIP1193Provider, type WalletClient } from "viem";
import { erc20Abi, FULL_RANGE, giwaSepolia, POOL_FEE, positionManagerAbi, wethAbi } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import { fmt, loadCoin, loadSwaps, short, shortAddr, wethPerToken, type Coin, type PoolSwap } from "@/lib/chimi/market";
import { useChimi } from "@/components/chimi/provider";

export const Route = createFileRoute("/pool/$address")({ component: PoolPage });

function money(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "$0.00";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `$${Math.round(n).toLocaleString("en-US")}`;
  return `$${n.toFixed(2)}`;
}

function clientFor(account: Address): WalletClient {
  const ethereum = (window as Window & { ethereum?: EIP1193Provider }).ethereum;
  if (!ethereum) throw new Error("No wallet found in this browser.");
  return createWalletClient({ account, chain: giwaSepolia, transport: custom(ethereum) });
}

function PoolPage() {
  const { address } = Route.useParams();
  const { coins, deployment, account, connect } = useChimi();
  const listed = coins.find((coin) => !coin.preview && coin.token.toLowerCase() === address.toLowerCase());
  const [coin, setCoin] = useState<Coin | null>(listed ?? null);
  const [swaps, setSwaps] = useState<PoolSwap[]>([]);
  const [ethUsd, setEthUsd] = useState<number>();
  const [wethBal, setWethBal] = useState<bigint>(0n);
  const [tokenBal, setTokenBal] = useState<bigint>(0n);
  const [ethIn, setEthIn] = useState("");
  const [tokenIn, setTokenIn] = useState("");
  const [positionId, setPositionId] = useState<bigint>();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (listed) {
      setCoin(listed);
      return;
    }
    if (!deployment) return;
    let cancel = false;
    void loadCoin(deployment, address as Address).then((found) => {
      if (!cancel) setCoin(found);
    });
    return () => {
      cancel = true;
    };
  }, [address, deployment, listed]);

  useEffect(() => {
    if (!coin || !deployment) return;
    let cancel = false;
    void Promise.all([
      publicClient.readContract({ address: deployment.weth, abi: erc20Abi, functionName: "balanceOf", args: [coin.pool] }),
      publicClient.readContract({ address: coin.token, abi: erc20Abi, functionName: "balanceOf", args: [coin.pool] }),
      loadSwaps(coin.pool, coin.tokenIs0),
      fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot").then((r) => r.json()),
    ]).then(([weth, token, rows, price]) => {
      if (cancel) return;
      setWethBal(weth);
      setTokenBal(token);
      setSwaps(rows);
      const n = Number((price as { data?: { amount?: string } }).data?.amount);
      if (Number.isFinite(n) && n > 0) setEthUsd(n);
    }).catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [coin, deployment]);

  useEffect(() => {
    if (!coin || !deployment || !account) {
      setPositionId(undefined);
      return;
    }
    let cancel = false;
    void (async () => {
      const count = await publicClient.readContract({
        address: deployment.positionManager,
        abi: positionManagerAbi,
        functionName: "balanceOf",
        args: [account],
      });
      for (let i = 0n; i < count; i++) {
        const id = await publicClient.readContract({
          address: deployment.positionManager,
          abi: positionManagerAbi,
          functionName: "tokenOfOwnerByIndex",
          args: [account, i],
        });
        const pos = await publicClient.readContract({
          address: deployment.positionManager,
          abi: positionManagerAbi,
          functionName: "positions",
          args: [id],
        });
        const tokens = [pos[2].toLowerCase(), pos[3].toLowerCase()];
        if (tokens.includes(coin.token.toLowerCase()) && tokens.includes(deployment.weth.toLowerCase())) {
          if (!cancel) setPositionId(id);
          return;
        }
      }
      if (!cancel) setPositionId(undefined);
    })().catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [coin, deployment, account]);

  if (!coin || !deployment) {
    return (
      <main className="mx-auto max-w-[1180px] px-5 py-16">
        <Link to="/pools" className="text-sm text-seal">Pools</Link>
        <h1 className="mt-6 text-4xl font-semibold">Pool not found.</h1>
      </main>
    );
  }

  const price = wethPerToken(coin.sqrtPriceX96, coin.tokenIs0);
  const priceEth = Number(price) / 1e18;
  const tvlUsd = ethUsd ? (Number(wethBal) / 1e18) * ethUsd + (Number(tokenBal) / 1e18) * priceEth * ethUsd : 0;
  const now = Math.floor(Date.now() / 1000);
  const day = swaps.filter((swap) => now - swap.time <= 86400);
  const volUsd = ethUsd ? day.reduce((sum, swap) => sum + (Number(swap.ethAmount) / 1e18) * ethUsd, 0) : 0;
  const apr = tvlUsd > 0 ? ((volUsd * 0.01) / tvlUsd) * 365 * 100 : 0;
  const hours = Array.from({ length: 12 }, (_, i) => {
    const start = now - (12 - i) * 3600;
    return day.filter((swap) => swap.time >= start && swap.time < start + 3600).reduce((sum, swap) => sum + (Number(swap.ethAmount) / 1e18) * (ethUsd ?? 0), 0);
  });
  const maxBar = Math.max(...hours, 1);

  function match() {
    try {
      const eth = parseEther(ethIn.trim() || "0");
      if (eth === 0n || price === 0n) return;
      setTokenIn(formatEther((eth * 10n ** 18n) / price));
    } catch {
      setNote("Enter an ETH amount first.");
    }
  }

  async function add() {
    if (!account) {
      await connect();
      return;
    }
    let eth = 0n;
    let tokens = 0n;
    try {
      eth = parseEther(ethIn.trim() || "0");
      tokens = parseEther(tokenIn.trim() || "0");
    } catch {
      setNote("Enter both amounts.");
      return;
    }
    if (eth === 0n && tokens === 0n) {
      setNote("Enter an amount of ETH or tokens.");
      return;
    }
    if (!coin || !deployment) return;
    const wallet = clientFor(account);
    const npm = deployment.positionManager;
    const weth = deployment.weth;
    const [token0, token1] = weth.toLowerCase() < coin.token.toLowerCase() ? [weth, coin.token] : [coin.token, weth];
    const amount0 = token0.toLowerCase() === weth.toLowerCase() ? eth : tokens;
    const amount1 = token1.toLowerCase() === weth.toLowerCase() ? eth : tokens;
    try {
      setBusy(true);
      if (eth > 0n) {
        setNote("Wrapping ETH.");
        const wrap = await wallet.writeContract({
          account,
          chain: giwaSepolia,
          address: weth,
          abi: wethAbi,
          functionName: "deposit",
          value: eth,
        });
        await publicClient.waitForTransactionReceipt({ hash: wrap });
      }
      for (const [asset, amt] of [[weth, eth], [coin.token, tokens]] as const) {
        if (amt === 0n) continue;
        const allowance = await publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "allowance", args: [account, npm] });
        if (allowance < amt) {
          setNote("Approving the position manager.");
          const approve = await wallet.writeContract({
            account,
            chain: giwaSepolia,
            address: asset,
            abi: erc20Abi,
            functionName: "approve",
            args: [npm, maxUint256],
          });
          await publicClient.waitForTransactionReceipt({ hash: approve });
        }
      }
      setNote("Adding liquidity.");
      const mint = await wallet.writeContract({
        account,
        chain: giwaSepolia,
        address: npm,
        abi: positionManagerAbi,
        functionName: "mint",
        args: [{
          token0,
          token1,
          fee: POOL_FEE,
          tickLower: FULL_RANGE.lower,
          tickUpper: FULL_RANGE.upper,
          amount0Desired: amount0,
          amount1Desired: amount1,
          amount0Min: 0n,
          amount1Min: 0n,
          recipient: account,
          deadline: BigInt(Math.floor(Date.now() / 1000) + 1200),
        }],
      });
      await publicClient.waitForTransactionReceipt({ hash: mint });
      setNote("Position added. Unused tokens were returned.");
      setEthIn("");
      setTokenIn("");
    } catch (err) {
      setNote(short(err));
    } finally {
      setBusy(false);
    }
  }

  async function collect() {
    if (!account || !deployment || positionId === undefined) return;
    try {
      setBusy(true);
      setNote("Collecting fees.");
      const wallet = clientFor(account);
      const hash = await wallet.writeContract({
        account,
        chain: giwaSepolia,
        address: deployment.positionManager,
        abi: positionManagerAbi,
        functionName: "collect",
        args: [{ tokenId: positionId, recipient: account, amount0Max: 2n ** 128n - 1n, amount1Max: 2n ** 128n - 1n }],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setNote("Fees collected.");
    } catch (err) {
      setNote(short(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-[1180px] px-4 py-8 sm:px-6">
      <Link to="/pools" className="text-sm text-muted">Pools</Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold tracking-[-0.03em]">{coin.symbol} / ETH</h1>
          <p className="mt-2 text-sm text-muted">v3 · 1% · {shortAddr(coin.pool)}</p>
        </div>
        <div className="flex gap-2">
          <Link to="/coin/$address" params={{ address: coin.token }} className="rounded-full border border-line px-4 py-2 text-sm font-semibold">Swap</Link>
          <a href="#add" className="rounded-full bg-seal px-4 py-2 text-sm font-semibold text-onseal">Add liquidity</a>
        </div>
      </div>

      <div className="mt-6 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="rounded-3xl border border-line bg-chip p-5">
          <h2 className="text-base font-semibold">Volume</h2>
          <p className="mt-4 text-3xl font-semibold">{money(volUsd)}</p>
          <p className="text-sm text-muted">Past day</p>
          <div className="mt-6 flex h-40 items-end gap-1">
            {hours.map((value, i) => (
              <span key={i} className="flex-1 rounded-t bg-gold" style={{ height: `${Math.max(2, (value / maxBar) * 100)}%` }} />
            ))}
          </div>
        </section>
        <section className="rounded-3xl border border-line bg-chip p-5">
          <h2 className="text-lg font-semibold">Stats</h2>
          <p className="mt-4 text-sm text-muted">Pool balances</p>
          <p className="mt-1 text-sm">{fmt(wethBal, 4)} ETH · {fmt(tokenBal, 2)} {coin.symbol}</p>
          <p className="mt-4 text-sm text-muted">Fee APR</p>
          <p className="text-3xl font-semibold">{apr.toFixed(2)}%</p>
          <p className="mt-4 text-sm text-muted">TVL</p>
          <p className="text-2xl font-semibold">{money(tvlUsd)}</p>
          <p className="mt-4 text-sm text-muted">24h volume</p>
          <p className="text-2xl font-semibold">{money(volUsd)}</p>
          {positionId !== undefined ? (
            <button type="button" disabled={busy} onClick={() => void collect()} className="mt-5 w-full rounded-full border border-line py-2 text-sm">
              Collect fees
            </button>
          ) : null}
        </section>
      </div>

      <section id="add" className="mt-4 max-w-xl rounded-3xl border border-line bg-chip p-5">
        <h2 className="text-lg font-semibold">Add liquidity</h2>
        <p className="mt-1 text-sm text-muted">Full-range position. Tokens that do not fit the price are returned.</p>
        <label className="mt-4 block text-sm text-muted">
          ETH
          <input value={ethIn} onChange={(e) => setEthIn(e.target.value)} inputMode="decimal" placeholder="0" className="mt-1 w-full rounded-xl border border-line bg-bg px-3 py-2.5 outline-none" />
        </label>
        <button type="button" onClick={match} className="mt-2 text-xs text-gold">Match the pool price</button>
        <label className="mt-3 block text-sm text-muted">
          {coin.symbol}
          <input value={tokenIn} onChange={(e) => setTokenIn(e.target.value)} inputMode="decimal" placeholder="0" className="mt-1 w-full rounded-xl border border-line bg-bg px-3 py-2.5 outline-none" />
        </label>
        <button type="button" disabled={busy} onClick={() => void add()} className="mt-4 rounded-full bg-seal px-5 py-2.5 text-sm font-semibold text-onseal disabled:opacity-40">
          {busy ? "Confirming…" : account ? "Add liquidity" : "Connect wallet"}
        </button>
        {note ? <p className="mt-3 text-sm text-muted">{note}</p> : null}
      </section>
    </main>
  );
}
