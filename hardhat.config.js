require("@nomicfoundation/hardhat-toolbox");

const accounts = process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [];

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true },
  },
  networks: {
    // Free testnet for the prototype. Get test ETH from a Base Sepolia faucet.
    baseSepolia: { url: process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org", chainId: 84532, accounts },
    // Production candidate: Base mainnet, a promotion costs well under a cent.
    base: { url: process.env.BASE_RPC || "https://mainnet.base.org", chainId: 8453, accounts },
  },
};
