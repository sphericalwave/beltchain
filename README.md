# Beltchain

Jiu-jitsu belt promotions recorded on a public blockchain, plus a printable certificate whose QR fingerprint can be checked against the chain.

**Live prototype:** https://sphericalwave.com/beltchain/

## How it works

1. **Academy registers** (`registerAcademy`) and the registry admin marks it verified (`setVerified`). Unverified academies can't issue belts.
2. **Academy owner authorizes instructors** (`setInstructor`) and sets the gym logo hash (`setLogo`).
3. **Instructors save their own name, title and signature hash** (`setInstructorProfile`). Only the instructor's wallet can do this, so an owner can't forge a signature.
4. **Instructor records a promotion** (`promote`): student name, optional student wallet, belt, stripes/degree, ceremony date, optionally their own black-belt record id for lineage, and optionally a second signer. Sending the transaction is the promoting instructor's signature.
5. **Second signer co-signs** (`cosign`). Until then the record is pending and `isComplete(id)` is false. The co-signer must be a different active instructor of the same academy, with a saved signature.
6. **Anyone verifies**: `promotion(id)` returns the record, including each signer, when they signed and the signature hash in effect at that moment; `fingerprint(id)` returns the hash printed on the certificate. Records are never deleted, only revoked (`revoke`) by the issuing instructor or academy owner.

Logo and signature images live off-chain; only their keccak256 hashes are stored. In the prototype page they're kept in the browser (`localStorage`, key `beltchain.profile.v1`).

Belts: White, Blue, Purple, Brown, Black, Red & Black, Red & White, Red. Stripes 0–4 on colored belts, degrees 0–6 on black.

## Layout

- `contracts/BeltRegistry.sol` — the registry
- `test/BeltRegistry.test.js` — Hardhat tests
- `scripts/deploy.js` — deploy script
- `docs/index.html` — certificate prototype, served by GitHub Pages: live editor, gym profile (logo crop, signature pad), two-signer pending flow; computes the same fingerprint as the contract

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
