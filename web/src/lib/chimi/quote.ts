import { useEffect, useState } from "react";
import { encodeAbiParameters, keccak256, numberToHex, type Address, type Hex } from "viem";
import { POOL_FEE, isV4Live, routerAbi, v4RouterAbi, type Deployment } from "@/lib/chimi/chain";
import { publicClient } from "@/lib/chimi/client";
import type { Coin } from "@/lib/chimi/market";

/*
 * The exact quote for the trade panel. There is no quoter contract on GIWA, so the swap itself is run as a call that
 * changes nothing: the node is asked what the router would pay a stand-in wallet that, for the length of the call,
 * holds what is being spent. The answer accounts for the pool's fee, its depth and every range the price would cross.
 */

/** A wallet nobody holds. During a quote it is given the ETH or the coins to spend; nothing is ever sent from it. */
const STAND_IN: Address = "0x00000000000000000000000000000000c0de0001";

// Where a standard ERC-20 (Chimi's coins are OpenZeppelin's) keeps a balance and an allowance.
const balanceSlot = (holder: Address): Hex => keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [holder, 0n]));
const allowanceSlot = (owner: Address, spender: Address): Hex =>
  keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [spender, keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [owner, 1n]))]));

/** What the pool would pay out right now for `amountIn`: coins for ETH when buying, ETH for coins when selling. */
export async function quoteTrade(deployment: Deployment, coin: Coin, side: "buy" | "sell", amountIn: bigint): Promise<bigint> {
  if (coin.poolId && isV4Live(deployment)) {
    const { result } = await publicClient.simulateContract({
      address: deployment.v4.router,
      abi: v4RouterAbi,
      functionName: side === "buy" ? "quoteBuy" : "quoteSell",
      args: [coin.token, amountIn],
    });
    return result;
  }
  const buying = side === "buy";
  const word = numberToHex(amountIn, { size: 32 });
  const { result } = await publicClient.simulateContract({
    account: STAND_IN,
    address: deployment.swapRouter,
    abi: routerAbi,
    functionName: "exactInputSingle",
    args: [{ tokenIn: buying ? deployment.weth : coin.token, tokenOut: buying ? coin.token : deployment.weth, fee: POOL_FEE, recipient: STAND_IN, amountIn, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }],
    value: buying ? amountIn : 0n,
    stateOverride: buying
      ? [{ address: STAND_IN, balance: amountIn + 10n ** 18n }]
      : [
          {
            address: coin.token,
            stateDiff: [
              { slot: balanceSlot(STAND_IN), value: word },
              { slot: allowanceSlot(STAND_IN, deployment.swapRouter), value: word },
            ],
          },
        ],
  });
  return result;
}

export type LiveQuote = {
  /** The pool's answer for the amount typed, once it has come. */
  out?: bigint;
  /** True while the answer for what is typed now is on its way. */
  loading: boolean;
  /** True when the node couldn't price it; the panel falls back to an estimate. */
  failed: boolean;
};

const DEBOUNCE_MS = 220;
const AGAIN_MS = 12_000;

/**
 * The exact quote for what is typed in the trade panel, asked for a moment after typing stops and again every few
 * seconds while it sits there, since every trade by anyone moves it. `bump` asks again at once (after a trade).
 */
export function useQuote(deployment: Deployment | null | undefined, coin: Coin | null, side: "buy" | "sell", amountIn: bigint, bump = 0): LiveQuote {
  const key = coin && !coin.preview && deployment && amountIn > 0n ? `${coin.token}:${side}:${amountIn}` : "";
  const [state, setState] = useState<{ of: string; out?: bigint; failed?: boolean }>({ of: "" });

  useEffect(() => {
    if (!key || !coin || !deployment) return;
    let cancel = false;
    const ask = () =>
      quoteTrade(deployment, coin, side, amountIn)
        .then((out) => !cancel && setState({ of: key, out }))
        // An answer already showing for this amount stays; only a first failure falls back to the estimate.
        .catch(() => !cancel && setState((prev) => (prev.of === key && prev.out !== undefined ? prev : { of: key, failed: true })));
    const first = setTimeout(() => void ask(), DEBOUNCE_MS);
    const again = setInterval(() => document.visibilityState === "visible" && void ask(), AGAIN_MS);
    return () => {
      cancel = true;
      clearTimeout(first);
      clearInterval(again);
    };
    // The pool's price changing means the quote has too.
  }, [key, coin?.sqrtPriceX96, bump]);

  if (!key) return { loading: false, failed: false };
  const mine = state.of === key ? state : undefined;
  return { out: mine?.out, loading: !mine, failed: !!mine?.failed };
}
