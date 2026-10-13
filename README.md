# Beltchain

Jiu-jitsu belt promotions recorded on a public blockchain, plus a printable certificate whose QR fingerprint can be checked against the chain.

**Live prototype:** https://sphericalwave.github.io/beltchain/

## How it works

1. **Academy registers** (`registerAcademy`) and the registry admin marks it verified (`setVerified`). Unverified academies can't issue belts.
2. **Academy owner authorizes instructors** (`setInstructor`).
3. **Instructor records a promotion** (`promote`): student name, optional student wallet, belt, stripes/degree, ceremony date, and optionally their own black-belt record id for lineage.
4. **Anyone verifies**: `promotion(id)` returns the record; `fingerprint(id)` returns the hash printed on the certificate. Records are never deleted, only revoked (`revoke`) by the issuing instructor or academy owner.

Belts: White, Blue, Purple, Brown, Black, Red & Black, Red & White, Red. Stripes 0–4 on colored belts, degrees 0–6 on black.

## Layout

- `contracts/BeltRegistry.sol` — the registry
- `test/BeltRegistry.test.js` — Hardhat tests
- `scripts/deploy.js` — deploy script
- `docs/index.html` — certificate prototype, served by GitHub Pages (live editor, computes the same fingerprint as the contract)

## Commands

```sh
npm install
npx hardhat test
PRIVATE_KEY=0x... npm run deploy:sepolia   # Base Sepolia testnet, needs faucet ETH
```

## Open questions

- **Who is the admin?** Starts as the deployer. Could move to a multisig, or a federation.
- **Student privacy.** Names are public and permanent on-chain. Alternative: store only a hash of the name and keep the name on the paper certificate.
- **Chain.** Base chosen for sub-cent fees and Coinbase wallet onboarding. Any EVM chain works unchanged.
- **Backfill.** Existing belts (including instructors' own black belts for lineage) need a bulk-import path.
