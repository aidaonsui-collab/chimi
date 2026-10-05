import {
  createPublicClient,
  createWalletClient,
  custom,
  formatEther,
  http,
  parseEther,
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
  poolAbi,
  routerAbi,
  wethAbi,
  type Deployment,
} from "./chain";

type Coin = {
  token: Address;
  name: string;
  symbol: string;
  pool: Address;
  sqrtPriceX96: bigint;
  tokenIs0: boolean;
};

const Q96 = 2n ** 96n;

function $<T extends Element>(sel: string, root: ParentNode = document): T {
  const el = root.querySelector(sel);
  if (!el) throw new Error(`Missing ${sel}`);
  return el as T;
}

function ethereum(): EIP1193Provider | undefined {
  return (window as Window & { ethereum?: EIP1193Provider }).ethereum;
}

function wethPerToken(sqrtPriceX96: bigint, tokenIs0: boolean): bigint {
  if (sqrtPriceX96 === 0n) return 0n;
  const ratioX192 = sqrtPriceX96 * sqrtPriceX96;
  const one = 10n ** 18n;
  if (tokenIs0) return (ratioX192 * one) / (Q96 * Q96);
  return (Q96 * Q96 * one) / ratioX192;
}

function fmt(wei: bigint, digits = 6): string {
  const s = formatEther(wei);
  const [w, f = ""] = s.split(".");
  return f.length > 0 ? `${w}.${f.slice(0, digits)}` : w;
}

function short(err: unknown): string {
  if (err && typeof err === "object" && "shortMessage" in err) {
    return String((err as { shortMessage: string }).shortMessage);
  }
  if (err instanceof Error) return err.message;
  return "Transaction failed";
}

export async function render(root: HTMLElement) {
  const deployment = (await fetch("/deployments.json").then((r) => r.json())) as Deployment;
  const live = isDeployed(deployment);
  const publicClient = createPublicClient({ chain: giwaSepolia, transport: http() });

  root.innerHTML = `
    <div class="wrap">
      <header>
        <div class="brand">
          <img class="seal" src="/seal.jpg" alt="Chimi seal" />
          <div>
            <p class="kicker">치미 · GIWA Sepolia</p>
            <div class="mark">Chimi</div>
          </div>
        </div>
        <button id="wallet" class="ghost" type="button">Connect</button>
      </header>
      <p class="lede">A coin opens in its own pool. The supply is the liquidity, locked, and it can trade in the same press. There is no bonding curve.</p>
      <div class="grid">
        <section class="card">
          <h2>Press</h2>
          <label for="name">Name</label>
          <input id="name" maxlength="32" placeholder="Ridge Coin" />
          <label for="symbol">Symbol</label>
          <input id="symbol" maxlength="8" placeholder="RIDGE" />
          <label for="buy">First buy, ETH</label>
          <input id="buy" inputmode="decimal" placeholder="0" value="0" />
          <div class="row">
            <span class="hint" id="fee">Creation fee —</span>
            <button id="create" type="button">Press</button>
          </div>
          <p class="status" id="create-status"></p>
        </section>
        <section class="card">
          <h2>Pools</h2>
          <div id="board"></div>
          <div id="trade"></div>
        </section>
      </div>
    </div>
  `;

  let account: Address | undefined;
  let wallet: WalletClient | undefined;
  let coins: Coin[] = [];
  let selected = 0;

  const walletBtn = $<HTMLButtonElement>("#wallet", root)!;
  const createBtn = $<HTMLButtonElement>("#create", root)!;
  const status = $<HTMLParagraphElement>("#create-status", root)!
  const feeEl = $<HTMLSpanElement>("#fee", root)!;

  function setStatus(text: string, kind: "" | "bad" | "good" = "") {
    status.textContent = text;
    status.className = `status ${kind}`;
  }

  async function connect() {
    const eth = ethereum();
    if (!eth) {
      setStatus("No wallet found in this browser.", "bad");
      return;
    }
    wallet = createWalletClient({ chain: giwaSepolia, transport: custom(eth) });
    const accounts = await wallet.requestAddresses();
    account = accounts[0];
    try {
      await wallet.switchChain({ id: giwaSepolia.id });
    } catch {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: "0x164ce",
          chainName: "GIWA Sepolia",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://sepolia-rpc.giwa.io"],
          blockExplorerUrls: ["https://sepolia-explorer.giwa.io"],
        }],
      });
    }
    walletBtn.textContent = `${account.slice(0, 6)}…${account.slice(-4)}`;
    await refreshFee();
  }

  async function refreshFee() {
    if (!live || !account) {
      feeEl.textContent = live ? "Connect to see the creation fee" : "Not deployed on GIWA yet";
      return;
    }
    const due = await publicClient.readContract({
      address: deployment.factory,
      abi: factoryAbi,
      functionName: "creationFeeDue",
      args: [account],
    });
    feeEl.textContent = due === 0n ? "No creation fee" : `Creation fee ${fmt(due, 4)} ETH`;
  }

  async function loadBoard() {
    const board = $<HTMLDivElement>("#board", root)!;
    if (!live) {
      board.innerHTML = `<p class="empty">The Chimi factory is not on GIWA Sepolia yet. Deploy it, then this board fills in.</p>`;
      return;
    }
    const length = await publicClient.readContract({
      address: deployment.factory,
      abi: factoryAbi,
      functionName: "allTokensLength",
    });
    const next: Coin[] = [];
    for (let i = 0; i < Number(length); i++) {
      const token = await publicClient.readContract({
        address: deployment.factory,
        abi: factoryAbi,
        functionName: "allTokens",
        args: [BigInt(i)],
      });
      const [name, symbol, pool] = await Promise.all([
        publicClient.readContract({ address: token, abi: erc20Abi, functionName: "name" }),
        publicClient.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
        publicClient.readContract({ address: deployment.factory, abi: factoryAbi, functionName: "getPool", args: [token] }),
      ]);
      const [token0, slot0] = await Promise.all([
        publicClient.readContract({ address: pool.uniPool, abi: poolAbi, functionName: "token0" }),
        publicClient.readContract({ address: pool.uniPool, abi: poolAbi, functionName: "slot0" }),
      ]);
      next.push({
        token,
        name,
        symbol,
        pool: pool.uniPool,
        sqrtPriceX96: slot0[0],
        tokenIs0: token0.toLowerCase() === token.toLowerCase(),
      });
    }
    coins = next.reverse();
    if (selected >= coins.length) selected = 0;
    drawBoard();
  }

  function drawBoard() {
    const board = $<HTMLDivElement>("#board", root)!;
    if (coins.length === 0) {
      board.innerHTML = `<p class="empty">No coins yet.</p>`;
      $<HTMLDivElement>("#trade", root)!.innerHTML = "";
      return;
    }
    board.innerHTML = coins.map((c, i) => {
      const px = wethPerToken(c.sqrtPriceX96, c.tokenIs0);
      const fdv = px * 1_000_000_000n;
      return `<button class="coin ${i === selected ? "on" : ""}" data-i="${i}" type="button">
        <span class="stamp">${c.symbol.slice(0, 4)}</span>
        <span>
          <span class="sym">${c.name}</span>
          <span class="sub">$${c.symbol}</span>
        </span>
        <span class="price">${fmt(px)} ETH<span class="sub">${fmt(fdv, 2)} FDV</span></span>
      </button>`;
    }).join("");
    board.querySelectorAll<HTMLButtonElement>(".coin").forEach((btn) => {
      btn.addEventListener("click", () => {
        selected = Number(btn.dataset.i);
        drawBoard();
      });
    });
    drawTrade();
  }

  function drawTrade() {
    const host = $<HTMLDivElement>("#trade", root)!;
    const coin = coins[selected];
    if (!coin) {
      host.innerHTML = "";
      return;
    }
    const href = `${giwaSepolia.blockExplorers.default.url}/address/${coin.token}`;
    host.innerHTML = `
      <h2 style="margin-top:1rem">Trade $${coin.symbol}</h2>
      <p class="hint"><a href="${href}" style="color:var(--gold)">${coin.token}</a></p>
      <label for="amount">Amount</label>
      <input id="amount" inputmode="decimal" placeholder="0.01" />
      <div class="trade">
        <button id="buy" type="button">Buy</button>
        <button id="sell" class="ghost" type="button">Sell</button>
      </div>
      <div class="row">
        <span class="hint">Sell pays wrapped ETH.</span>
        <button id="unwrap" class="ghost" type="button">Unwrap</button>
      </div>
      <p class="status" id="trade-status"></p>
    `;
    $<HTMLButtonElement>("#buy", host)!.addEventListener("click", () => trade("buy"));
    $<HTMLButtonElement>("#sell", host)!.addEventListener("click", () => trade("sell"));
    $<HTMLButtonElement>("#unwrap", host)!.addEventListener("click", () => unwrap());
  }

  async function ensureWallet(): Promise<Address> {
    if (!account || !wallet) await connect();
    if (!account || !wallet) throw new Error("Connect a wallet first");
    return account;
  }

  async function createCoin() {
    if (!live) {
      setStatus("Deploy the factory before creating a coin.", "bad");
      return;
    }
    const name = $<HTMLInputElement>("#name", root)!.value.trim();
    const symbol = $<HTMLInputElement>("#symbol", root)!.value.trim();
    const buyRaw = $<HTMLInputElement>("#buy", root)!.value.trim() || "0";
    if (!name || !symbol) {
      setStatus("Name and symbol are required.", "bad");
      return;
    }
    try {
      const who = await ensureWallet();
      const fee = await publicClient.readContract({
        address: deployment.factory,
        abi: factoryAbi,
        functionName: "creationFeeDue",
        args: [who],
      });
      const value = fee + parseEther(buyRaw);
      setStatus("Confirm the launch in your wallet.");
      createBtn.disabled = true;
      const hash = await wallet!.writeContract({
        account: who,
        chain: giwaSepolia,
        address: deployment.factory,
        abi: factoryAbi,
        functionName: "createTokenMemeInstantQuoteWithEth",
        args: [name, symbol],
        value,
      });
      setStatus("Waiting for the pool.");
      await publicClient.waitForTransactionReceipt({ hash });
      setStatus(`${symbol} is in the pool.`, "good");
      await loadBoard();
    } catch (err) {
      setStatus(short(err), "bad");
    } finally {
      createBtn.disabled = false;
    }
  }

  async function trade(side: "buy" | "sell") {
    const tradeStatus = $<HTMLParagraphElement>("#trade-status", root)!;
    const coin = coins[selected];
    const raw = $<HTMLInputElement>("#amount", root)!.value.trim();
    if (!coin || !raw) {
      tradeStatus.textContent = "Enter an amount.";
      tradeStatus.className = "status bad";
      return;
    }
    try {
      const who = await ensureWallet();
      const amount = parseEther(raw);
      tradeStatus.textContent = "Confirm in your wallet.";
      tradeStatus.className = "status";
      if (side === "buy") {
        const hash = await wallet!.writeContract({
          account: who,
          chain: giwaSepolia,
          address: deployment.swapRouter,
          abi: routerAbi,
          functionName: "exactInputSingle",
          args: [{
            tokenIn: deployment.weth,
            tokenOut: coin.token,
            fee: POOL_FEE,
            recipient: who,
            amountIn: amount,
            amountOutMinimum: 0n,
            sqrtPriceLimitX96: 0n,
          }],
          value: amount,
        });
        await publicClient.waitForTransactionReceipt({ hash });
      } else {
        const hash = await wallet!.writeContract({
          account: who,
          chain: giwaSepolia,
          address: coin.token,
          abi: erc20Abi,
          functionName: "approve",
          args: [deployment.swapRouter, amount],
        });
        await publicClient.waitForTransactionReceipt({ hash });
        const swap = await wallet!.writeContract({
          account: who,
          chain: giwaSepolia,
          address: deployment.swapRouter,
          abi: routerAbi,
          functionName: "exactInputSingle",
          args: [{
            tokenIn: coin.token,
            tokenOut: deployment.weth,
            fee: POOL_FEE,
            recipient: who,
            amountIn: amount,
            amountOutMinimum: 0n,
            sqrtPriceLimitX96: 0n,
          }],
        });
        await publicClient.waitForTransactionReceipt({ hash: swap });
      }
      tradeStatus.textContent = side === "buy" ? "Bought." : "Sold for wrapped ETH.";
      tradeStatus.className = "status good";
      await loadBoard();
    } catch (err) {
      tradeStatus.textContent = short(err);
      tradeStatus.className = "status bad";
    }
  }

  async function unwrap() {
    const tradeStatus = $<HTMLParagraphElement>("#trade-status", root)!;
    try {
      const who = await ensureWallet();
      const bal = await publicClient.readContract({
        address: deployment.weth,
        abi: wethAbi,
        functionName: "balanceOf",
        args: [who],
      });
      if (bal === 0n) {
        tradeStatus.textContent = "No wrapped ETH to unwrap.";
        tradeStatus.className = "status";
        return;
      }
      const hash = await wallet!.writeContract({
        account: who,
        chain: giwaSepolia,
        address: deployment.weth,
        abi: wethAbi,
        functionName: "withdraw",
        args: [bal],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      tradeStatus.textContent = `Unwrapped ${fmt(bal, 4)} ETH.`;
      tradeStatus.className = "status good";
    } catch (err) {
      tradeStatus.textContent = short(err);
      tradeStatus.className = "status bad";
    }
  }

  walletBtn.addEventListener("click", () => { void connect(); });
  createBtn.addEventListener("click", () => { void createCoin(); });
  if (!live) createBtn.disabled = true;
  await refreshFee();
  try {
    await loadBoard();
  } catch (err) {
    $<HTMLDivElement>("#board", root)!.innerHTML = `<p class="empty">${short(err)}</p>`;
  }
}
