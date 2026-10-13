// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BeltRegistry
/// @notice Public, append-only record of jiu-jitsu belt promotions.
///         Academies register and get verified by the registry admin.
///         Academy owners authorize instructors; instructors record promotions.
///         Records can be revoked (never deleted) by the issuing instructor or academy owner.
contract BeltRegistry {
    enum Belt { White, Blue, Purple, Brown, Black, RedBlack, RedWhite, Red }

    struct Academy {
        address owner;
        string name;
        bool verified;
    }

    struct Promotion {
        uint256 academyId;
        address instructor;
        address student;            // optional wallet; zero if the student has none
        Belt belt;
        uint8 degree;               // stripes on colored belts (0-4), degrees on black (0-6)
        uint64 promotedOn;          // unix seconds, date of the ceremony
        uint64 recordedAt;          // block timestamp when written
        uint256 instructorRecordId; // instructor's own black-belt record (lineage), 0 if not linked
        bool revoked;
        string studentName;
    }

    address public admin;
    Academy[] private _academies;      // index 0 unused
    Promotion[] private _promotions;   // index 0 unused
    mapping(uint256 => mapping(address => bool)) public isInstructor;

    event AcademyRegistered(uint256 indexed academyId, address indexed owner, string name);
    event AcademyVerified(uint256 indexed academyId, bool verified);
    event InstructorSet(uint256 indexed academyId, address indexed instructor, bool active);
    event Promoted(
        uint256 indexed recordId,
        uint256 indexed academyId,
        address indexed instructor,
        string studentName,
        Belt belt,
        uint8 degree,
        uint64 promotedOn
    );
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

    constructor() {
        admin = msg.sender;
        _academies.push();
        _promotions.push();
    }

    // MARK: Academies

    function registerAcademy(string calldata name) external returns (uint256 academyId) {
        academyId = _academies.length;
        _academies.push(Academy({owner: msg.sender, name: name, verified: false}));
        emit AcademyRegistered(academyId, msg.sender, name);
    }

    function setVerified(uint256 academyId, bool verified) external {
        if (msg.sender != admin) revert NotAdmin();
        _academy(academyId).verified = verified;
        emit AcademyVerified(academyId, verified);
    }

    function setInstructor(uint256 academyId, address instructor, bool active) external {
        if (_academy(academyId).owner != msg.sender) revert NotAcademyOwner();
        isInstructor[academyId][instructor] = active;
        emit InstructorSet(academyId, instructor, active);
    }

    function academy(uint256 academyId) external view returns (Academy memory) {
        return _academy(academyId);
    }

    // MARK: Promotions

    function promote(
        uint256 academyId,
        string calldata studentName,
        address student,
        Belt belt,
        uint8 degree,
        uint64 promotedOn,
        uint256 instructorRecordId
    ) external returns (uint256 recordId) {
        Academy storage a = _academy(academyId);
        if (!a.verified) revert AcademyNotVerified();
        if (!isInstructor[academyId][msg.sender]) revert NotInstructor();
        if (degree > (belt == Belt.Black ? 6 : 4)) revert InvalidDegree();

        if (instructorRecordId != 0) {
            Promotion storage lineage = _promotion(instructorRecordId);
            if (lineage.revoked || lineage.student != msg.sender || lineage.belt < Belt.Black) {
                revert InvalidLineage();
            }
        }

        recordId = _promotions.length;
        _promotions.push(Promotion({
            academyId: academyId,
            instructor: msg.sender,
            student: student,
            belt: belt,
            degree: degree,
            promotedOn: promotedOn,
            recordedAt: uint64(block.timestamp),
            instructorRecordId: instructorRecordId,
            revoked: false,
            studentName: studentName
        }));
        emit Promoted(recordId, academyId, msg.sender, studentName, belt, degree, promotedOn);
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

    /// @notice Hash printed on the certificate. Anyone can recompute it from the
    ///         certificate's visible fields and compare it to this value.
    function fingerprint(uint256 recordId) external view returns (bytes32) {
        Promotion storage p = _promotion(recordId);
        return keccak256(abi.encodePacked(
            recordId, p.academyId, p.instructor, p.studentName, uint8(p.belt), p.degree, p.promotedOn
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
