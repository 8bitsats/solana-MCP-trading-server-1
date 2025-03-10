#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { Connection, Keypair, PublicKey, Transaction, TransactionError } from '@solana/web3.js';
import { getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import bs58 from 'bs58';
import fetch from 'node-fetch';

// Constants
const JUPITER_QUOTE_API = 'https://quote-api.jup.ag/v6';
const DEFAULT_RPC = 'HELIUS RPC HERe';

type Arguments = Record<string, unknown>;

interface SwapQuote {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippage: number;
}

interface WalletDetails {
  publicKey: string;
  privateKey: string;
}

interface SwapResult {
  txid: string;
  status: 'confirmed' | 'failed';
}

class SolanaTrader {
  private connection: Connection;

  constructor(rpcUrl: string = DEFAULT_RPC) {
    this.connection = new Connection(rpcUrl);
  }

  createWallet(): WalletDetails {
    const keypair = Keypair.generate();
    return {
      publicKey: keypair.publicKey.toString(),
      privateKey: bs58.encode(keypair.secretKey),
    };
  }

  importWallet(privateKey: string): WalletDetails {
    try {
      const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
      return {
        publicKey: keypair.publicKey.toString(),
        privateKey,
      };
    } catch (error) {
      throw new Error('Invalid private key');
    }
  }

  async getTokenBalance(walletAddress: string, tokenMint: string): Promise<string> {
    try {
      const wallet = new PublicKey(walletAddress);
      const mint = new PublicKey(tokenMint);
      
      const tokenAccount = await getOrCreateAssociatedTokenAccount(
        this.connection,
        Keypair.generate(), // dummy signer for read-only
        mint,
        wallet
      );

      const balance = await this.connection.getTokenAccountBalance(tokenAccount.address);
      return balance.value.uiAmountString || '0';
    } catch (error) {
      console.error('Error getting token balance:', error);
      throw error;
    }
  }

  async getSwapQuote(params: SwapQuote): Promise<unknown> {
    try {
      const response = await fetch(
        `${JUPITER_QUOTE_API}/quote?inputMint=${params.inputMint}&outputMint=${params.outputMint}&amount=${params.amount}&slippageBps=${params.slippage * 100}`,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to get swap quote');
      }

      const quote = await response.json();
      return quote;
    } catch (error) {
      console.error('Error getting swap quote:', error);
      throw error;
    }
  }

  async executeSwap(
    quote: unknown,
    walletPrivateKey: string
  ): Promise<SwapResult> {
    try {
      // Get serialized transactions from Jupiter
      const swapResponse = await fetch(`${JUPITER_QUOTE_API}/swap`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: Keypair.fromSecretKey(
            bs58.decode(walletPrivateKey)
          ).publicKey.toString(),
        }),
      });

      if (!swapResponse.ok) {
        throw new Error('Failed to prepare swap transaction');
      }

      const swapData = await swapResponse.json() as { swapTransaction: string };
      const swapTransactionBuf = Buffer.from(swapData.swapTransaction, 'base64');
      
      // Deserialize and sign transaction
      const transaction = Transaction.from(swapTransactionBuf);
      const keypair = Keypair.fromSecretKey(bs58.decode(walletPrivateKey));
      transaction.sign(keypair);

      // Send transaction
      const txid = await this.connection.sendRawTransaction(
        transaction.serialize(),
        { skipPreflight: true }
      );

      // Wait for confirmation
      const confirmation = await this.connection.confirmTransaction(txid);
      
      if (confirmation.value.err) {
        throw new Error('Transaction failed');
      }

      return {
        txid,
        status: 'confirmed',
      };
    } catch (error) {
      console.error('Error executing swap:', error);
      throw error;
    }
  }
}

class SolanaTradeServer {
  private server: Server;
  private trader: SolanaTrader;

  constructor() {
    this.server = new Server(
      {
        name: 'solana-trading-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.trader = new SolanaTrader();
    
    this.setupToolHandlers();
    
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'create_wallet',
          description: 'Create a new Solana wallet',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          name: 'import_wallet',
          description: 'Import an existing Solana wallet using private key',
          inputSchema: {
            type: 'object',
            properties: {
              privateKey: {
                type: 'string',
                description: 'Base58 encoded private key',
              },
            },
            required: ['privateKey'],
          },
        },
        {
          name: 'get_token_balance',
          description: 'Get token balance for a wallet',
          inputSchema: {
            type: 'object',
            properties: {
              walletAddress: {
                type: 'string',
                description: 'Solana wallet address',
              },
              tokenMint: {
                type: 'string',
                description: 'Token mint address',
              },
            },
            required: ['walletAddress', 'tokenMint'],
          },
        },
        {
          name: 'get_swap_quote',
          description: 'Get a quote for swapping tokens',
          inputSchema: {
            type: 'object',
            properties: {
              inputMint: {
                type: 'string',
                description: 'Input token mint address',
              },
              outputMint: {
                type: 'string',
                description: 'Output token mint address',
              },
              amount: {
                type: 'string',
                description: 'Amount of input tokens (in smallest units)',
              },
              slippage: {
                type: 'number',
                description: 'Slippage tolerance (0-100)',
              },
            },
            required: ['inputMint', 'outputMint', 'amount', 'slippage'],
          },
        },
        {
          name: 'execute_swap',
          description: 'Execute a token swap',
          inputSchema: {
            type: 'object',
            properties: {
              quote: {
                type: 'object',
                description: 'Quote object from get_swap_quote',
              },
              walletPrivateKey: {
                type: 'string',
                description: 'Base58 encoded private key of the wallet',
              },
            },
            required: ['quote', 'walletPrivateKey'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const args = request.params.arguments as Arguments;
        
        switch (request.params.name) {
          case 'create_wallet': {
            const wallet = this.trader.createWallet();
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(wallet, null, 2),
                },
              ],
            };
          }

          case 'import_wallet': {
            const privateKey = args.privateKey as string;
            if (!privateKey) {
              throw new Error('Private key is required');
            }
            
            const wallet = this.trader.importWallet(privateKey);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(wallet, null, 2),
                },
              ],
            };
          }

          case 'get_token_balance': {
            const walletAddress = args.walletAddress as string;
            const tokenMint = args.tokenMint as string;
            
            if (!walletAddress || !tokenMint) {
              throw new Error('Wallet address and token mint are required');
            }
            
            const balance = await this.trader.getTokenBalance(walletAddress, tokenMint);
            return {
              content: [
                {
                  type: 'text',
                  text: balance,
                },
              ],
            };
          }

          case 'get_swap_quote': {
            const inputMint = args.inputMint as string;
            const outputMint = args.outputMint as string;
            const amount = args.amount as string;
            const slippage = args.slippage as number;
            
            if (!inputMint || !outputMint || !amount || typeof slippage !== 'number') {
              throw new Error('Invalid swap quote parameters');
            }
            
            const quote = await this.trader.getSwapQuote({
              inputMint,
              outputMint,
              amount,
              slippage,
            });
            
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(quote, null, 2),
                },
              ],
            };
          }

          case 'execute_swap': {
            const quote = args.quote as unknown;
            const walletPrivateKey = args.walletPrivateKey as string;
            
            if (!quote || !walletPrivateKey) {
              throw new Error('Quote and wallet private key are required');
            }
            
            const result = await this.trader.executeSwap(quote, walletPrivateKey);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error: unknown) {
        console.error(`Error in ${request.params.name}:`, error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        return {
          content: [
            {
              type: 'text',
              text: errorMessage,
            },
          ],
          isError: true,
        };
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Solana Trading Server running on stdio');
  }
}

// Import wallet with private key
const privateKey = "2uLPPgFspK9cMThZqZJTPn1yRX4uQSECsh2GGZAj2P4vb2QSvGeWGmb8kSqLWNV9E8W4pBZTeCuAfyAiA4odn37m";
const trader = new SolanaTrader();
const wallet = trader.importWallet(privateKey);
console.error('Imported wallet with public key:', wallet.publicKey);

const server = new SolanaTradeServer();
server.run().catch(console.error);
