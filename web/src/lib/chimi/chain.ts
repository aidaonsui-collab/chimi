import { defineChain, parseAbi, zeroAddress, type Address } from "viem";

export const giwaSepolia = defineChain({
  id: 91342,
  name: "GIWA Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://sepolia-rpc.giwa.io"] } },
  blockExplorers: { default: { name: "GIWA Sepolia", url: "https://sepolia-explorer.giwa.io" } },
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
};

export function isDeployed(d: Deployment): boolean {
  return d.factory !== zeroAddress && d.swapRouter !== zeroAddress;
}
