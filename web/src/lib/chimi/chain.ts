import { defineChain, parseAbi, zeroAddress, type Address } from "viem";

export const giwaSepolia = defineChain({
  id: 91342,
  name: "GIWA Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://sepolia-rpc.giwa.io"] } },
  blockExplorers: { default: { name: "GIWA Sepolia", url: "https://sepolia-explorer.giwa.io" } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

export const POOL_FEE = 10_000;

export const factoryAbi = parseAbi([
  "function createTokenMemeInstantQuoteWithEth(string name, string symbol) payable returns (address token)",
  "function createTokenWithEth(string name, string symbol, bool burnOwnCoin) payable returns (address token)",
  "event FeeChoice(address indexed token, bool burnsOwnCoin, address burner)",
  "function allTokensLength() view returns (uint256)",
  "function allTokens(uint256) view returns (address)",
  "function getPool(address token) view returns ((address creator, address uniPool, uint256 positionId, uint128 liquidity, int24 tickLower, int24 tickUpper))",
  "function creationFeeDue(address creator) view returns (uint256)",
  "event InstantQuoteTokenCreated(address indexed token, address indexed creator, address pool, uint256 positionId)",
  "function launchVirtualQuote() view returns (uint256)",
  "function QUOTE() view returns (address)",
  "function poolFee() view returns (uint24)",
]);

export const erc20Abi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

export const poolAbi = parseAbi([
  "function token0() view returns (address)",
  "function fee() view returns (uint24)",
  "function factory() view returns (address)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8 feeProtocol, bool unlocked)",
]);

export const routerAbi = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
  "function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)",
]);

/**
 * A swap addressed here stays in the router, so the next call in the same transaction can unwrap it
 * and pay the seller in ETH. (SwapRouter02 reads address 2 as "this contract".)
 */
export const ROUTER_KEEPS: Address = "0x0000000000000000000000000000000000000002";

export const lockerAbi = parseAbi([
  "function collectFees(uint256 tokenId) returns (uint256 amount0, uint256 amount1)",
  "function collectFeesBatch(uint256[] tokenIds)",
  "function creatorSplits(uint256 tokenId) view returns (address wallet, uint16 bps)",
  "function stakerSplits(uint256 tokenId) view returns (address wallet, uint16 bps)",
  "function locks(uint256 tokenId) view returns (address beneficiary, uint64 unlockTime, bool withdrawn, address backingWallet, uint16 backingBps)",
]);

export const tipsAbi = parseAbi([
  "function tip(address token, string message) payable",
  "function withdraw()",
  "function owed(address) view returns (uint256)",
  "function MIN_TIP() view returns (uint256)",
  "event Tipped(address indexed token, address indexed from, address indexed creator, uint256 amount, uint256 fee, string message)",
]);

/** The CHIMI buyback-burn and holder rewards (contracts/src/ChimiFlywheel.sol), for coins launched before the fee choice. */
export const flywheelAbi = parseAbi([
  "function pending() view returns (uint256 toBurn, uint256 toHolders)",
  "function burnBucket() view returns (uint256)",
  "function holderBucket() view returns (uint256)",
  "function totalIn() view returns (uint256)",
  "function totalSpentOnBurns() view returns (uint256)",
  "function totalChimiBurned() view returns (uint256)",
  "function totalPaid() view returns (uint256)",
  "function paidTo(address) view returns (uint256)",
  "function batchDone(uint256 period, uint256 batch) view returns (bool)",
  "function keeper() view returns (address)",
  "function sync()",
  "function buybackAndBurn(uint256 amountIn, uint256 minOut) returns (uint256 out)",
  "function distribute(uint256 period, uint256 batch, address[] to, uint256[] amounts) returns (uint256 sent)",
  "event Paid(uint256 indexed period, address indexed to, uint256 amount)",
  "event BoughtAndBurned(uint256 ethIn, uint256 chimiBurned)",
]);

/** The burns in launch fees (contracts/src/ChimiBurner.sol): 5% of every new coin's ETH fees buys CHIMI and burns it, and a coin
 *  whose creator ticked "burn my coin" has its own CoinBurner that spends 10% on the coin itself. */
export const burnerAbi = parseAbi([
  "function pendingChimi() view returns (uint256)",
  "function totalSpentOnChimi() view returns (uint256)",
  "function totalChimiBurned() view returns (uint256)",
  "function burnerOf(address coin) view returns (address)",
  "function burningCoinsLength() view returns (uint256)",
  "function burningCoins(uint256) view returns (address)",
  "function keeper() view returns (address)",
  "function burnChimi(uint256 amountIn, uint256 minOut) returns (uint256 out)",
  "function burnCoin(address coin, uint256 amountIn, uint256 minOut) returns (uint256 spent, uint256 out)",
  "event ChimiBoughtAndBurned(uint256 ethIn, uint256 chimiBurned)",
  "event CoinBoughtAndBurned(address indexed coin, uint256 wethIn, uint256 coinsBurned)",
]);

export const coinBurnerAbi = parseAbi([
  "function pending() view returns (uint256)",
  "function totalSpent() view returns (uint256)",
  "function totalBurned() view returns (uint256)",
]);

export const wethAbi = parseAbi([
  "function deposit() payable",
  "function withdraw(uint256 wad)",
  "function balanceOf(address) view returns (uint256)",
]);

export const positionManagerAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function increaseLiquidity((uint256 tokenId, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, uint256 deadline) params) payable returns (uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline) params) payable returns (uint256 amount0, uint256 amount1)",
  "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max) params) payable returns (uint256 amount0, uint256 amount1)",
  "function burn(uint256 tokenId) payable",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
  "function sweepToken(address token, uint256 amountMinimum, address recipient) payable",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
]);

export const FULL_RANGE = { lower: -887200, upper: 887200 } as const;

/** One of the DEXes Chimi coins trade on: a copy of Uniswap v3 with its position manager, router and locker. */
export type Dex = {
  fee: number;
  tickSpacing: number;
  uniFactory: Address;
  positionManager: Address;
  swapRouter: Address;
  locker: Address;
};

export type Deployment = {
  chainId: number;
  name: string;
  weth: Address;
  /** The first DEX's addresses (kept at the top level for everything written before there were two). */
  uniFactory: Address;
  positionManager: Address;
  swapRouter: Address;
  bpsSource: Address;
  locker: Address;
  factory: Address;
  /** Every DEX, oldest first; new coins launch on the last. Absent before the second DEX. */
  dexes?: Dex[];
  /** The CHIMI buyback-burn and holder rewards, fed by coins launched on the 2% DEX before the fee choice. */
  flywheel?: { address: Address; chimi: Address; keeper: Address; minHold: string };
  /**
   * The burns in launch fees (ChimiBurner): the 5% CHIMI burn every coin launched since pays, and each burning coin's own
   * burner. Its presence means launches offer the choice. `block` is about when it was deployed.
   */
  burner?: { address: Address; chimi: Address; keeper: Address; block: number };
  /** Tips to creators while they stream (90% creator / 10% platform). Absent until it's deployed. */
  tips?: { address: Address; block: number };
};

/** The DEXes, oldest first. A deployment from before the second one has just its first. */
export function dexesOf(d: Deployment): Dex[] {
  if (d.dexes && d.dexes.length > 0) return d.dexes;
  return [{ fee: POOL_FEE, tickSpacing: 200, uniFactory: d.uniFactory, positionManager: d.positionManager, swapRouter: d.swapRouter, locker: d.locker }];
}

/** Where new coins launch. */
export const launchDex = (d: Deployment): Dex => dexesOf(d).at(-1)!;

/**
 * The DEX a coin trades on: the one whose factory made its pool, else the one with its fee, else the first. A coin
 * read before its pool's factory is known falls back by fee, which tells the two DEXes apart (1% and 2%).
 */
export function dexOf(d: Deployment, coin: { uniFactory?: string; fee?: number }): Dex {
  const all = dexesOf(d);
  const byFactory = coin.uniFactory && all.find((x) => x.uniFactory.toLowerCase() === coin.uniFactory!.toLowerCase());
  if (byFactory) return byFactory;
  return all.find((x) => x.fee === coin.fee) ?? all[0]!;
}

export function isDeployed(d: Deployment): boolean {
  return d.factory !== zeroAddress && d.swapRouter !== zeroAddress;
}
