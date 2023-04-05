import { expect } from "chai";
import { ethers, network } from "hardhat";

import { randomHex } from "./utils/encoding";
import { faucet } from "./utils/faucet";
import { VERSION } from "./utils/helpers";
import { whileImpersonating } from "./utils/impersonate";

import type {
  ERC721PartnerSeaDrop,
  IERC721,
  ISeaDrop,
} from "../typechain-types";
import type { Wallet } from "ethers";

describe(`SeaDrop (v${VERSION})`, function () {
  const { provider } = ethers;
  let seadrop: ISeaDrop;
  let token: ERC721PartnerSeaDrop;
  let standard721Token: IERC721;
  let owner: Wallet;
  let admin: Wallet;
  let minter: Wallet;

  after(async () => {
    await network.provider.request({
      method: "hardhat_reset",
    });
  });

  before(async () => {
    // Set the wallets
    owner = new ethers.Wallet(randomHex(32), provider);
    admin = new ethers.Wallet(randomHex(32), provider);
    minter = new ethers.Wallet(randomHex(32), provider);

    // Add eth to wallets
    for (const wallet of [owner, admin, minter]) {
      await faucet(wallet.address, provider);
    }

    // Deploy SeaDrop
    const SeaDrop = await ethers.getContractFactory("SeaDrop", owner);
    seadrop = await SeaDrop.deploy();

    // Deploy token
    const ERC721PartnerSeaDrop = await ethers.getContractFactory(
      "ERC721PartnerSeaDrop",
      owner
    );
    token = await ERC721PartnerSeaDrop.deploy("", "", admin.address, [
      seadrop.address,
    ]);

    // Deploy a standard (non-IER721SeaDrop) token
    const ERC721A = await ethers.getContractFactory("ERC721A", owner);
    standard721Token = (await ERC721A.deploy("", "")) as unknown as IERC721;
  });

  it("Should not let a non-INonFungibleSeaDropToken token contract use the token methods", async () => {
    await whileImpersonating(
      standard721Token.address,
      provider,
      async (impersonatedSigner) => {
        const publicDrop = {
          mintPrice: 1000,
          maxTotalMintableByWallet: 1,
          startTime: Math.round(Date.now() / 1000) - 100,
          endTime: Math.round(Date.now() / 1000) + 100,
          feeBps: 1000,
          restrictFeeRecipients: false,
        };
        await expect(
          seadrop.connect(impersonatedSigner).updatePublicDrop(publicDrop)
        ).to.be.revertedWithCustomError(token, "OnlyINonFungibleSeaDropToken");

        const allowListData = {
          merkleRoot: ethers.constants.HashZero,
          publicKeyURIs: [],
          allowListURI: "",
        };
        await expect(
          seadrop.connect(impersonatedSigner).updateAllowList(allowListData)
        ).to.be.revertedWithCustomError(token, "OnlyINonFungibleSeaDropToken");

        const tokenGatedDropStage = {
          mintPrice: ethers.utils.parseEther("0.1"),
          maxTotalMintableByWallet: 10,
          startTime: Math.round(Date.now() / 1000) - 100,
          endTime: Math.round(Date.now() / 1000) + 500,
          dropStageIndex: 1,
          maxTokenSupplyForStage: 100,
          feeBps: 100,
          restrictFeeRecipients: true,
        };
        await expect(
          seadrop
            .connect(impersonatedSigner)
            .updateTokenGatedDrop(minter.address, tokenGatedDropStage)
        ).to.be.revertedWithCustomError(token, "OnlyINonFungibleSeaDropToken");

        await expect(
          seadrop
            .connect(impersonatedSigner)
            .updateCreatorPayoutAddress(minter.address)
        ).to.be.revertedWithCustomError(token, "OnlyINonFungibleSeaDropToken");

        await expect(
          seadrop
            .connect(impersonatedSigner)
            .updateAllowedFeeRecipient(minter.address, true)
        ).to.be.revertedWithCustomError(token, "OnlyINonFungibleSeaDropToken");

        const signedMintValidationParams = {
          minMintPrice: 1,
          maxMaxTotalMintableByWallet: 11,
          minStartTime: 50,
          maxEndTime: "100000000000",
          maxMaxTokenSupplyForStage: 10000,
          minFeeBps: 1,
          maxFeeBps: 9000,
        };
        await expect(
          seadrop
            .connect(impersonatedSigner)
            .updateSignedMintValidationParams(
              minter.address,
              signedMintValidationParams
            )
        ).to.be.revertedWithCustomError(token, "OnlyINonFungibleSeaDropToken");

        await expect(
          seadrop.connect(impersonatedSigner).updateDropURI("http://test.com")
        ).to.be.revertedWithCustomError(token, "OnlyINonFungibleSeaDropToken");

        await expect(
          seadrop.connect(impersonatedSigner).updatePayer(minter.address, true)
        ).to.be.revertedWithCustomError(token, "OnlyINonFungibleSeaDropToken");
      }
    );

    await expect(
      token.connect(owner).updateDropURI(seadrop.address, "http://test.com")
    )
      .to.emit(seadrop, "DropURIUpdated")
      .withArgs(token.address, "http://test.com");
  });

  it("Should not allow reentrancy during mint", async () => {
    // Set a public drop with maxTotalMintableByWallet: 1
    // and restrictFeeRecipient: false
    await token.setMaxSupply(10);
    const oneEther = ethers.utils.parseEther("1");
    const publicDrop = {
      mintPrice: oneEther,
      maxTotalMintableByWallet: 1,
      startTime: Math.round(Date.now() / 1000) - 100,
      endTime: Math.round(Date.now() / 1000) + 100,
      feeBps: 1000,
      restrictFeeRecipients: false,
    };
    await whileImpersonating(
      token.address,
      provider,
      async (impersonatedSigner) => {
        await seadrop.connect(impersonatedSigner).updatePublicDrop(publicDrop);
      }
    );

    const MaliciousRecipientFactory = await ethers.getContractFactory(
      "MaliciousRecipient",
      owner
    );
    const maliciousRecipient = await MaliciousRecipientFactory.deploy();

    // Set the creator address to MaliciousRecipient.
    await token
      .connect(owner)
      .updateCreatorPayoutAddress(seadrop.address, maliciousRecipient.address);

    // Should not be able to mint with reentrancy.
    await maliciousRecipient.setStartAttack({ value: oneEther.mul(10) });
    await expect(
      maliciousRecipient.attack(seadrop.address, token.address)
    ).to.be.revertedWithCustomError(token, "ETH_TRANSFER_FAILED");
    expect(await token.totalSupply()).to.eq(0);
  });
});
