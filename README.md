# Solana Trading Server

An MCP server that provides Solana token trading capabilities through Jupiter DEX aggregator.

## Features

- Create and import Solana wallets
- Check token balances
- Get swap quotes with customizable slippage
- Execute token swaps
- Transaction status tracking

## Running Locally

1. Install dependencies:
```bash
npm install
```

2. Build the TypeScript code:
```bash
npm run build
```

3. Run the server:
```bash
node build/index.js
```

## Running 24/7 with Docker

1. Build and start the container:
```bash
docker-compose up -d
```

2. View logs:
```bash
docker-compose logs -f
```

3. Stop the server:
```bash
docker-compose down
```

The server will automatically restart if it crashes or if the system reboots.

## Testing the Functionality

1. Create a new wallet:
```typescript
const response = await use_mcp_tool({
  server_name: "solana-trading",
  tool_name: "create_wallet",
  arguments: {}
});
// Save the publicKey and privateKey
```

2. Import an existing wallet:
```typescript
const response = await use_mcp_tool({
  server_name: "solana-trading",
  tool_name: "import_wallet",
  arguments: {
    privateKey: "2uLPPgFspK9cMThZqZJTPn1yRX4uQSECsh2GGZAj2P4vb2QSvGeWGmb8kSqLWNV9E8W4pBZTeCuAfyAiA4odn37m"
  }
});
```

3. Check token balance:
```typescript
const response = await use_mcp_tool({
  server_name: "solana-trading",
  tool_name: "get_token_balance",
  arguments: {
    walletAddress: "wallet-address",
    tokenMint: "token-mint-address"
  }
});
```

4. Get a swap quote:
```typescript
const response = await use_mcp_tool({
  server_name: "solana-trading",
  tool_name: "get_swap_quote",
  arguments: {
    inputMint: "input-token-mint",
    outputMint: "output-token-mint",
    amount: "1000000", // Amount in smallest units
    slippage: 1 // 1% slippage
  }
});
// Save the quote for executing the swap
```

5. Execute a swap:
```typescript
const response = await use_mcp_tool({
  server_name: "solana-trading",
  tool_name: "execute_swap",
  arguments: {
    quote: quoteFromPreviousStep,
    walletPrivateKey: "your-wallet-private-key"
  }
});
```

## Example Token Mints

Common Solana tokens for testing:

- SOL (Wrapped): So11111111111111111111111111111111111111112
- USDC: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
- BONK: DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263
- ORCA: orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE

## Monitoring & Maintenance

1. Check server status:
```bash
docker ps
```

2. View real-time logs:
```bash
docker-compose logs -f
```

3. Restart the server:
```bash
docker-compose restart
```

4. Update the server:
```bash
git pull
docker-compose down
docker-compose up -d --build
```

## Error Handling

The server provides detailed error messages for common issues:

- Invalid private key
- Invalid wallet address
- Invalid token mint
- Insufficient balance
- Failed transactions
- Network errors

Check the logs for detailed error information when issues occur.
