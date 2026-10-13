const { ethers, network } = require("hardhat");

async function main() {
  const registry = await ethers.deployContract("BeltRegistry");
  await registry.waitForDeployment();
  console.log(`BeltRegistry deployed to ${await registry.getAddress()} on ${network.name}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
