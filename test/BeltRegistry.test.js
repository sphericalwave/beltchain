const { expect } = require("chai");
const { ethers } = require("hardhat");

const Belt = { White: 0, Blue: 1, Purple: 2, Brown: 3, Black: 4, RedBlack: 5 };
const day = (iso) => BigInt(Math.floor(Date.parse(iso) / 1000));
const sig = (label) => ethers.keccak256(ethers.toUtf8Bytes(`signature-png:${label}`));

describe("BeltRegistry", () => {
  let registry, admin, owner, professor, head, student, stranger;

  const input = (overrides = {}) => ({
    academyId: 1,
    studentName: "Sam Student",
    student: ethers.ZeroAddress,
    belt: Belt.Blue,
    degree: 0,
    promotedOn: day("2026-10-13"),
    instructorRecordId: 0,
    cosigner: ethers.ZeroAddress,
    ...overrides,
  });

  beforeEach(async () => {
    [admin, owner, professor, head, student, stranger] = await ethers.getSigners();
    registry = await ethers.deployContract("BeltRegistry");
    await registry.connect(owner).registerAcademy("Sample Academy");
    await registry.connect(admin).setVerified(1, true);
    await registry.connect(owner).setInstructor(1, professor.address, true);
    await registry.connect(owner).setInstructor(1, head.address, true);
    await registry.connect(professor).setInstructorProfile(1, "Prof. Example", "Black Belt", sig("professor"));
    await registry.connect(head).setInstructorProfile(1, "Head Example", "Head Instructor", sig("head"));
  });

  describe("promotions", () => {
    it("records a promotion and exposes it", async () => {
      await expect(registry.connect(professor).promote(input({ student: student.address })))
        .to.emit(registry, "Promoted")
        .withArgs(1, 1, professor.address, "Sam Student", Belt.Blue, 0, day("2026-10-13"), ethers.ZeroAddress);

      const p = await registry.promotion(1);
      expect(p.studentName).to.equal("Sam Student");
      expect(p.belt).to.equal(Belt.Blue);
      expect(p.instructor).to.equal(professor.address);
      expect(p.instructorSignatureHash).to.equal(sig("professor"));
      expect(p.revoked).to.equal(false);
      expect(await registry.promotionCount()).to.equal(1);
      expect(await registry.isComplete(1)).to.equal(true);
    });

    it("fingerprint matches the value the certificate page computes", async () => {
      await registry.connect(professor).promote(input({ belt: Belt.Purple, degree: 2, cosigner: head.address }));
      const expected = ethers.solidityPackedKeccak256(
        ["uint256", "uint256", "address", "address", "string", "uint8", "uint8", "uint64"],
        [1, 1, professor.address, head.address, "Sam Student", Belt.Purple, 2, day("2026-10-13")]
      );
      expect(await registry.fingerprint(1)).to.equal(expected);
    });

    it("rejects promotions from unverified academies", async () => {
      await registry.connect(owner).registerAcademy("Unverified Gym");
      await registry.connect(owner).setInstructor(2, professor.address, true);
      await expect(registry.connect(professor).promote(input({ academyId: 2 })))
        .to.be.revertedWithCustomError(registry, "AcademyNotVerified");
    });

    it("rejects promotions from non-instructors", async () => {
      await expect(registry.connect(stranger).promote(input()))
        .to.be.revertedWithCustomError(registry, "NotInstructor");
    });

    it("only the admin verifies and only the owner sets instructors", async () => {
      await expect(registry.connect(stranger).setVerified(1, true)).to.be.revertedWithCustomError(registry, "NotAdmin");
      await expect(registry.connect(stranger).setInstructor(1, stranger.address, true))
        .to.be.revertedWithCustomError(registry, "NotAcademyOwner");
    });

    it("caps stripes at 4 and black-belt degrees at 6", async () => {
      await expect(registry.connect(professor).promote(input({ belt: Belt.Brown, degree: 5 })))
        .to.be.revertedWithCustomError(registry, "InvalidDegree");
      await expect(registry.connect(professor).promote(input({ belt: Belt.Black, degree: 6 }))).to.not.be.reverted;
      await expect(registry.connect(professor).promote(input({ belt: Belt.Black, degree: 7 })))
        .to.be.revertedWithCustomError(registry, "InvalidDegree");
    });

    it("links lineage only to the instructor's own black-belt record", async () => {
      // Record 1: professor's own black belt, issued by the head instructor.
      await registry.connect(head).promote(input({ studentName: "Professor", student: professor.address, belt: Belt.Black, degree: 1 }));
      // Record 2: a brown belt for the student.
      await registry.connect(head).promote(input({ student: student.address, belt: Belt.Brown }));

      await expect(registry.connect(professor).promote(input({ belt: Belt.Black, instructorRecordId: 1 }))).to.not.be.reverted;
      expect((await registry.promotion(3)).instructorRecordId).to.equal(1);

      // Pointing at someone else's record, or a non-black record, fails.
      await expect(registry.connect(professor).promote(input({ instructorRecordId: 2 })))
        .to.be.revertedWithCustomError(registry, "InvalidLineage");
    });

    it("lets the issuer or academy owner revoke, once", async () => {
      await registry.connect(professor).promote(input());
      await expect(registry.connect(stranger).revoke(1, "nope")).to.be.revertedWithCustomError(registry, "NotAuthorized");
      await expect(registry.connect(owner).revoke(1, "entered in error"))
        .to.emit(registry, "Revoked")
        .withArgs(1, owner.address, "entered in error");
      expect((await registry.promotion(1)).revoked).to.equal(true);
      expect(await registry.isComplete(1)).to.equal(false);
      await expect(registry.connect(professor).revoke(1, "again")).to.be.revertedWithCustomError(registry, "AlreadyRevoked");
    });

    it("reverts on unknown records", async () => {
      await expect(registry.promotion(99)).to.be.revertedWithCustomError(registry, "UnknownRecord");
      await expect(registry.fingerprint(0)).to.be.revertedWithCustomError(registry, "UnknownRecord");
    });
  });

  describe("logo and instructor profiles", () => {
    it("only the academy owner sets the logo hash", async () => {
      const logo = ethers.keccak256(ethers.toUtf8Bytes("logo-png"));
      await expect(registry.connect(stranger).setLogo(1, logo)).to.be.revertedWithCustomError(registry, "NotAcademyOwner");
      await expect(registry.connect(owner).setLogo(1, logo)).to.emit(registry, "AcademyLogoSet").withArgs(1, logo);
      expect((await registry.academy(1)).logoHash).to.equal(logo);
    });

    it("instructors set their own profile; others can't", async () => {
      await expect(registry.connect(stranger).setInstructorProfile(1, "Faker", "Black Belt", sig("fake")))
        .to.be.revertedWithCustomError(registry, "NotInstructor");
      const ins = await registry.instructor(1, professor.address);
      expect(ins.name).to.equal("Prof. Example");
      expect(ins.signatureHash).to.equal(sig("professor"));
      expect(await registry.isInstructor(1, professor.address)).to.equal(true);
    });

    it("requires a saved signature before signing a promotion", async () => {
      await registry.connect(owner).setInstructor(1, stranger.address, true);
      await expect(registry.connect(stranger).promote(input())).to.be.revertedWithCustomError(registry, "NoSignature");
    });

    it("keeps the signature in effect at signing time after a profile change", async () => {
      await registry.connect(professor).promote(input());
      await registry.connect(professor).setInstructorProfile(1, "Prof. Example", "Black Belt", sig("professor-v2"));
      expect((await registry.promotion(1)).instructorSignatureHash).to.equal(sig("professor"));
    });

    it("removing an instructor keeps their profile", async () => {
      await registry.connect(owner).setInstructor(1, professor.address, false);
      const ins = await registry.instructor(1, professor.address);
      expect(ins.active).to.equal(false);
      expect(ins.signatureHash).to.equal(sig("professor"));
    });
  });

  describe("co-signing", () => {
    it("stays pending until the co-signer signs, then records who and when", async () => {
      await registry.connect(professor).promote(input({ cosigner: head.address }));
      expect(await registry.isComplete(1)).to.equal(false);
      expect((await registry.promotion(1)).cosignedAt).to.equal(0);

      await expect(registry.connect(head).cosign(1)).to.emit(registry, "Cosigned").withArgs(1, head.address, sig("head"));
      const p = await registry.promotion(1);
      expect(p.cosignedAt).to.be.greaterThan(0);
      expect(p.cosignerSignatureHash).to.equal(sig("head"));
      expect(await registry.isComplete(1)).to.equal(true);
    });

    it("only the named co-signer can sign, and only once", async () => {
      await registry.connect(professor).promote(input({ cosigner: head.address }));
      await expect(registry.connect(stranger).cosign(1)).to.be.revertedWithCustomError(registry, "NotCosigner");
      await expect(registry.connect(professor).cosign(1)).to.be.revertedWithCustomError(registry, "NotCosigner");
      await registry.connect(head).cosign(1);
      await expect(registry.connect(head).cosign(1)).to.be.revertedWithCustomError(registry, "AlreadySigned");
    });

    it("co-signer must be a different active instructor of the same academy", async () => {
      await expect(registry.connect(professor).promote(input({ cosigner: professor.address })))
        .to.be.revertedWithCustomError(registry, "InvalidCosigner");
      await expect(registry.connect(professor).promote(input({ cosigner: stranger.address })))
        .to.be.revertedWithCustomError(registry, "InvalidCosigner");
    });

    it("a co-signer removed from the academy can no longer sign", async () => {
      await registry.connect(professor).promote(input({ cosigner: head.address }));
      await registry.connect(owner).setInstructor(1, head.address, false);
      await expect(registry.connect(head).cosign(1)).to.be.revertedWithCustomError(registry, "NotInstructor");
      expect(await registry.isComplete(1)).to.equal(false);
    });

    it("a revoked pending record can't be co-signed", async () => {
      await registry.connect(professor).promote(input({ cosigner: head.address }));
      await registry.connect(professor).revoke(1, "wrong belt");
      await expect(registry.connect(head).cosign(1)).to.be.revertedWithCustomError(registry, "AlreadyRevoked");
    });
  });
});
