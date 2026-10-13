// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BeltRegistry
/// @notice Public, append-only record of jiu-jitsu belt promotions.
///         Academies register and get verified by the registry admin.
///         Academy owners authorize instructors; instructors record promotions.
///         Records can be revoked (never deleted) by the issuing instructor or academy owner.
///
///         Images (gym logo, signature) live off-chain; the chain stores their keccak256
///         hashes so a certificate's printed images can be checked against the record.
///         A signature on a certificate is an attestation: the instructor's own wallet
///         sent the transaction, and the record keeps the signature hash in effect then.
contract BeltRegistry {
    enum Belt { White, Blue, Purple, Brown, Black, RedBlack, RedWhite, Red }

    struct Academy {
        address owner;
        string name;
        bool verified;
        bytes32 logoHash;           // keccak256 of the logo image bytes, 0 if none
    }

    struct Instructor {
        bool active;
        string name;
        string title;               // e.g. "Head Instructor · 3rd Degree Black Belt"
        bytes32 signatureHash;      // keccak256 of the signature image bytes, 0 if none
    }

    struct PromotionInput {
        uint256 academyId;
        string studentName;
        address student;            // optional wallet; zero if the student has none
        Belt belt;
        uint8 degree;
        uint64 promotedOn;
        uint256 instructorRecordId; // promoting instructor's own black-belt record, 0 if not linked
        address cosigner;           // second signer (e.g. head instructor), zero for a single signature
    }

    struct Promotion {
        uint256 academyId;
        address instructor;
        address student;
        Belt belt;
        uint8 degree;               // stripes on colored belts (0-4), degrees on black (0-6)
        uint64 promotedOn;          // unix seconds, date of the ceremony
        uint64 recordedAt;          // block timestamp when written (= promoting instructor's signing time)
        uint256 instructorRecordId;
        bool revoked;
        string studentName;
        bytes32 instructorSignatureHash; // promoting instructor's signature at signing time
        address cosigner;
        uint64 cosignedAt;          // 0 while the co-signature is pending
        bytes32 cosignerSignatureHash;
    }

    address public admin;
    Academy[] private _academies;      // index 0 unused
    Promotion[] private _promotions;   // index 0 unused
    mapping(uint256 => mapping(address => Instructor)) private _instructors;

    event AcademyRegistered(uint256 indexed academyId, address indexed owner, string name);
    event AcademyVerified(uint256 indexed academyId, bool verified);
    event AcademyLogoSet(uint256 indexed academyId, bytes32 logoHash);
    event InstructorSet(uint256 indexed academyId, address indexed instructor, bool active);
    event InstructorProfileSet(
        uint256 indexed academyId, address indexed instructor, string name, string title, bytes32 signatureHash
    );
    event Promoted(
        uint256 indexed recordId,
        uint256 indexed academyId,
        address indexed instructor,
        string studentName,
        Belt belt,
        uint8 degree,
        uint64 promotedOn,
        address cosigner
    );
    event Cosigned(uint256 indexed recordId, address indexed cosigner, bytes32 signatureHash);
    event Revoked(uint256 indexed recordId, address by, string reason);

    error NotAdmin();
    error UnknownAcademy();
    error NotAcademyOwner();
    error NotInstructor();
    error AcademyNotVerified();
    error UnknownRecord();
    error InvalidDegree();
    error InvalidLineage();
    error AlreadyRevoked();
    error NotAuthorized();
    error NoSignature();
    error InvalidCosigner();
    error NotCosigner();
    error AlreadySigned();

    constructor() {
        admin = msg.sender;
        _academies.push();
        _promotions.push();
    }

    // MARK: Academies

    function registerAcademy(string calldata name) external returns (uint256 academyId) {
        academyId = _academies.length;
        _academies.push(Academy({owner: msg.sender, name: name, verified: false, logoHash: 0}));
        emit AcademyRegistered(academyId, msg.sender, name);
    }

    function setVerified(uint256 academyId, bool verified) external {
        if (msg.sender != admin) revert NotAdmin();
        _academy(academyId).verified = verified;
        emit AcademyVerified(academyId, verified);
    }

    function setLogo(uint256 academyId, bytes32 logoHash) external {
        Academy storage a = _academy(academyId);
        if (a.owner != msg.sender) revert NotAcademyOwner();
        a.logoHash = logoHash;
        emit AcademyLogoSet(academyId, logoHash);
    }

    function academy(uint256 academyId) external view returns (Academy memory) {
        return _academy(academyId);
    }

    // MARK: Instructors

    /// @notice Owner authorizes or removes an instructor. Removing keeps their profile
    ///         and leaves records they already signed untouched.
    function setInstructor(uint256 academyId, address account, bool active) external {
        if (_academy(academyId).owner != msg.sender) revert NotAcademyOwner();
        _instructors[academyId][account].active = active;
        emit InstructorSet(academyId, account, active);
    }

    /// @notice An instructor sets their own name, title and signature. Only the
    ///         instructor's wallet can do this, so an owner can't forge a signature.
    function setInstructorProfile(
        uint256 academyId, string calldata name, string calldata title, bytes32 signatureHash
    ) external {
        _academy(academyId);
        Instructor storage ins = _instructors[academyId][msg.sender];
        if (!ins.active) revert NotInstructor();
        ins.name = name;
        ins.title = title;
        ins.signatureHash = signatureHash;
        emit InstructorProfileSet(academyId, msg.sender, name, title, signatureHash);
    }

    function isInstructor(uint256 academyId, address account) external view returns (bool) {
        return _instructors[academyId][account].active;
    }

    function instructor(uint256 academyId, address account) external view returns (Instructor memory) {
        return _instructors[academyId][account];
    }

    // MARK: Promotions

    /// @notice Records a promotion signed by the sender. With a co-signer it stays
    ///         pending until that instructor calls `cosign`.
    function promote(PromotionInput calldata input) external returns (uint256 recordId) {
        Academy storage a = _academy(input.academyId);
        if (!a.verified) revert AcademyNotVerified();
        Instructor storage ins = _instructors[input.academyId][msg.sender];
        if (!ins.active) revert NotInstructor();
        if (ins.signatureHash == 0) revert NoSignature();
        if (input.degree > (input.belt == Belt.Black ? 6 : 4)) revert InvalidDegree();

        if (input.cosigner != address(0)) {
            if (input.cosigner == msg.sender || !_instructors[input.academyId][input.cosigner].active) {
                revert InvalidCosigner();
            }
        }

        if (input.instructorRecordId != 0) {
            Promotion storage lineage = _promotion(input.instructorRecordId);
            if (lineage.revoked || lineage.student != msg.sender || lineage.belt < Belt.Black) {
                revert InvalidLineage();
            }
        }

        recordId = _promotions.length;
        Promotion storage p = _promotions.push();
        p.academyId = input.academyId;
        p.instructor = msg.sender;
        p.student = input.student;
        p.belt = input.belt;
        p.degree = input.degree;
        p.promotedOn = input.promotedOn;
        p.recordedAt = uint64(block.timestamp);
        p.instructorRecordId = input.instructorRecordId;
        p.studentName = input.studentName;
        p.instructorSignatureHash = ins.signatureHash;
        p.cosigner = input.cosigner;

        emit Promoted(
            recordId, input.academyId, msg.sender, input.studentName,
            input.belt, input.degree, input.promotedOn, input.cosigner
        );
    }

    /// @notice The named co-signer adds their signature. They must still be an active
    ///         instructor of the academy and have a saved signature.
    function cosign(uint256 recordId) external {
        Promotion storage p = _promotion(recordId);
        if (p.cosigner != msg.sender) revert NotCosigner();
        if (p.revoked) revert AlreadyRevoked();
        if (p.cosignedAt != 0) revert AlreadySigned();
        Instructor storage ins = _instructors[p.academyId][msg.sender];
        if (!ins.active) revert NotInstructor();
        if (ins.signatureHash == 0) revert NoSignature();
        p.cosignedAt = uint64(block.timestamp);
        p.cosignerSignatureHash = ins.signatureHash;
        emit Cosigned(recordId, msg.sender, ins.signatureHash);
    }

    function revoke(uint256 recordId, string calldata reason) external {
        Promotion storage p = _promotion(recordId);
        if (p.revoked) revert AlreadyRevoked();
        if (msg.sender != p.instructor && msg.sender != _academies[p.academyId].owner) revert NotAuthorized();
        p.revoked = true;
        emit Revoked(recordId, msg.sender, reason);
    }

    function promotion(uint256 recordId) external view returns (Promotion memory) {
        return _promotion(recordId);
    }

    function promotionCount() external view returns (uint256) {
        return _promotions.length - 1;
    }

    /// @notice True once every required signature is in and the record isn't revoked.
    function isComplete(uint256 recordId) external view returns (bool) {
        Promotion storage p = _promotion(recordId);
        return !p.revoked && (p.cosigner == address(0) || p.cosignedAt != 0);
    }

    /// @notice Hash printed on the certificate. Anyone can recompute it from the
    ///         certificate's visible fields and compare it to this value.
    function fingerprint(uint256 recordId) external view returns (bytes32) {
        Promotion storage p = _promotion(recordId);
        return keccak256(abi.encodePacked(
            recordId, p.academyId, p.instructor, p.cosigner, p.studentName, uint8(p.belt), p.degree, p.promotedOn
        ));
    }

    // MARK: Internal

    function _academy(uint256 academyId) private view returns (Academy storage) {
        if (academyId == 0 || academyId >= _academies.length) revert UnknownAcademy();
        return _academies[academyId];
    }

    function _promotion(uint256 recordId) private view returns (Promotion storage) {
        if (recordId == 0 || recordId >= _promotions.length) revert UnknownRecord();
        return _promotions[recordId];
    }
}
