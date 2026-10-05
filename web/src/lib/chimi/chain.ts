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
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8 feeProtocol, bool unlocked)",
]);

export const routerAbi = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
]);

export const wethAbi = parseAbi([
  "function withdraw(uint256 wad)",
  "function balanceOf(address) view returns (uint256)",
]);

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
