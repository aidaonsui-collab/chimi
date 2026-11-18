import { defineChain, parseAbi, parseAbiItem, zeroAddress, type Address } from "viem";

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

export type Deployment = {
  chainId: number;
  name: string;
  weth: Address;
  uniFactory: Address;
  positionManager: Address;
  swapRouter: Address;
  bpsSource: Address;
  locker: Address;
  factory: Address;
  /** Taxed Uniswap v4 launches. Absent, or with zero addresses, until those contracts are deployed. */
  v4?: V4Deployment;
};

/** Addresses for the taxed v4 launch path. Position manager, StateView, quoter and the Universal Router
 *  are recorded for the runbook; trading does not use them. */
export type V4Deployment = {
  poolManager: Address;
  permit2: Address;
  positionManager: Address;
  stateView: Address;
  quoter: Address;
  universalRouter: Address;
  launcher: Address;
  tokenFactory: Address;
  locker: Address;
  hook: Address;
  router: Address;
  treasury: Address;
};

export function isDeployed(d: Deployment): boolean {
  return d.factory !== zeroAddress && d.swapRouter !== zeroAddress;
}

/** True only when the taxed-launch contracts have addresses. The v4 UI stays hidden until then. */
export function isV4Live(d: Deployment | null | undefined): d is Deployment & { v4: V4Deployment } {
  const v = d?.v4;
  if (!v) return false;
  return [v.poolManager, v.launcher, v.hook, v.router, v.locker].every((a) => !!a && a !== zeroAddress);
}

export const bpsAbi = parseAbi([
  "function lpMemeCreatorBps() view returns (uint16)",
  "function lpMemeStakerBps() view returns (uint16)",
]);

export const v4LauncherAbi = parseAbi([
  "function launch((string name, string symbol, uint256 minTokensOut, uint16 buyTaxBps, uint16 sellTaxBps, uint16 creatorBps, uint16 holdersBps, uint16 buybackBps, bool antiSnipe) p) payable returns (address token, uint256 tokensOut)",
  "function creationFeeDue(address) view returns (uint256)",
  "function allTokensLength() view returns (uint256)",
  "function allTokens(uint256) view returns (address)",
  "function getLaunch(address token) view returns ((address creator, uint64 createdAt, uint64 createdBlock, uint64 windowEndsAt, uint64 unlocksAt, int24 tickLower, int24 tickUpper, uint128 liquidity, bytes32 poolId, uint256 startMarketCap))",
  "function reserves(address token) view returns (uint256 ethAmount, uint256 tokenAmount, uint160 sqrtPriceX96)",
  "function quoteLaunch(uint256 ethIn, uint16 buyTaxBps) view returns (uint256)",
  "function startMarketCap() view returns (uint256)",
  "function platformBps() view returns (uint16)",
  "function bpsSource() view returns (address)",
  "function maxFirstBuyBps() view returns (uint16)",
  "event TokenLaunched(address indexed token, address indexed creator, string name, string symbol, bytes32 poolId, uint256 startMarketCap, uint16 buyTaxBps, uint16 sellTaxBps, uint16 platformBps, uint16 stakerBps, uint16 creatorBps, uint16 holdersBps, uint16 buybackBps, uint64 unlocksAt, bool antiSnipe)",
]);

export const v4HookAbi = parseAbi([
  "function taxOf(address token) view returns ((address token, address creator, uint16 buyBps, uint16 sellBps, uint16 platformBps, uint16 stakerBps, uint16 creatorBps, uint16 holdersBps, uint16 buybackBps))",
  "function creatorFees(address creator) view returns (uint256)",
  "function creatorFeesOf(address token, address creator) view returns (uint256)",
  "function claimCreatorFees() returns (uint256)",
]);

export const v4RouterAbi = parseAbi([
  "function buy(address token, uint256 minOut, address recipient, uint256 deadline) payable returns (uint256)",
  "function sell(address token, uint256 amountIn, uint256 minOut, address recipient, uint256 deadline) returns (uint256)",
  "function quoteBuy(address token, uint256 ethIn) returns (uint256)",
  "function quoteSell(address token, uint256 amountIn) returns (uint256)",
]);

/** PoolManager Swap. `amount0` and `amount1` are what the trader is owed (the opposite sign from a v3 Swap). */
export const v4SwapEvent = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
);
