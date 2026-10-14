const { expect } = require("chai");
const { ethers } = require("hardhat");

const Belt = { White: 0, Blue: 1, Purple: 2, Brown: 3, Black: 4, RedBlack: 5 };
const day = (iso) => BigInt(Math.floor(Date.parse(iso) / 1000));

describe("BeltRegistry", () => {
  let registry, admin, owner, professor, student, stranger;

  beforeEach(async () => {
    [admin, owner, professor, student, stranger] = await ethers.getSigners();
    registry = await ethers.deployContract("BeltRegistry");
    await registry.connect(owner).registerAcademy("Sample Academy");
    await registry.connect(admin).setVerified(1, true);
    await registry.connect(owner).setInstructor(1, professor.address, true);
  });

  it("records a promotion and exposes it", async () => {
    await expect(
      registry.connect(professor).promote(1, "Sam Student", student.address, Belt.Blue, 0, day("2026-10-13"), 0)
    )
      .to.emit(registry, "Promoted")
      .withArgs(1, 1, professor.address, "Sam Student", Belt.Blue, 0, day("2026-10-13"));

    const p = await registry.promotion(1);
    expect(p.studentName).to.equal("Sam Student");
    expect(p.belt).to.equal(Belt.Blue);
    expect(p.instructor).to.equal(professor.address);
    expect(p.revoked).to.equal(false);
    expect(await registry.promotionCount()).to.equal(1);
  });

  it("fingerprint matches the value the certificate page computes", async () => {
    await registry.connect(professor).promote(1, "Sam Student", ethers.ZeroAddress, Belt.Purple, 2, day("2026-10-13"), 0);
    const expected = ethers.solidityPackedKeccak256(
      ["uint256", "uint256", "address", "string", "uint8", "uint8", "uint64"],
      [1, 1, professor.address, "Sam Student", Belt.Purple, 2, day("2026-10-13")]
    );
    expect(await registry.fingerprint(1)).to.equal(expected);
  });

  it("rejects promotions from unverified academies", async () => {
    await registry.connect(owner).registerAcademy("Unverified Gym");
    await registry.connect(owner).setInstructor(2, professor.address, true);
    await expect(
      registry.connect(professor).promote(2, "X", ethers.ZeroAddress, Belt.Blue, 0, 0, 0)
    ).to.be.revertedWithCustomError(registry, "AcademyNotVerified");
  });

  it("rejects promotions from non-instructors", async () => {
    await expect(
      registry.connect(stranger).promote(1, "X", ethers.ZeroAddress, Belt.Black, 0, 0, 0)
    ).to.be.revertedWithCustomError(registry, "NotInstructor");
  });

  it("only the admin verifies and only the owner sets instructors", async () => {
    await expect(registry.connect(stranger).setVerified(1, true)).to.be.revertedWithCustomError(registry, "NotAdmin");
    await expect(
      registry.connect(stranger).setInstructor(1, stranger.address, true)
    ).to.be.revertedWithCustomError(registry, "NotAcademyOwner");
  });

  it("caps stripes at 4 and black-belt degrees at 6", async () => {
    await expect(
      registry.connect(professor).promote(1, "X", ethers.ZeroAddress, Belt.Brown, 5, 0, 0)
    ).to.be.revertedWithCustomError(registry, "InvalidDegree");
    await expect(registry.connect(professor).promote(1, "X", ethers.ZeroAddress, Belt.Black, 6, 0, 0)).to.not.be.reverted;
    await expect(
      registry.connect(professor).promote(1, "X", ethers.ZeroAddress, Belt.Black, 7, 0, 0)
    ).to.be.revertedWithCustomError(registry, "InvalidDegree");
  });

  it("links lineage only to the instructor's own black-belt record", async () => {
    // Record 1: professor's own black belt, issued by another instructor.
    await registry.connect(owner).setInstructor(1, owner.address, true);
    await registry.connect(owner).promote(1, "Professor", professor.address, Belt.Black, 1, 0, 0);
    // Record 2: a brown belt for the student.
    await registry.connect(owner).promote(1, "Sam Student", student.address, Belt.Brown, 0, 0, 0);

    await expect(registry.connect(professor).promote(1, "Sam Student", student.address, Belt.Black, 0, 0, 1)).to.not.be.reverted;
    expect((await registry.promotion(3)).instructorRecordId).to.equal(1);

    // Pointing at someone else's record, or a non-black record, fails.
    await expect(
      registry.connect(professor).promote(1, "Y", ethers.ZeroAddress, Belt.Blue, 0, 0, 2)
    ).to.be.revertedWithCustomError(registry, "InvalidLineage");
  });

  it("lets the issuer or academy owner revoke, once", async () => {
    await registry.connect(professor).promote(1, "Sam Student", ethers.ZeroAddress, Belt.Blue, 0, 0, 0);
    await expect(registry.connect(stranger).revoke(1, "nope")).to.be.revertedWithCustomError(registry, "NotAuthorized");
    await expect(registry.connect(owner).revoke(1, "entered in error"))
      .to.emit(registry, "Revoked")
      .withArgs(1, owner.address, "entered in error");
    expect((await registry.promotion(1)).revoked).to.equal(true);
    await expect(registry.connect(professor).revoke(1, "again")).to.be.revertedWithCustomError(registry, "AlreadyRevoked");
  });

  it("reverts on unknown records", async () => {
    await expect(registry.promotion(99)).to.be.revertedWithCustomError(registry, "UnknownRecord");
    await expect(registry.fingerprint(0)).to.be.revertedWithCustomError(registry, "UnknownRecord");
  });
});
