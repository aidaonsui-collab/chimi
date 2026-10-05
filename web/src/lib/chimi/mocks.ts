import type { Address } from "viem";
import type { Coin } from "@/lib/chimi/market";

function seal(
  token: Address,
  name: string,
  symbol: string,
  sqrtPriceX96: bigint,
  liquidity: bigint,
): Coin {
  return {
    token,
    name,
    symbol,
    pool: "0x1000000000000000000000000000000000000001",
    creator: "0x2222222222222222222222222222222222222222",
    sqrtPriceX96,
    tokenIs0: true,
    liquidity,
    preview: true,
  };
}

/** Layout-only seals. Shown when the factory has not pressed a real coin. */
export const previewCoins: Coin[] = [
  seal("0xaaa1000000000000000000000000000000000001", "Ridge Coin", "RIDGE", 274454405730059595204971223n, 842000000000000000n),
  seal("0xaaa1000000000000000000000000000000000002", "Roof Cat", "NYANG", 726138103787758258253556512n, 2100000000000000000n),
  seal("0xaaa1000000000000000000000000000000000003", "Night Tile", "TILE", 141727645691436568236881372n, 410000000000000000n),
  seal("0xaaa1000000000000000000000000000000000004", "First Press", "PRESS", 1148125151902527985205229170n, 5600000000000000000n),
  seal("0xaaa1000000000000000000000000000000000005", "Blue Hour", "HOUR", 97034285709124592626698884n, 125000000000000000n),
  seal("0xaaa1000000000000000000000000000000000006", "Alley Lantern", "GOLMOK", 531478671342887130888305148n, 980000000000000000n),
];
