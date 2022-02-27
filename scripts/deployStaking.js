const hre = require("hardhat");

async function main() {
  const RubicTokenStaker = await hre.ethers.getContractFactory("RubicTokenStaking");
  const RubicTokenStakerDeploy = await RubicTokenStaker.deploy('0x8E3BCC334657560253B83f08331d85267316e08a');

  await RubicTokenStakerDeploy.deployed();

  console.log("RubicTokenStakerDeploy deployed to:", RubicTokenStakerDeploy.address);

  //await RubicTokenStakerDeploy.setFreezeTime(60)
  await RubicTokenStakerDeploy.transferOwnership('0x3483eD7d3444A311a7585F0e59C9A74d6C111218')

  await hre.run("verify:verify", {
    address: RubicTokenStakerDeploy.address,
    constructorArguments: [
      '0x8E3BCC334657560253B83f08331d85267316e08a'
    ],
  });
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });